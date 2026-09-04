/**
 * Same Day Solution — Settlement API adapter.
 *
 * Moves money from our PARTNER wallet at Same Day to bank accounts. Two
 * account-add flows are supported:
 *
 *   1. Penny-drop verified (₹4 charge) — settlementAddAccount()
 *   2. Trusted / skip-verification (₹0) — settlementAddTrustedAccount()
 *
 * Transfers work to BOTH verified and trusted (skip-verified) accounts.
 * Trusted accounts are NOT confirmed with the bank — use only for accounts
 * we already trust. Wrong details = funds sent to the wrong recipient.
 *
 * Exposed via /api/admin/settlement/* (admin transfers) and wrapped by
 * sameday-payout.ts as the bank-mode retailer payout rail.
 *
 * Activate: PARTNER_SETTLEMENT_ENABLED=true  (flags.settlement)
 *   needs: SAMEDAY_SETTLEMENT_API_KEY / SAMEDAY_SETTLEMENT_API_SECRET
 *          (falls back to SAMEDAY_POS_API_KEY / SECRET)
 *
 * Notes from the collection:
 * - duplicate cooldown 2 min/account
 * - failed transfers auto-refund the partner wallet
 * - PENDING transfers must be tracked via status (which also live-polls)
 */
import type { PartnerResult } from "./types";
import { samedayCredentials, samedayRequest } from "./sameday-core";

const P = "/api/partner/settlement";

/**
 * Same Day rejects an account whose contact_details.email (or mobile) is blank
 * — the disbursal partner requires a contact on file, validated at transfer
 * time. We don't collect a per-beneficiary email, so fall back to a company
 * contact address to guarantee a non-blank, valid value on every add.
 */
const CONTACT_EMAIL_FALLBACK = "payouts@nxtgenpay.in";

export type SettlementMode = "IMPS" | "NEFT" | "RTGS";

export type VerificationStatus = "VERIFIED" | "NOT_VERIFIED" | "SKIPPED" | "PENDING" | "FAILED";

export type SettlementAccount = {
  id: string;
  accountNumber: string;
  ifscCode: string;
  accountHolderName: string;
  isVerified: boolean;
  verifiedName?: string;
  verificationStatus?: VerificationStatus;
  verificationLabel?: string;
};

export type SettlementTransaction = {
  id: string;
  referenceId: string;
  orderId?: string;
  utr?: string;
  amount: number;
  charges?: number;
  totalDebited?: number;
  mode?: string;
  status: "SUCCESS" | "PENDING" | "FAILED";
  statusMessage?: string;
  accountNumber?: string;
  accountHolderName?: string;
  createdAt?: string;
};

export function samedaySettlementConfigured(): boolean {
  return samedayCredentials("SETTLEMENT") !== null;
}

function creds() {
  const c = samedayCredentials("SETTLEMENT");
  if (!c) throw new Error("[sameday-settlement] SAMEDAY_SETTLEMENT_API_KEY/SECRET not configured");
  return c;
}

export function mapSettlementStatus(raw: string | undefined): SettlementTransaction["status"] {
  switch ((raw || "").toUpperCase()) {
    case "SUCCESS":
      return "SUCCESS";
    case "FAILED":
      return "FAILED";
    default:
      return "PENDING";
  }
}

type RawAccount = {
  id: string;
  account_number: string;
  ifsc_code: string;
  account_holder_name: string;
  is_verified?: boolean;
  verified_name?: string;
  verification_status?: string;
  verification_label?: string;
};

type RawTxn = {
  id: string;
  reference_id: string;
  order_id?: string;
  utr?: string;
  amount: number;
  charges?: number;
  total_debited?: number;
  mode?: string;
  status?: string;
  status_message?: string;
  account_number?: string;
  account_holder_name?: string;
  created_at?: string;
};

function mapAccount(a: RawAccount): SettlementAccount {
  return {
    id: a.id,
    accountNumber: a.account_number,
    ifscCode: a.ifsc_code,
    accountHolderName: a.account_holder_name,
    isVerified: Boolean(a.is_verified),
    verifiedName: a.verified_name,
    verificationStatus: (a.verification_status as VerificationStatus) || undefined,
    verificationLabel: a.verification_label,
  };
}

