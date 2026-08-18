import { Prisma, type PayoutRequest, type PayoutStatus, type ServiceCode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { captureHold, creditWallet, releaseHold, LedgerError } from "@/lib/ledger";
import { decryptField } from "@/lib/crypto/fieldEncryption";
import { toNumber, sub, round } from "@/lib/money";
import { creditServiceMargin, reverseServiceMargin } from "@/lib/commission/revenue";
import { getPartner, assertRealMoneyProvider } from "@/lib/partners";
import { enqueue, QUEUES } from "@/lib/queue";
import { emitWebhookEvent } from "@/lib/platform/webhooks";
import { logger } from "@/lib/logger";

/**
 * Shared, provider-agnostic payout lifecycle logic. Used by the queue worker,
 * the BulkPe webhook, and the reconciliation poller so that all three drive the
 * exact same idempotent state machine + ledger finalization.
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

// States that still hold reserved funds and may be finalized.
const HOLDABLE: PayoutStatus[] = ["APPROVED", "PROCESSING"];

const TERMINAL: PayoutStatus[] = ["SUCCESS", "FAILED", "REJECTED", "REVERSED"];

/** JSON-safe snapshot of a provider payload (never contains raw PII). */
function asJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return (value ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull;
}

/** Enqueue the worker job that actually calls BulkPe. */
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
  data: { utr?: string | null; bulkpeTxnId?: string | null; response?: unknown }
): Promise<{ finalized: boolean }> {
  const row = await prisma.payoutRequest.findUnique({ where: { id: payoutRequestId } });
  if (!row || TERMINAL.includes(row.status)) return { finalized: false };

  await prisma.$transaction(async (tx) => {
    const claim = await tx.payoutRequest.updateMany({
      where: { id: payoutRequestId, status: { in: HOLDABLE } },
      data: {
        status: "SUCCESS",
        utr: data.utr ?? row.utr ?? null,
        bulkpeTxnId: data.bulkpeTxnId ?? row.bulkpeTxnId ?? null,
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
        failureReason: data.reason ?? "Reversed by bank/BulkPe",
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

/** Build the decrypted beneficiary block for the provider call. */
function beneficiaryFor(row: PayoutRequest) {
  if (row.mode === "UPI") {
    return { name: row.beneficiaryName, vpa: decryptField(row.accountNumber) };
  }
  return {
    name: row.beneficiaryName,
    accountNumber: decryptField(row.accountNumber),
    ifsc: row.ifsc ? decryptField(row.ifsc) : undefined,
  };
}

/**
 * Worker entry for QUEUES.PAYOUT_INITIATE. Transitions APPROVED -> PROCESSING,
 * calls BulkPe with the unique reference_id, and finalizes immediately if the
 * provider returns a terminal state. Retry-safe: if already sent, it reconciles
 * instead of re-initiating.
 */
export async function processPayoutInitiate(payoutRequestId: string): Promise<void> {
  const row = await prisma.payoutRequest.findUnique({ where: { id: payoutRequestId } });
  if (!row) return;
  if (TERMINAL.includes(row.status)) return;
  if (row.status === "PENDING_APPROVAL" || row.status === "DRAFT") return; // not approved yet

  // Already handed to BulkPe on a previous attempt → reconcile, don't re-send.
  if (row.bulkpeTxnId) {
    await reconcilePayout(payoutRequestId);
    return;
  }

  // Claim APPROVED/PROCESSING -> PROCESSING (records processedAt once).
  const claim = await prisma.payoutRequest.updateMany({
    where: { id: payoutRequestId, status: { in: HOLDABLE } },
    data: { status: "PROCESSING", processedAt: row.processedAt ?? new Date() },
  });
  if (claim.count === 0) return;

  const user = await prisma.user.findUnique({
    where: { id: row.userId },
    select: { userCode: true },
  });

  const provider = getPartner("payout");
  // Never push real money through a mock in production. A mock "PAID" would
  // capture the hold (debit the user) without any bank transfer. Refuse instead
  // — the request stays PROCESSING (funds held) for ops/recon to resolve.
  assertRealMoneyProvider(
    provider,
    () => new Error("Payout rail resolved to MOCK in production — refusing to send")
  );
  const res = await provider.payout({
    idempotencyKey: row.bulkpeReferenceId,
    userId: row.userId,
    mode: row.mode,
    amount: toNumber(row.amount),
    beneficiary: beneficiaryFor(row),
    purpose: user?.userCode
      ? `Pay by NxtGenPay by RT Code - ${user.userCode}`
      : `Pay by NxtGenPay ${row.userId}`,
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
        referenceId: row.bulkpeReferenceId,
        provider: provider.name,
      },
      response: asJson(res.raw ?? res),
      bulkpeTxnId: res.ok ? res.data.payoutId || row.bulkpeTxnId : row.bulkpeTxnId,
    },
  });

  if (!res.ok) {
    await finalizePayoutFailure(payoutRequestId, {
      failureReason: `${res.code}: ${res.message}`,
      response: res.raw,
    });
    return;
  }

  if (res.data.status === "PAID") {
    await finalizePayoutSuccess(payoutRequestId, {
      utr: res.data.utr,
      bulkpeTxnId: res.data.payoutId,
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
 * Poll BulkPe for the terminal state of a single in-flight payout and finalize.
 * Safe fallback when a webhook is missed.
 */
export async function reconcilePayout(payoutRequestId: string): Promise<void> {
  const row = await prisma.payoutRequest.findUnique({ where: { id: payoutRequestId } });
  if (!row || !HOLDABLE.includes(row.status)) return;

  const provider = getPartner("payout");
  // A mock status poll unconditionally returns "PAID" — never let recon finalize
  // a phantom success (capture the hold with no real transfer) in production.
  assertRealMoneyProvider(
    provider,
    () => new Error("Payout rail resolved to MOCK in production — refusing to reconcile")
  );
  const lookupId = row.bulkpeTxnId || row.bulkpeReferenceId;
  const res = await provider.status(lookupId);
  if (!res.ok) return; // transient; try again on the next poll

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
 * Scan for payouts stuck in PROCESSING beyond `olderThanSec` and reconcile each.
 * Driven by the scheduled QUEUES.PAYOUT_RECONCILE job.
 */
export async function reconcileStuckPayouts(
  olderThanSec = 120,
  limit = 50
): Promise<{ scanned: number }> {
  const cutoff = new Date(Date.now() - olderThanSec * 1000);
  const rows = await prisma.payoutRequest.findMany({
    where: { status: "PROCESSING", processedAt: { lt: cutoff } },
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

export { LedgerError };
