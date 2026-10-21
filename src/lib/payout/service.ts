import { Prisma, type PayoutRequest, type PayoutStatus, type ServiceCode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { captureHold, creditWallet, releaseHold, LedgerError } from "@/lib/ledger";
import { decryptField } from "@/lib/crypto/fieldEncryption";
import { toNumber, sub, round } from "@/lib/money";
import { creditServiceMargin, reverseServiceMargin } from "@/lib/commission/revenue";
import { getPartner, assertRealMoneyProvider } from "@/lib/partners";
import { friendlyPartnerError, isSensitivePartnerCode } from "@/lib/partners/friendlyError";
import { sendOpsAlert } from "@/lib/monitoring/alerts";
import { enqueue, QUEUES } from "@/lib/queue";
import { emitWebhookEvent } from "@/lib/platform/webhooks";
import { logger } from "@/lib/logger";

/**
 * Shared, provider-agnostic payout lifecycle logic. Used by the queue worker
 * and the reconciliation poller so that both drive the exact same idempotent
 * state machine + ledger finalization.
 *
 * State machine (funds are HELD from submit until terminal):
 *   PENDING_APPROVAL --approve--> APPROVED --worker--> PROCESSING
 *   PROCESSING --success--> SUCCESS  (captureHold -> real DEBIT)
 *   PROCESSING --failure--> FAILED   (releaseHold -> back to spendable)
 *   SUCCESS    --reversal--> REVERSED (creditWallet refund)
 *
 * Concurrency: every terminal transition uses a conditional `updateMany`
 * (claim) so exactly one caller finalizes — webhook and poller can race
 * safely. captureHold/creditWallet are additionally idempotency-keyed at the
 * ledger; releaseHold is guarded by the single-winner claim.
 */

// States that still hold reserved funds and may be finalized. NEEDS_REVIEW is an
// INDETERMINATE hold (the bank may have disbursed) — like PROCESSING, it is
// pollable and finalizable to SUCCESS/FAILED/REVERSED, and the hold is retained
// until the rail's books resolve it.
const HOLDABLE: PayoutStatus[] = ["APPROVED", "PROCESSING", "NEEDS_REVIEW"];

const TERMINAL: PayoutStatus[] = ["SUCCESS", "FAILED", "REJECTED", "REVERSED"];

/** JSON-safe snapshot of a provider payload (never contains raw PII). */
function asJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return (value ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull;
}

/** Enqueue the worker job that actually calls the payout rail. */
export async function enqueuePayoutInitiate(payoutRequestId: string): Promise<void> {
  await enqueue(
    QUEUES.PAYOUT_INITIATE,
    { payoutRequestId },
    { singletonKey: `payout-initiate:${payoutRequestId}` }
  );
}

/**
 * Terminal SUCCESS: capture the hold into a real DEBIT (reason PAYOUT) and
 * record the UTR. Idempotent — a replay/duplicate is a no-op.
 */
export async function finalizePayoutSuccess(
  payoutRequestId: string,
  data: { utr?: string | null; providerTxnId?: string | null; response?: unknown }
): Promise<{ finalized: boolean }> {
  const row = await prisma.payoutRequest.findUnique({ where: { id: payoutRequestId } });
  if (!row || TERMINAL.includes(row.status)) return { finalized: false };

  await prisma.$transaction(async (tx) => {
    const claim = await tx.payoutRequest.updateMany({
      where: { id: payoutRequestId, status: { in: HOLDABLE } },
      data: {
        status: "SUCCESS",
        utr: data.utr ?? row.utr ?? null,
        providerTxnId: data.providerTxnId ?? row.providerTxnId ?? null,
        response: asJson(data.response ?? row.response),
        completedAt: new Date(),
      },
    });
    if (claim.count === 0) return; // someone else finalized first

    await captureHold(
      {
        userId: row.userId,
        amount: row.totalDebit,
        reason: "PAYOUT",
        refType: "PayoutRequest",
        refId: row.id,
        note: `Payout to ${row.beneficiaryName} (${row.mode})`,
        idempotencyKey: `payout:${row.id}:capture`,
      },
      tx
    );

    // Payout pays no chain commission, so the company's booked earning is the
    // spread: serviceCharge − vendor/partner cost (GST is a pass-through
    // liability). Credit it to the Revenue Wallet (idempotent, best-effort).
    const margin = round(sub(row.serviceCharge, row.vendorCharge));
    await creditServiceMargin(row.id, "PAYOUT", margin, tx, {
      refType: "PayoutRequest",
      idempotencyKey: `service-margin:payout:${row.id}`,
    });
  });

  await prisma.auditLog.create({
    data: {
      userId: row.userId,
      action: "payout.success",
      entity: "PayoutRequest",
      entityId: row.id,
      meta: { utr: data.utr ?? null, totalDebit: toNumber(row.totalDebit) },
    },
  });

  // Payout earns no chain commission; the company margin (serviceCharge −
  // vendor) was credited to the Revenue Wallet inside the transaction above.

  // Partner webhook (best-effort; never blocks finalization).
  void emitWebhookEvent(row.userId, "payout.success", {
    payoutId: row.id,
    amount: toNumber(row.amount),
    totalDebit: toNumber(row.totalDebit),
    mode: row.mode,
    beneficiaryName: row.beneficiaryName,
    accountLast4: row.accountLast4,
    utr: data.utr ?? null,
  });
  return { finalized: true };
}

/**
 * Terminal FAILURE: release the hold back to spendable. Idempotent.
 */
export async function finalizePayoutFailure(
  payoutRequestId: string,
  data: { failureReason?: string | null; response?: unknown }
): Promise<{ finalized: boolean }> {
  const row = await prisma.payoutRequest.findUnique({ where: { id: payoutRequestId } });
  if (!row || TERMINAL.includes(row.status)) return { finalized: false };

  let finalized = false;
  await prisma.$transaction(async (tx) => {
    const claim = await tx.payoutRequest.updateMany({
      where: { id: payoutRequestId, status: { in: HOLDABLE } },
      data: {
        status: "FAILED",
        failureReason: data.failureReason ?? "Payout failed at provider",
        response: asJson(data.response ?? row.response),
        completedAt: new Date(),
      },
    });
    if (claim.count === 0) return;
    finalized = true;
    await releaseHold({ userId: row.userId, amount: row.totalDebit }, tx);
  });

  if (finalized) {
    await prisma.auditLog.create({
      data: {
        userId: row.userId,
        action: "payout.failed",
        entity: "PayoutRequest",
        entityId: row.id,
        meta: { reason: data.failureReason ?? null, totalDebit: toNumber(row.totalDebit) },
      },
    });
    // Partner webhook (best-effort).
    void emitWebhookEvent(row.userId, "payout.failed", {
      payoutId: row.id,
      amount: toNumber(row.amount),
      totalDebit: toNumber(row.totalDebit),
      mode: row.mode,
      beneficiaryName: row.beneficiaryName,
      accountLast4: row.accountLast4,
      reason: data.failureReason ?? null,
    });
  }
  return { finalized };
}

/**
 * Post-settlement REVERSAL: a payout that already SUCCEEDED was returned by the
 * bank. Refund the captured amount via a REVERSAL credit. Idempotent.
 */
export async function reversePayout(
  payoutRequestId: string,
  data: { response?: unknown; reason?: string | null }
): Promise<{ reversed: boolean }> {
  const row = await prisma.payoutRequest.findUnique({ where: { id: payoutRequestId } });
  if (!row || row.status !== "SUCCESS") return { reversed: false };

  let reversed = false;
  await prisma.$transaction(async (tx) => {
    const claim = await tx.payoutRequest.updateMany({
      where: { id: payoutRequestId, status: "SUCCESS" },
      data: {
        status: "REVERSED",
        failureReason: data.reason ?? "Reversed by bank/payout rail",
        response: asJson(data.response ?? row.response),
        completedAt: new Date(),
      },
    });
    if (claim.count === 0) return;
    reversed = true;
    await creditWallet(
      {
        userId: row.userId,
        amount: row.totalDebit,
        reason: "REVERSAL",
        refType: "PayoutRequest",
        refId: row.id,
        note: `Payout reversal for ${row.beneficiaryName}`,
        idempotencyKey: `payout:${row.id}:reversal`,
      },
      tx
    );
  });

  if (reversed) {
    // Claw the booked service margin back out of the Revenue Wallet — the
    // company never realised it. Best-effort (own txn); never blocks the refund.
    await reverseServiceMargin(
      row.id,
      "PAYOUT",
      round(sub(row.serviceCharge, row.vendorCharge)),
      { refType: "PayoutRequest", idempotencyKey: `service-margin-reversal:payout:${row.id}` }
    );
    await prisma.auditLog.create({
      data: {
        userId: row.userId,
        action: "payout.reversed",
        entity: "PayoutRequest",
        entityId: row.id,
        meta: { totalDebit: toNumber(row.totalDebit) },
      },
    });
  }
  return { reversed };
}

/** Normalize a phone to the bare 10-digit form providers expect (drops +91 etc.). */
function toContactMobile(phone: string | null | undefined): string | undefined {
  const digits = (phone ?? "").replace(/\D/g, "").slice(-10);
  return digits.length === 10 ? digits : undefined;
}

/**
 * Human-facing failure reason for a payout. Providers return a machine code
 * (e.g. "HTTP_200", "NETWORK") alongside a message; users should only ever see
 * the message — never the code. The raw code + payload is still persisted on
 * the row's `response` for ops/debugging. Falls back to a generic line when the
 * provider gave no usable message.
 */
/**
 * User-facing payout failure reason. The retailer only ever sees a sanitized,
 * reassuring message (the raw provider text lands in `response`/logs). A low
 * PARTNER float or auth/config problem is OUR issue, so it collapses to the
 * generic message and pages ops instead of blaming the retailer.
 */
function payoutFailureReason(res: { code: string; message: string }): string {
  if (isSensitivePartnerCode(res.code)) {
    void sendOpsAlert({
      title: "Payout rejected by provider for an internal reason",
      severity: "critical",
      details: { code: res.code ?? null },
    });
  }
  return friendlyPartnerError(res.code, res.message, "payout");
}

/** Build the decrypted beneficiary block for the provider call. */
function beneficiaryFor(row: PayoutRequest, contactMobile?: string) {
  if (row.mode === "UPI") {
    return { name: row.beneficiaryName, vpa: decryptField(row.accountNumber) };
  }
  return {
    name: row.beneficiaryName,
    accountNumber: decryptField(row.accountNumber),
    ifsc: row.ifsc ? decryptField(row.ifsc) : undefined,
    // Same Day requires a non-blank contact mobile on the registered account or
    // the transfer is rejected; the requester's own mobile is always present.
    mobile: contactMobile,
  };
}

/**
 * Worker entry for QUEUES.PAYOUT_INITIATE. Transitions APPROVED -> PROCESSING,
 * calls the payout rail with the unique reference_id, and finalizes immediately
 * if the provider returns a terminal state. Retry-safe: if already sent, it
 * reconciles instead of re-initiating.
 */
export async function processPayoutInitiate(payoutRequestId: string): Promise<void> {
  const row = await prisma.payoutRequest.findUnique({ where: { id: payoutRequestId } });
  if (!row) return;
  if (TERMINAL.includes(row.status)) return;
  if (row.status === "PENDING_APPROVAL" || row.status === "DRAFT") return; // not approved yet

  // Already handed to the rail on a previous attempt → reconcile, don't re-send.
  if (row.providerTxnId) {
    await reconcilePayout(payoutRequestId);
    return;
  }

  // Idempotent send guard: ONLY the APPROVED → PROCESSING transition is allowed
  // to call the rail. A row already in PROCESSING/NEEDS_REVIEW was handed off on
  // a prior attempt (whose response may have been lost before we persisted the
  // reference), so a worker retry must NEVER re-send — it reconciles instead,
  // which runs reference recovery and finalizes against the rail's own books.
  // This closes the double-send window where a transfer succeeded but the attempt
  // crashed before the provider id was stored.
  const claim = await prisma.payoutRequest.updateMany({
    where: { id: payoutRequestId, status: "APPROVED" },
    data: { status: "PROCESSING", processedAt: row.processedAt ?? new Date() },
  });
  if (claim.count === 0) {
    // Not freshly APPROVED → already in-flight (PROCESSING/NEEDS_REVIEW) or
    // terminal. Reconcile (recovery-aware) rather than re-sending — this is what
    // makes a retry recover a lost reference instead of duplicating the transfer.
    await reconcilePayout(payoutRequestId);
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: row.userId },
    select: { userCode: true, phone: true },
  });

  const provider = getPartner("payout");
  // Never push real money through a mock in production. A mock "PAID" would
  // capture the hold (debit the user) without any bank transfer. Refuse instead
  // — the request stays PROCESSING (funds held) for ops/recon to resolve.
  assertRealMoneyProvider(
    provider,
    () => new Error("Payout rail resolved to MOCK in production — refusing to send")
  );
  // Embed our providerReferenceId in the narration so SameDay carries it in
  // webhook payloads and list API responses. This makes reference recovery
  // reliable even when the transfer response is lost (indeterminate).
  const narrationTag = row.providerReferenceId;
  const res = await provider.payout({
    idempotencyKey: row.providerReferenceId,
    userId: row.userId,
    mode: row.mode,
    amount: toNumber(row.amount),
    beneficiary: beneficiaryFor(row, toContactMobile(user?.phone)),
    purpose: user?.userCode
      ? `NxtGenPay RT-${user.userCode} ${narrationTag}`
      : `NxtGenPay ${narrationTag}`,
  });

  // Persist a safe request/response snapshot (no raw PII in request).
  await prisma.payoutRequest.update({
    where: { id: payoutRequestId },
    data: {
      request: {
        mode: row.mode,
        amount: toNumber(row.amount),
        accountLast4: row.accountLast4,
        beneficiaryName: row.beneficiaryName,
        referenceId: row.providerReferenceId,
        provider: provider.name,
      },
      response: asJson(res.raw ?? res),
      providerTxnId: res.ok ? res.data.payoutId || row.providerTxnId : row.providerTxnId,
    },
  });

  if (!res.ok) {
    // INDETERMINATE outcome (network/timeout, HTTP 5xx/408/429, or an uncaught
    // transport exception): the bank transfer MAY have gone through. Releasing
    // the hold here (finalizePayoutFailure) would free the retailer's money for
    // a payout that possibly succeeded — a direct double-spend loss. So we do
    // NOT finalize: the row moves to NEEDS_REVIEW (funds HELD), landing in the
    // admin held-payouts queue. The reconcile poller then tries to RECOVER the
    // rail reference (reference recovery via the settlement list API) and
    // finalize against the rail's own books; an inbound webhook can also resolve
    // it; and an operator can resolve it manually. Page ops for visibility.
    if (res.indeterminate) {
      await prisma.payoutRequest.updateMany({
        where: { id: payoutRequestId, status: "PROCESSING" },
        data: { status: "NEEDS_REVIEW" },
      });
      void sendOpsAlert({
        title: "Indeterminate payout outcome — HELD for review, funds NOT released (possible bank disbursal)",
        severity: "critical",
        details: {
          payoutId: row.id,
          userId: row.userId,
          amount: toNumber(row.amount),
          totalDebit: toNumber(row.totalDebit),
          code: res.code ?? null,
          providerReferenceId: row.providerReferenceId,
          hasRailReference: Boolean(row.providerTxnId),
        },
      });
      await prisma.auditLog.create({
        data: {
          userId: row.userId,
          action: "payout.held_indeterminate",
          entity: "PayoutRequest",
          entityId: row.id,
          meta: { code: res.code ?? null, reason: "indeterminate_provider_result", status: "NEEDS_REVIEW" },
        },
      });
      logger.warn({
        action: "payout.held_indeterminate",
        payoutId: row.id,
        code: res.code ?? null,
        msg: "payout moved to NEEDS_REVIEW (hold retained) pending reconciliation",
      });
      return; // NEEDS_REVIEW — hold retained, recon/webhook/operator will finalize
    }

    // DEFINITIVE decline (business reject / 4xx / explicit provider failure):
    // safe to release the hold back to spendable.
    await finalizePayoutFailure(payoutRequestId, {
      failureReason: payoutFailureReason(res),
      response: res.raw,
    });
    return;
  }

  if (res.data.status === "PAID") {
    await finalizePayoutSuccess(payoutRequestId, {
      utr: res.data.utr,
      providerTxnId: res.data.payoutId,
      response: res.raw,
    });
  } else if (res.data.status === "FAILED") {
    await finalizePayoutFailure(payoutRequestId, {
      failureReason: "Provider returned FAILED",
      response: res.raw,
    });
  }
  // PROCESSING → leave; webhook or poller will finalize.
}

