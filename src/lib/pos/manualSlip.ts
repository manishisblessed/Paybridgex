import { prisma } from "@/lib/db";
import { handlePosCapture, handlePosReversal } from "@/lib/settlement/pos";
import { upsertMirrorFromWebhook } from "@/lib/pos/mirror";
import { resolvePosHolderForMachine } from "@/lib/pos/holder";
import { toNumber } from "@/lib/money";

/**
 * Manual POS slip lifecycle — the no-API (e.g. Yes Bank) acquirer flow.
 *
 * Acquirers without a capture webhook/API can't feed the automatic POS pipeline
 * (webhook/sweep → mirror → settlement). Instead the retailer uploads the
 * physical slip for a terminal ASSIGNED to them, and an admin verifies it. This
 * module owns the two admin actions and the ONE integration point that splices a
 * verified slip back into the SHARED settlement engine so payin, MDR pricing,
 * instant/T+1 settlement, commission and 2% TDS all behave exactly like an
 * API-sourced capture.
 */

/** File formats the retailer may upload as slip evidence. */
export const MANUAL_SLIP_FORMATS = ["jpg", "jpeg", "png", "pdf"] as const;
/** data: URL prefixes accepted for those formats. */
export const MANUAL_SLIP_DATAURL_RE =
  /^data:(image\/(png|jpe?g)|application\/pdf);base64,/;

/** Canonical settlement/mirror key for a slip — shared by mirror + settlement. */
export function manualSlipRef(tid: string, slipId: string): string {
  return `MPOS:${tid}:${slipId}`;
}

export class ManualSlipError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
    this.name = "ManualSlipError";
  }
}

export type ManualSlipStatus = "PENDING" | "APPROVED" | "REJECTED" | "REVERSED";

/**
 * Approve a PENDING slip (any admin — no second approval needed).
 *
 * Ordering is deliberate so nothing dangling is ever left behind on failure:
 *   1. handlePosCapture() prices MDR off the terminal's brand rate card (or the
 *      retailer's scheme) and creates the PENDING PosSettlementEntry. It does
 *      NOT move money or touch payin. If the capture can't be priced/settled
 *      (NO_SCHEME / SKIPPED) we abort BEFORE creating any display/payin state so
 *      the admin can fix the rate and re-approve.
 *   2. Only once the money side exists do we upsert the CAPTURED mirror row so
 *      the txn appears in POS Fleet and the company payin book is credited —
 *      matching the automatic flow's "payin at mirror ingest" contract.
 *   3. Stamp the slip APPROVED with its transactionRef + settlement entry id.
 */
export async function approveManualSlip(slipId: string, adminId: string) {
  const slip = await prisma.posManualSlip.findUnique({ where: { id: slipId } });
  if (!slip) throw new ManualSlipError("Slip not found", 404);
  if (slip.status !== "PENDING")
    throw new ManualSlipError(`Slip already ${slip.status.toLowerCase()}`, 409);

  // Re-validate the terminal is STILL assigned to the uploader and active — the
  // assignment could have been recalled between upload and review.
  const machine = await prisma.posMachine.findUnique({
    where: { id: slip.machineId },
    select: { tid: true, assignedUserId: true, status: true, brandId: true },
  });
  if (!machine || machine.assignedUserId !== slip.uploaderUserId)
    throw new ManualSlipError(
      "This terminal is no longer assigned to the retailer — reject the slip instead.",
      409
    );

  const transactionRef = manualSlipRef(slip.tid, slip.id);
  const grossAmount = toNumber(slip.grossAmount);
  const paymentMode = slip.paymentMode ?? "CARD";
  const capturedAt = slip.txnTime ?? new Date();

  // ATTRIBUTION GATE (same rule as the automatic pipeline — NO bypass): a slip
  // may only settle a swipe captured WHILE the terminal was held by the
  // uploader. A slip whose transaction time predates the assignment (or falls in
  // a previous holder's window) must NEVER settle to this retailer — reject it
  // so a pre-assignment swipe can't be credited through the manual path. We bind
  // to the EXACT machineId (PosMachine.tid is not unique) at capture time.
  const holderAtCapture = await resolvePosHolderForMachine(slip.machineId, capturedAt);
  if (holderAtCapture?.userId !== slip.uploaderUserId) {
    throw new ManualSlipError(
      "This slip's transaction date is before the terminal was assigned to the retailer (or falls in a previous holder's period), so it can't be settled to them. Correct the transaction date or handle it manually.",
      422
    );
  }

  // 1) Price + create the settlement entry via the SHARED engine. It re-resolves
  // the SAME holder-at-capture attribution (bound to the exact machineId), so the
  // manual path is governed by the identical gate as webhook/sweep captures.
  const capture = await handlePosCapture({
    transactionRef,
    machineId: slip.machineId,
    terminalId: slip.tid,
    grossAmount,
    paymentMode,
    cardType: slip.cardType ?? undefined,
    brandType: slip.brandType ?? undefined,
    capturedAt,
    // Honor the retailer's Instant/Next Day choice made at upload time. INSTANT
    // still respects the platform kill-switch + daily budget (falls back to T1).
    settlementModeOverride: slip.settlementPref === "INSTANT" ? "INSTANT" : "T1",
  });

  if (capture.status === "NO_SCHEME")
    throw new ManualSlipError(
      "Can't price this terminal yet — add a brand MDR rate (or assign the retailer a scheme) for it, then approve again.",
      422
    );
  if (capture.status === "SKIPPED")
    throw new ManualSlipError(
      "Capture not settleable (retailer inactive or amount resolves to zero net).",
      422
    );

  // 2) Surface it in POS Fleet + credit company payin (first CAPTURED).
  await upsertMirrorFromWebhook({
    transactionRef,
    terminalId: slip.tid,
    grossAmount,
    paymentMode,
    status: "CAPTURED",
    rrn: slip.rrn,
    authCode: slip.authCode,
    cardType: slip.cardType,
    cardBrand: slip.brandType,
    txnTime: capturedAt,
    source: "MANUAL",
    raw: { source: "MANUAL_SLIP", slipId: slip.id },
  });

  // 3) Link the slip to what it became.
  const entry = await prisma.posSettlementEntry.findUnique({
    where: { transactionRef },
    select: { id: true },
  });
  const updated = await prisma.posManualSlip.update({
    where: { id: slip.id },
    data: {
      status: "APPROVED",
      transactionRef,
      settlementEntryId: entry?.id ?? null,
      reviewedById: adminId,
      reviewedAt: new Date(),
      rejectionReason: null,
    },
  });

  await auditManualSlip(adminId, "pos.manual_slip.approve", slip.id, {
    transactionRef,
    captureStatus: capture.status,
    grossAmount,
    netAmount: capture.netAmount ?? null,
    settlementEntryId: entry?.id ?? null,
  });

  return { slip: updated, capture };
}

