/**
 * Same Day Solution — Settlement API as a retailer payout rail.
 *
 * Implements the generic PayoutProvider contract on top of the Settlement
 * API (postman/SameDaySolution-Settlement-API.postman_collection.json) so the
 * standard payout lifecycle (hold → approve → worker → finalize) can disburse
 * via our Same Day partner wallet.
 *
 * Activate: PARTNER_PAYOUT_ENABLED=true  (flags.payout)
 *   needs: SAMEDAY_SETTLEMENT_API_KEY / SAMEDAY_SETTLEMENT_API_SECRET
 *          (falls back to SAMEDAY_POS_API_KEY / SECRET)
 *
 * Provider constraints (from the collection):
 * - The provider supports both verified and trusted (skip-verified) accounts,
 *   but the PAYOUT rail intentionally requires penny-drop verification for
 *   retailer payouts. First payout to a new beneficiary triggers an add +
 *   penny-drop verification (₹4 partner-wallet charge) before the transfer.
 * - Bank modes only (IMPS/NEFT/RTGS). UPI payouts must route elsewhere.
 * - No client-supplied idempotency key; duplicate defense is the provider's
 *   2-minute per-account cooldown plus our worker's "reconcile if a provider
 *   txn id is already persisted" rule. The transfer response's reference_id
 *   is persisted as the payout's provider txn id and used for status polls.
 * - Failed transfers auto-refund the partner wallet.
 */
import type { PartnerResult, PayoutOutput, PayoutProvider } from "./types";
import {
  settlementAddAccount,
  settlementAddTrustedAccount,
  settlementBalance,
  settlementDeleteAccount,
  settlementListAccounts,
  settlementStatus,
  settlementTransfer,
  type SettlementMode,
  type SettlementTransaction,
} from "./sameday-settlement";

/** Normalize any phone to the bare 10-digit form Same Day stores (drops +91 etc.). */
function toTenDigitMobile(mobile: string | undefined): string {
  return (mobile ?? "").replace(/\D/g, "").slice(-10);
}

/**
 * Same Day rejects transfers to an account whose contact_details is missing a
 * mobile OR an email with a top-level "The '<field>' field in 'contact_details'
 * can not be blank" (HTTP 200 + success:false). Detect either so we can repair
 * the stale account and retry, rather than surfacing a dead-end to the user.
 */
function isBlankContactDetailError(res: { message?: string; raw?: unknown }): boolean {
  const raw = res.raw && typeof res.raw === "object" ? JSON.stringify(res.raw) : "";
  const msg = `${res.message ?? ""} ${raw}`.toLowerCase();
  return (
    msg.includes("contact_details") &&
    msg.includes("blank") &&
    (msg.includes("mobile") || msg.includes("email"))
  );
}

export { samedaySettlementConfigured as samedayPayoutConfigured } from "./sameday-settlement";

/** Settlement lifecycle → coarse payout states used by the worker. */
export function mapSettlementToPayoutStatus(
  status: SettlementTransaction["status"]
): PayoutOutput["status"] {
  switch (status) {
    case "SUCCESS":
      return "PAID";
    case "FAILED":
      return "FAILED";
    default:
      return "PROCESSING";
  }
}

/**
 * Find the verified Same Day settlement account for a beneficiary, adding and
 * penny-drop verifying it on first use. Returns the provider account id.
 */
async function resolveVerifiedAccount(beneficiary: {
  name: string;
  accountNumber: string;
  ifsc: string;
  mobile?: string;
}): Promise<PartnerResult<{ accountId: string }>> {
  const listed = await settlementListAccounts();
  if (!listed.ok) return listed;

  const existing = listed.data.find(
    (a) => a.accountNumber === beneficiary.accountNumber && a.ifscCode === beneficiary.ifsc
  );
  if (existing) {
    // Same Day allows transfers to BOTH penny-drop verified AND trusted
    // (skip-verified, status SKIPPED) accounts, so either is usable — including
    // ones our own self-heal re-registered as trusted. Only a genuinely
    // in-flight penny-drop defers the payout; a FAILED drop is a hard stop.
    const usable = existing.isVerified || existing.verificationStatus === "SKIPPED";
    if (!usable) {
      const failed = existing.verificationStatus === "FAILED";
      return {
        ok: false,
        code: failed ? "VERIFICATION_FAILED" : "VERIFICATION_PENDING",
        message: failed
          ? "Beneficiary account verification failed at Same Day — delete and re-add the account"
          : "Beneficiary account is awaiting penny-drop verification at Same Day — retry shortly",
      };
    }
    return { ok: true, data: { accountId: existing.id } };
  }

  // Same Day validates a non-blank contact_details.mobile at transfer time, so
  // a beneficiary registered without one can never receive a transfer. Refuse to
  // create such a dead-on-arrival account up front with a clear reason.
  const mobile = toTenDigitMobile(beneficiary.mobile);
  if (mobile.length !== 10) {
    return {
      ok: false,
      code: "MISSING_CONTACT_MOBILE",
      message:
        "A valid 10-digit contact mobile is required to register this beneficiary with the bank partner. Update the mobile and retry.",
    };
  }

  const added = await settlementAddAccount({
    accountNumber: beneficiary.accountNumber,
    ifscCode: beneficiary.ifsc,
    accountHolderName: beneficiary.name,
    contactMobile: mobile,
  });
  if (!added.ok) return added;
  if (added.data.verificationStatus !== "SUCCESS") {
    return {
      ok: false,
      code: "VERIFICATION_PENDING",
      message: `Beneficiary verification is ${added.data.verificationStatus} at Same Day — retry once verified`,
      raw: added.raw,
    };
  }
  return { ok: true, data: { accountId: added.data.account.id }, raw: added.raw };
}