/**
 * RECOVER the rail reference of a held payout whose transfer response was lost.
 *
 * When a payout goes INDETERMINATE (NEEDS_REVIEW) we often never captured the
 * rail's `reference_id` — our own `providerReferenceId` ("PO…") is NOT accepted
 * by the settlement status API, so the payout is un-pollable. This lists the
 * rail's own recent transactions and matches one to our held row by
 * amount + beneficiary account last-4 + a time window around when we sent it.
 *
 * To avoid a wrong attribution it only recovers an UNAMBIGUOUS, UNCLAIMED match
 * (exactly one candidate, not already linked to another payout). On success it
 * persists the reference as `providerTxnId` so the normal poll path can finalize.
 * Returns the recovered reference (or null when none/ambiguous).
 */
export async function recoverPayoutReference(payoutRequestId: string): Promise<string | null> {
  const row = await prisma.payoutRequest.findUnique({ where: { id: payoutRequestId } });
  if (!row || !HOLDABLE.includes(row.status) || row.providerTxnId) {
    return row?.providerTxnId ?? null;
  }

  const provider = getPartner("payout");
  if (typeof provider.listRecent !== "function") return null;
  assertRealMoneyProvider(
    provider,
    () => new Error("Payout rail resolved to MOCK in production — refusing to recover reference")
  );

  // SameDay's list endpoint is capped at 50 rows by the API. We also search by
  // our own providerReferenceId embedded in the narration (Fix 2) so recovery
  // is reliable even when the list has cycled past the indeterminate transfer.
  const list = await provider.listRecent(50);
  if (!list.ok) return null; // transient; next poll retries

  const targetAmount = toNumber(row.amount);
  const last4 = (row.accountLast4 ?? "").replace(/\D/g, "").slice(-4);
  // Generous window anchored on when we handed the transfer to the rail.
  // 48h covers NEFT/RTGS settlement lag and delayed SameDay list availability.
  const anchor = (row.processedAt ?? row.createdAt).getTime();
  const WINDOW_MS = 48 * 3_600_000; // 48h — covers delayed settlement + long weekends

  const candidates = list.data.filter((rec) => {
    if (Math.abs(rec.amount - targetAmount) > 0.009) return false;
    if (last4 && rec.accountLast4 && rec.accountLast4 !== last4) return false;
    if (rec.createdAt) {
      const t = new Date(rec.createdAt).getTime();
      if (!Number.isNaN(t) && Math.abs(t - anchor) > WINDOW_MS) return false;
    }
    return true;
  });

  if (candidates.length === 0) return null;

  // Discard any candidate already linked to a different payout, so two payouts
  // of the same amount to the same account can never steal each other's record.
  const unclaimed: typeof candidates = [];
  for (const rec of candidates) {
    const taken = await prisma.payoutRequest.findFirst({
      where: { providerTxnId: rec.reference, id: { not: row.id } },
      select: { id: true },
    });
    if (!taken) unclaimed.push(rec);
  }

  if (unclaimed.length !== 1) {
    // Zero (all claimed) or ambiguous (>1) — do not guess; leave for an operator.
    if (unclaimed.length > 1) {
      void sendOpsAlert({
        title: "Payout reference recovery is AMBIGUOUS — manual review needed",
        severity: "warning",
        details: {
          payoutId: row.id,
          amount: targetAmount,
          accountLast4: last4 || null,
          candidates: unclaimed.map((c) => c.reference).slice(0, 5).join(", "),
        },
      });
    }
    return null;
  }

  const recovered = unclaimed[0];
  await prisma.payoutRequest.updateMany({
    where: { id: row.id, status: { in: HOLDABLE }, providerTxnId: null },
    data: { providerTxnId: recovered.reference },
  });
  await prisma.auditLog.create({
    data: {
      userId: row.userId,
      action: "payout.reference_recovered",
      entity: "PayoutRequest",
      entityId: row.id,
      meta: { reference: recovered.reference, railStatus: recovered.status, via: "settlement_list" },
    },
  });
  logger.warn({
    action: "payout.reference_recovered",
    payoutId: row.id,
    reference: recovered.reference,
    msg: "recovered lost rail reference for held payout",
  });
  return recovered.reference;
}