function mapTxn(t: RawTxn): SettlementTransaction {
  return {
    id: t.id,
    referenceId: t.reference_id,
    orderId: t.order_id,
    utr: t.utr,
    amount: t.amount,
    charges: t.charges,
    totalDebited: t.total_debited,
    mode: t.mode,
    status: mapSettlementStatus(t.status),
    statusMessage: t.status_message,
    accountNumber: t.account_number,
    accountHolderName: t.account_holder_name,
    createdAt: t.created_at,
  };
}

/** Current partner wallet balance at Same Day. */
export async function settlementBalance(): Promise<
  PartnerResult<{ balance: number; isFrozen: boolean; freezeReason?: string }>
> {
  const r = await samedayRequest<{
    success: boolean;
    balance?: number | string;
    is_frozen?: boolean;
    freeze_reason?: string;
  }>(creds(), "GET", `${P}/balance`);
  if (!r.ok) return r;
  return {
    ok: true,
    data: {
      balance: Number(r.data.balance ?? 0),
      isFrozen: Boolean(r.data.is_frozen),
      freezeReason: r.data.freeze_reason,
    },
    raw: r.raw,
  };
}

/** Add a bank account and penny-drop verify it (₹4 partner-wallet charge). */
export async function settlementAddAccount(input: {
  accountNumber: string;
  ifscCode: string;
  accountHolderName: string;
  contactName?: string;
  contactEmail?: string;
  contactMobile?: string;
}): Promise<PartnerResult<{ account: SettlementAccount; verificationStatus: string; verifiedName?: string }>> {
  const r = await samedayRequest<{
    success: boolean;
    verified?: boolean;
    verification_status?: string;
    verified_name?: string;
    account?: RawAccount;
  }>(creds(), "POST", `${P}/accounts`, {
    account_number: input.accountNumber,
    ifsc_code: input.ifscCode,
    account_holder_name: input.accountHolderName,
    contact_name: input.contactName ?? input.accountHolderName,
    contact_email: input.contactEmail?.trim() || CONTACT_EMAIL_FALLBACK,
    contact_mobile: input.contactMobile ?? "",
  });
  if (!r.ok) return r;
  if (!r.data.account) {
    return { ok: false, code: "NO_ACCOUNT", message: "Provider did not return an account", raw: r.raw };
  }
  return {
    ok: true,
    data: {
      account: mapAccount(r.data.account),
      verificationStatus: r.data.verification_status || (r.data.verified ? "SUCCESS" : "PENDING"),
      verifiedName: r.data.verified_name,
    },
    raw: r.raw,
  };
}

/**
 * Add a trusted bank account WITHOUT penny-drop verification (₹0 charge).
 *
 * WARNING: account details are NOT confirmed with the bank. If the account
 * number or IFSC is wrong, funds will be sent to the wrong recipient. Only
 * use for accounts we already trust. We accept this risk.
 */
export async function settlementAddTrustedAccount(input: {
  accountNumber: string;
  ifscCode: string;
  accountHolderName: string;
  contactName?: string;
  contactEmail?: string;
  contactMobile: string;
}): Promise<
  PartnerResult<{
    account: SettlementAccount;
    verificationStatus: string;
    skipVerification: boolean;
    message?: string;
  }>
> {
  if (!/^\d{10}$/.test(input.contactMobile)) {
    return { ok: false, code: "INVALID_MOBILE", message: "contact_mobile must be a valid 10-digit number when skipping verification" };
  }

  const r = await samedayRequest<{
    success: boolean;
    verified?: boolean;
    verification_status?: string;
    verification_label?: string;
    account?: RawAccount;
    skip_verification?: boolean;
    charge_deducted?: number;
    message?: string;
  }>(creds(), "POST", `${P}/accounts`, {
    account_number: input.accountNumber,
    ifsc_code: input.ifscCode,
    account_holder_name: input.accountHolderName,
    contact_name: input.contactName ?? input.accountHolderName,
    contact_email: input.contactEmail?.trim() || CONTACT_EMAIL_FALLBACK,
    contact_mobile: input.contactMobile,
    skip_verification: true,
  });

  if (!r.ok) return r;
  if (!r.data.account) {
    return { ok: false, code: "NO_ACCOUNT", message: "Provider did not return an account", raw: r.raw };
  }

  return {
    ok: true,
    data: {
      account: mapAccount(r.data.account),
      verificationStatus: r.data.verification_status || "SKIPPED",
      skipVerification: true,
      message: r.data.message,
    },
    raw: r.raw,
  };
}