/**
 * Repair an existing Same Day account registered with blank contact_details
 * (missing mobile and/or email).
 *
 * Older accounts were added before we sent full contact details, so Same Day
 * rejects every transfer to them ("contact_details.<field> can not be blank").
 * Neither reuse path (beneficiary-book verify or resolveVerifiedAccount) re-adds
 * an existing account, so the gap is otherwise unfixable. We delete the stale
 * account and re-register it — carrying mobile + email (email defaulted in the
 * settlement adapter) — as a TRUSTED account (₹0, no re-penny-drop) since the
 * bank already confirmed these exact details during beneficiary verification.
 * Returns the fresh account id for a retry.
 */
async function reregisterWithMobile(beneficiary: {
  name: string;
  accountNumber: string;
  ifsc: string;
  mobile?: string;
}): Promise<PartnerResult<{ accountId: string }>> {
  const mobile = toTenDigitMobile(beneficiary.mobile);
  if (mobile.length !== 10) {
    return {
      ok: false,
      code: "MISSING_CONTACT_MOBILE",
      message:
        "This beneficiary is registered with the bank partner without a contact mobile, and no valid 10-digit mobile is available to repair it. Update the mobile and retry.",
    };
  }

  const listed = await settlementListAccounts();
  if (!listed.ok) return listed;
  const existing = listed.data.find(
    (a) => a.accountNumber === beneficiary.accountNumber && a.ifscCode === beneficiary.ifsc
  );
  if (existing) {
    const del = await settlementDeleteAccount(existing.id);
    if (!del.ok) return del;
  }

  const added = await settlementAddTrustedAccount({
    accountNumber: beneficiary.accountNumber,
    ifscCode: beneficiary.ifsc,
    accountHolderName: beneficiary.name,
    contactMobile: mobile,
  });
  if (!added.ok) return added;
  return { ok: true, data: { accountId: added.data.account.id }, raw: added.raw };
}

export const samedaySettlementPayout: PayoutProvider = {
  name: "SAMEDAY_SETTLEMENT",

  async payout(input) {
    if (input.mode === "UPI" || !input.beneficiary.accountNumber || !input.beneficiary.ifsc) {
      return {
        ok: false,
        code: "UNSUPPORTED_MODE",
        message: "Same Day settlement supports bank transfers (IMPS/NEFT/RTGS) only — UPI payouts need the BulkPe rail",
      };
    }

    const beneficiary = {
      name: input.beneficiary.name,
      accountNumber: input.beneficiary.accountNumber,
      ifsc: input.beneficiary.ifsc,
      mobile: input.beneficiary.mobile,
    };

    const account = await resolveVerifiedAccount(beneficiary);
    if (!account.ok) return account;

    const transfer = (accountId: string) =>
      settlementTransfer({
        accountId,
        amount: input.amount,
        mode: input.mode as SettlementMode,
        narration: input.purpose,
      });

    let r = await transfer(account.data.accountId);

    // Self-heal a stale account missing a contact mobile/email: the transfer was
    // rejected (no money moved), so re-register with full contact details and
    // retry exactly once.
    if (!r.ok && isBlankContactDetailError(r)) {
      const healed = await reregisterWithMobile(beneficiary);
      if (!healed.ok) return healed;
      r = await transfer(healed.data.accountId);
    }

    if (!r.ok) return r;

    return {
      ok: true,
      data: {
        // reference_id is what the status endpoint accepts — persist it as
        // the provider txn id so reconciliation can poll it later.
        payoutId: r.data.referenceId,
        utr: r.data.utr,
        status: mapSettlementToPayoutStatus(r.data.status),
      },
      partnerTxnId: r.data.referenceId,
      raw: r.raw,
    };
  },

  async status(payoutIdOrReference) {
    // Our internal reference ids ("PO…") are never sent to Same Day — only
    // the settlement reference_id persisted from the transfer response works.
    if (payoutIdOrReference.startsWith("PO")) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: "No Same Day settlement reference persisted for this payout yet",
      };
    }
    const r = await settlementStatus(payoutIdOrReference);
    if (!r.ok) return r;
    return {
      ok: true,
      data: { status: mapSettlementToPayoutStatus(r.data.status), utr: r.data.utr },
      raw: r.raw,
    };
  },

  async fetchBalance() {
    const r = await settlementBalance();
    if (!r.ok) return r;
    return { ok: true, data: r.data.balance, raw: r.raw };
  },
};