/**
 * Poll the payout rail for the terminal state of a single in-flight payout and
 * finalize. Safe fallback that finalizes payouts left in a non-terminal state.
 *
 * For a NEEDS_REVIEW row with no stored rail reference, it first attempts
 * reference recovery (so a payout whose transfer response was lost can still be
 * finalized against the rail's books) before polling.
 */
export async function reconcilePayout(payoutRequestId: string): Promise<void> {
  let row = await prisma.payoutRequest.findUnique({ where: { id: payoutRequestId } });
  if (!row || !HOLDABLE.includes(row.status)) return;

  // No rail reference persisted (lost response) → try to recover it first.
  if (!row.providerTxnId) {
    const recovered = await recoverPayoutReference(payoutRequestId);
    if (recovered) {
      row = await prisma.payoutRequest.findUnique({ where: { id: payoutRequestId } });
      if (!row || !HOLDABLE.includes(row.status)) return;
    }
  }

  const provider = getPartner("payout");
  // A mock status poll unconditionally returns "PAID" — never let recon finalize
  // a phantom success (capture the hold with no real transfer) in production.
  assertRealMoneyProvider(
    provider,
    () => new Error("Payout rail resolved to MOCK in production — refusing to reconcile")
  );
  const lookupId = row.providerTxnId || row.providerReferenceId;
  const res = await provider.status(lookupId);
  if (!res.ok) return; // transient (or un-pollable "PO…" ref); try again next poll

  if (res.data.status === "PAID") {
    await finalizePayoutSuccess(payoutRequestId, { utr: res.data.utr, response: res.raw });
  } else if (res.data.status === "FAILED") {
    await finalizePayoutFailure(payoutRequestId, {
      failureReason: "Reconciliation: provider FAILED",
      response: res.raw,
    });
  }
  // still PROCESSING → leave for the next poll
}