/** Reject a PENDING slip with a reason shown to the retailer for re-upload. */
export async function rejectManualSlip(slipId: string, adminId: string, reason: string) {
  const trimmed = reason.trim();
  if (!trimmed) throw new ManualSlipError("A rejection reason is required.", 400);

  const slip = await prisma.posManualSlip.findUnique({ where: { id: slipId } });
  if (!slip) throw new ManualSlipError("Slip not found", 404);
  if (slip.status !== "PENDING")
    throw new ManualSlipError(`Slip already ${slip.status.toLowerCase()}`, 409);

  const updated = await prisma.posManualSlip.update({
    where: { id: slip.id },
    data: {
      status: "REJECTED",
      rejectionReason: trimmed,
      reviewedById: adminId,
      reviewedAt: new Date(),
    },
  });

  await auditManualSlip(adminId, "pos.manual_slip.reject", slip.id, { reason: trimmed });

  return { slip: updated };
}

/**
 * Reverse an APPROVED slip's settlement (master-admin / admin only).
 *
 * External POS has no partner API to signal a void/refund, so a mistaken
 * approval (or an acquirer-side chargeback learned out-of-band) is corrected
 * here. It routes through the SHARED reversal engine (`handlePosReversal`), so
 * it behaves EXACTLY like an API-sourced reversal and never touches settlement
 * math:
 *   • PENDING (unswept T+1) entry → cancelled (moved to REVERSED); no money moved.
 *   • SETTLED entry             → entry moved to REVERSED, the display mirror
 *     flipped to VOIDED, and it surfaces on the POS Reversals desk flagged for
 *     manual clawback (wallet balances are non-negative — we NEVER auto-debit).
 * Fully idempotent (the reversal engine dedupes on the settlement entry state).
 */
export async function reverseManualSlip(slipId: string, adminId: string, reason: string) {
  const trimmed = reason.trim();
  if (!trimmed) throw new ManualSlipError("A reversal reason is required.", 400);

  const slip = await prisma.posManualSlip.findUnique({ where: { id: slipId } });
  if (!slip) throw new ManualSlipError("Slip not found", 404);
  if (slip.status === "REVERSED")
    throw new ManualSlipError("Slip already reversed", 409);
  if (slip.status !== "APPROVED" || !slip.transactionRef)
    throw new ManualSlipError("Only an approved slip can be reversed.", 409);

  // Route through the shared reversal engine (idempotent). VOIDED = the swipe is
  // being cancelled/annulled (as opposed to a partial customer REFUND).
  const reversal = await handlePosReversal({
    transactionRef: slip.transactionRef,
    status: "VOIDED",
    reason: trimmed,
    source: "MANUAL",
  });

  // Stamp the slip REVERSED and record the note. `reviewedById/reviewedAt` are
  // intentionally left as the APPROVER's — the reversing actor + full detail are
  // captured in the AuditLog below (and on the settlement entry / mirror).
  const updated = await prisma.posManualSlip.update({
    where: { id: slip.id },
    data: { status: "REVERSED", rejectionReason: trimmed },
  });

  await auditManualSlip(adminId, "pos.manual_slip.reverse", slip.id, {
    transactionRef: slip.transactionRef,
    outcome: reversal.outcome,
    wasSettled: reversal.wasSettled ?? false,
    netAmount: reversal.netAmount ?? null,
    reason: trimmed,
  });

  return { slip: updated, reversal };
}

async function auditManualSlip(
  adminId: string,
  action: string,
  entityId: string,
  meta: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: { userId: adminId, action, entity: "PosManualSlip", entityId, meta: meta as never },
    });
  } catch {
    // Audit is best-effort — never fail the review on a log write.
  }
}