export async function settlementListAccounts(): Promise<PartnerResult<SettlementAccount[]>> {
  const r = await samedayRequest<{ success: boolean; accounts?: RawAccount[] }>(
    creds(),
    "GET",
    `${P}/accounts`
  );
  if (!r.ok) return r;
  return { ok: true, data: (r.data.accounts ?? []).map(mapAccount), raw: r.raw };
}

export async function settlementDeleteAccount(id: string): Promise<PartnerResult<{ deleted: boolean }>> {
  const r = await samedayRequest<{ success: boolean; message?: string }>(
    creds(),
    "DELETE",
    `${P}/accounts`,
    undefined,
    { id }
  );
  if (!r.ok) return r;
  return { ok: true, data: { deleted: true }, raw: r.raw };
}

export type SettlementChargePreview = {
  amount: number;
  mode: string;
  schemeName: string;
  charges: number;
  gstAmount: number;
  totalCharge: number;
  totalDebit: number;
};

export async function settlementCharges(
  amount: number,
  mode: SettlementMode = "IMPS"
): Promise<PartnerResult<SettlementChargePreview>> {
  const r = await samedayRequest<{
    success: boolean;
    amount?: number;
    mode?: string;
    scheme_name?: string;
    charges?: number;
    gst_amount?: number;
    total_charge?: number;
    total_debit?: number;
  }>(creds(), "GET", `${P}/charges`, undefined, { amount: String(amount), mode });
  if (!r.ok) return r;
  const baseCharge = Number(r.data.charges ?? 0);
  const gst = Number(r.data.gst_amount ?? 0);
  return {
    ok: true,
    data: {
      amount: Number(r.data.amount ?? amount),
      mode: r.data.mode ?? mode,
      schemeName: r.data.scheme_name ?? "",
      charges: baseCharge,
      gstAmount: gst,
      totalCharge: Number(r.data.total_charge ?? baseCharge + gst),
      totalDebit: Number(r.data.total_debit ?? amount + baseCharge + gst),
    },
    raw: r.raw,
  };
}

/** Initiate a settlement transfer to a verified or trusted (skip-verified) account. */
export async function settlementTransfer(input: {
  accountId: string;
  amount: number;
  mode?: SettlementMode;
  narration?: string;
}): Promise<PartnerResult<SettlementTransaction>> {
  const r = await samedayRequest<{ success: boolean; transaction?: RawTxn }>(
    creds(),
    "POST",
    `${P}/transfer`,
    {
      account_id: input.accountId,
      amount: input.amount,
      mode: input.mode ?? "IMPS",
      narration: input.narration ?? "",
    }
  );
  if (!r.ok) return r;
  if (!r.data.transaction) {
    return { ok: false, code: "NO_TRANSACTION", message: "Provider did not return a transaction", raw: r.raw };
  }
  const txn = mapTxn(r.data.transaction);
  return { ok: true, data: txn, partnerTxnId: txn.orderId || txn.referenceId, raw: r.raw };
}

/** Poll one transfer by reference id (also live-refreshes PENDING at provider). */
export async function settlementStatus(referenceId: string): Promise<PartnerResult<SettlementTransaction>> {
  const r = await samedayRequest<{ success: boolean; transaction?: RawTxn }>(
    creds(),
    "GET",
    `${P}/status`,
    undefined,
    { reference_id: referenceId }
  );
  if (!r.ok) return r;
  if (!r.data.transaction) {
    return { ok: false, code: "NOT_FOUND", message: "No settlement found for that reference", raw: r.raw };
  }
  return { ok: true, data: mapTxn(r.data.transaction), raw: r.raw };
}

export async function settlementList(limit = 20): Promise<PartnerResult<SettlementTransaction[]>> {
  const r = await samedayRequest<{ success: boolean; transactions?: RawTxn[] }>(
    creds(),
    "GET",
    `${P}/status`,
    undefined,
    { list: "true", limit: String(Math.min(limit, 50)) }
  );
  if (!r.ok) return r;
  return { ok: true, data: (r.data.transactions ?? []).map(mapTxn), raw: r.raw };
}