/**
 * Finalize a payout in response to an inbound Same Day webhook.
 *
 * The webhook body is treated as a TRIGGER, never as the source of truth: we
 * correlate it to our row by the Same Day `reference_id` (persisted as
 * `providerTxnId`) or our own `providerReferenceId`, then RE-FETCH the terminal
 * state from the settlement `status` API before moving any money. This means a
 * forged or stale payload can never finalize a payout — the provider's books
 * decide. Idempotent and race-safe with the 5-minute reconcile poller.
 *
 * `reversal` is set when the event signals a post-success bank return; a SUCCESS
 * payout is then REVERSED (refunded) instead of re-polled.
 */
export async function reconcilePayoutFromWebhook(
  refs: string[],
  opts: { reversal: boolean; response?: unknown } = { reversal: false }
): Promise<{ matched: boolean; payoutRequestId?: string; action?: string }> {
  const cleaned = Array.from(new Set(refs.filter((r) => typeof r === "string" && r.length > 0)));
  if (cleaned.length === 0) return { matched: false };

  const row = await prisma.payoutRequest.findFirst({
    where: {
      OR: [
        { providerTxnId: { in: cleaned } },
        { providerReferenceId: { in: cleaned } },
      ],
    },
    select: { id: true, status: true },
  });
  if (!row) return { matched: false };

  if (opts.reversal && row.status === "SUCCESS") {
    const r = await reversePayout(row.id, {
      response: opts.response,
      reason: "Reversed by Same Day settlement (webhook)",
    });
    return { matched: true, payoutRequestId: row.id, action: r.reversed ? "reversed" : "noop" };
  }

  // Non-terminal → re-poll the rail and finalize; terminal → no-op.
  await reconcilePayout(row.id);
  return { matched: true, payoutRequestId: row.id, action: "reconciled" };
}

// ── Fuzzy webhook matching ──────────────────────────────────────────────────
// When exact-reference matching fails (lost transfer response → no providerTxnId
// stored), fall back to matching the webhook's amount + accountLast4 to a
// NEEDS_REVIEW payout with no rail reference. This closes the gap where SameDay
// sends a settlement.success webhook that we cannot correlate by reference alone.
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum age (ms) of a NEEDS_REVIEW payout eligible for fuzzy webhook match. */
const FUZZY_WEBHOOK_WINDOW_MS = 48 * 3_600_000; // 48 hours

/**
 * Try to fuzzy-match an unmatched settlement webhook to a held (NEEDS_REVIEW)
 * payout whose rail reference was lost. Match criteria:
 *   1. Status is NEEDS_REVIEW and providerTxnId IS NULL (lost reference).
 *   2. Amount matches (±0.01 tolerance for rounding).
 *   3. Account last-4 matches (when available in both).
 *   4. Created within FUZZY_WEBHOOK_WINDOW_MS.
 *   5. Exactly ONE candidate (ambiguous → skip, alert ops).
 *
 * On match: stores the webhook's reference as providerTxnId, then reconciles
 * via the normal poll path (re-fetches status from SameDay before moving money).
 */
export async function fuzzyMatchHeldPayoutFromWebhook(
  webhookAmount: number,
  webhookAccountLast4: string,
  webhookRefs: string[],
  webhookBody: unknown,
  opts: { reversal: boolean } = { reversal: false }
): Promise<{ matched: boolean; payoutRequestId?: string; action?: string }> {
  if (webhookAmount <= 0) return { matched: false };

  // Find the first usable reference from the webhook to store as providerTxnId.
  const refToStore = webhookRefs.find((r) => r.length > 0) ?? null;
  if (!refToStore) return { matched: false };

  const cutoff = new Date(Date.now() - FUZZY_WEBHOOK_WINDOW_MS);
  const candidates = await prisma.payoutRequest.findMany({
    where: {
      status: "NEEDS_REVIEW",
      providerTxnId: null,
      createdAt: { gte: cutoff },
    },
    select: {
      id: true,
      status: true,
      amount: true,
      accountLast4: true,
      createdAt: true,
    },
  });

  const matched = candidates.filter((c) => {
    if (Math.abs(toNumber(c.amount) - webhookAmount) > 0.01) return false;
    if (webhookAccountLast4.length === 4 && c.accountLast4 && c.accountLast4 !== webhookAccountLast4) return false;
    return true;
  });

  if (matched.length === 0) return { matched: false };

  if (matched.length > 1) {
    void sendOpsAlert({
      title: "Fuzzy webhook payout match is AMBIGUOUS — skipped, manual review needed",
      severity: "warning",
      details: {
        webhookAmount,
        webhookAccountLast4: webhookAccountLast4 || null,
        webhookRef: refToStore,
        candidates: matched.map((c) => c.id).slice(0, 5).join(", "),
      },
    });
    logger.warn({
      action: "payout.fuzzy_webhook_ambiguous",
      webhookRef: refToStore,
      count: matched.length,
      msg: "multiple NEEDS_REVIEW payouts match this webhook — skipped",
    });
    return { matched: false };
  }

  const target = matched[0];

  // Ensure the reference is not already claimed by a different payout.
  const taken = await prisma.payoutRequest.findFirst({
    where: { providerTxnId: refToStore, id: { not: target.id } },
    select: { id: true },
  });
  if (taken) return { matched: false };

  // Store the recovered reference.
  const claim = await prisma.payoutRequest.updateMany({
    where: { id: target.id, status: "NEEDS_REVIEW", providerTxnId: null },
    data: { providerTxnId: refToStore },
  });
  if (claim.count === 0) return { matched: false };

  await prisma.auditLog.create({
    data: {
      userId: null,
      action: "payout.reference_recovered",
      entity: "PayoutRequest",
      entityId: target.id,
      meta: { reference: refToStore, via: "fuzzy_webhook_match", webhookAmount },
    },
  });
  logger.warn({
    action: "payout.fuzzy_webhook_recovered",
    payoutId: target.id,
    reference: refToStore,
    msg: "recovered lost rail reference from unmatched webhook via fuzzy match",
  });

  // Now reconcile via the normal path (re-fetches status from SameDay API).
  if (opts.reversal) {
    const r = await reversePayout(target.id, {
      response: webhookBody,
      reason: "Reversed by Same Day settlement (webhook, fuzzy match)",
    });
    return { matched: true, payoutRequestId: target.id, action: r.reversed ? "reversed" : "noop" };
  }
  await reconcilePayout(target.id);
  return { matched: true, payoutRequestId: target.id, action: "fuzzy_reconciled" };
}

/**
 * Scan for payouts stuck in PROCESSING beyond `olderThanSec` and reconcile each.
 * Driven by the scheduled QUEUES.PAYOUT_RECONCILE job.
 */
export async function reconcileStuckPayouts(
  olderThanSec = 120,
  limit = 50
): Promise<{ scanned: number }> {
  const cutoff = new Date(Date.now() - olderThanSec * 1000);
  const rows = await prisma.payoutRequest.findMany({
    // NEEDS_REVIEW rows are swept too: recon attempts reference recovery +
    // poll so an indeterminate hold self-resolves without operator action.
    where: { status: { in: ["PROCESSING", "NEEDS_REVIEW"] }, processedAt: { lt: cutoff } },
    orderBy: { processedAt: "asc" },
    take: limit,
    select: { id: true },
  });
  for (const r of rows) {
    try {
      await reconcilePayout(r.id);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[payout] reconcile failed for ${r.id}:`, e);
    }
  }
  return { scanned: rows.length };
}

/** A held (NEEDS_REVIEW) payout as surfaced in the admin review queue. */
export type HeldPayoutRow = {
  id: string;
  userId: string;
  userCode: string | null;
  amount: number;
  totalDebit: number;
  mode: string;
  beneficiaryName: string;
  accountLast4: string | null;
  providerReferenceId: string;
  providerTxnId: string | null;
  failureReason: string | null;
  processedAt: string | null;
  createdAt: string;
};

/** List payouts held for review (INDETERMINATE outcome), oldest first. */
export async function listHeldPayouts(limit = 200): Promise<HeldPayoutRow[]> {
  const rows = await prisma.payoutRequest.findMany({
    where: { status: "NEEDS_REVIEW" },
    orderBy: { processedAt: "asc" },
    take: limit,
    include: { user: { select: { userCode: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    userCode: r.user?.userCode ?? null,
    amount: toNumber(r.amount),
    totalDebit: toNumber(r.totalDebit),
    mode: r.mode,
    beneficiaryName: r.beneficiaryName,
    accountLast4: r.accountLast4,
    providerReferenceId: r.providerReferenceId,
    providerTxnId: r.providerTxnId,
    failureReason: r.failureReason,
    processedAt: r.processedAt ? r.processedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export type ResolvePayoutAction = "recover" | "poll" | "force_paid" | "force_failed";

export type ResolvePayoutResult = {
  action: ResolvePayoutAction;
  status: PayoutStatus;
  recoveredReference?: string | null;
  changed: boolean;
};

/**
 * Operator resolution of a held (NEEDS_REVIEW) payout. Every path is idempotent
 * and keeps the double-spend-safe invariant: the hold is only RELEASED when the
 * bank definitively did NOT disburse.
 *
 *   recover      — auto-recover the rail reference + poll (no money unless the
 *                  rail reports a terminal state).
 *   poll         — operator supplies the real rail reference_id, then poll.
 *   force_paid   — operator confirmed (bank statement/UTR) the money DID leave:
 *                  capture the hold into a real DEBIT.
 *   force_failed — operator confirmed the money did NOT leave: release the hold
 *                  back to spendable.
 */
export async function resolveOnePayout(
  payoutRequestId: string,
  opts: {
    actorId: string;
    action: ResolvePayoutAction;
    reference?: string | null;
    utr?: string | null;
    note?: string | null;
  }
): Promise<ResolvePayoutResult> {
  const row = await prisma.payoutRequest.findUnique({ where: { id: payoutRequestId } });
  if (!row) throw new Error("Payout not found");
  if (row.status !== "NEEDS_REVIEW") {
    return { action: opts.action, status: row.status, changed: false };
  }

  await prisma.auditLog.create({
    data: {
      userId: opts.actorId,
      action: `payout.resolve.${opts.action}`,
      entity: "PayoutRequest",
      entityId: row.id,
      meta: {
        targetUserId: row.userId,
        reference: opts.reference ?? null,
        utr: opts.utr ?? null,
        note: opts.note ?? null,
      },
    },
  });

  if (opts.action === "poll" && opts.reference) {
    await prisma.payoutRequest.updateMany({
      where: { id: row.id, status: "NEEDS_REVIEW" },
      data: { providerTxnId: opts.reference },
    });
    await reconcilePayout(row.id);
  } else if (opts.action === "recover") {
    await reconcilePayout(row.id); // reconcile auto-recovers when ref is missing
  } else if (opts.action === "force_paid") {
    await finalizePayoutSuccess(row.id, {
      utr: opts.utr ?? null,
      providerTxnId: opts.reference ?? undefined,
      response: { operatorResolved: true, note: opts.note ?? null },
    });
  } else if (opts.action === "force_failed") {
    await finalizePayoutFailure(row.id, {
      failureReason: opts.note?.trim() || "Operator confirmed bank did not disburse",
      response: { operatorResolved: true, note: opts.note ?? null },
    });
  }

  const after = await prisma.payoutRequest.findUnique({
    where: { id: row.id },
    select: { status: true, providerTxnId: true },
  });
  return {
    action: opts.action,
    status: after?.status ?? row.status,
    recoveredReference: after?.providerTxnId ?? null,
    changed: (after?.status ?? row.status) !== "NEEDS_REVIEW",
  };
}

export { LedgerError };
