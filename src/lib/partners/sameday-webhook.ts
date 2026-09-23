import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  verifySamedayWebhook,
  canonicalPosCaptureRef,
  type WebhookVerifyResult,
} from "./sameday-pos";
import { handlePosCapture, handlePosReversal } from "@/lib/settlement/pos";
import { lookupBin, classificationFromBin } from "@/lib/pos/binLookup";
import { isCardClassificationEnabled } from "@/lib/settings";
import { upsertMirrorFromWebhook } from "@/lib/pos/mirror";
import { reconcilePayoutFromWebhook } from "@/lib/payout/service";
import { reconcileRechargekitFromWebhook } from "@/lib/recon/rechargekit";

/**
 * Unified inbound receiver for EVERY Same Day webhook channel
 * (POS · Settlement · Payout · RechargeKit), all signed with one shared secret
 * and routed by the `X-Sameday-Event` header.
 *
 * Pipeline (identical for every channel):
 *   1. Read the RAW body first — HMAC is computed over the exact bytes.
 *   2. Verify HMAC-SHA256(secret, `${timestamp}.${rawBody}`); reject stale/invalid.
 *   3. Dedupe on X-Sameday-Delivery (durable PosWebhookDelivery table).
 *   4. Dispatch by event/shape:
 *        • POS               → handlePosCapture / handlePosReversal (+ mirror).
 *        • Settlement/Payout → correlate to a PayoutRequest, RE-FETCH the rail
 *                              status, then finalise/reverse.
 *        • RechargeKit       → correlate to a Transaction, RE-FETCH the rail
 *                              status, then settle/refund.
 *   5. Always return 2xx once accepted; non-2xx makes Same Day retry.
 *
 * For money movement the webhook body is a TRIGGER, never the source of truth:
 * the settlement/RechargeKit branches re-poll the provider's own status API
 * before touching the ledger, so a forged or stale payload can never move money.
 */

const log = logger.child({ module: "sameday-webhook" });

const REVERSED_STATUSES = new Set(["FAILED", "VOIDED", "REFUNDED"]);

export async function handleSamedayWebhook(req: Request): Promise<Response> {
  // ── 1. Read the RAW body first — HMAC must be over the exact bytes.
  const rawBody = await req.text();
  const signature = req.headers.get("x-sameday-signature");
  const timestamp = req.headers.get("x-sameday-timestamp");
  const deliveryId = req.headers.get("x-sameday-delivery");
  const eventHeader = req.headers.get("x-sameday-event");

  // ── 2. Verify signature (constant-time, replay-guarded).
  const verdict: WebhookVerifyResult = verifySamedayWebhook(rawBody, signature, timestamp);
  if (verdict === "STALE") {
    return NextResponse.json({ error: "Stale timestamp" }, { status: 400 });
  }
  if (verdict === "INVALID") {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  const verified = verdict === "VALID";

  // ── Parse JSON body.
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── 3. Idempotency: dedupe on X-Sameday-Delivery (stable across retries and
  //       shared across every channel — delivery ids are globally unique).
  if (deliveryId) {
    const existing = await prisma.posWebhookDelivery.findUnique({ where: { deliveryId } });
    if (existing) {
      return NextResponse.json({ ok: true, action: "duplicate" }, { status: 200 });
    }
    try {
      await prisma.posWebhookDelivery.create({
        data: { deliveryId, event: eventHeader ?? String(body.event ?? "unknown") },
      });
    } catch (e) {
      // P2002 = unique-constraint race: another request beat us — treat as dup.
      if ((e as { code?: string }).code === "P2002") {
        return NextResponse.json({ ok: true, action: "duplicate" }, { status: 200 });
      }
      throw e;
    }
  }

  const eventType = (eventHeader ?? String(body.event ?? "")).toLowerCase();

  // ── 4a. POS channel ───────────────────────────────────────────────────────
  if (isPosEvent(eventType, body)) {
    return processSamedayPosEvent(body, { verified, deliveryId, eventHeader });
  }

  // ── 4b. Settlement / Payout / RechargeKit ─────────────────────────────────
  // Correlate the event to our row by the references it carries, then re-fetch
  // the authoritative status from the provider API before finalising.
  const refs = collectRefs(body);
  const reversal = /revers|return|refund|chargeback/.test(eventType);

  // Payout / Settlement (retailer bank payouts disburse over the settlement rail).
  const payout = await reconcilePayoutFromWebhook(refs, { reversal, response: body });
  if (payout.matched) {
    await auditWebhook(
      { channel: "payout", eventType, action: payout.action, verified, deliveryId },
      "PayoutRequest",
      payout.payoutRequestId
    );
    return NextResponse.json({ ok: true, channel: "payout", ...payout });
  }

  // RechargeKit CC-2.
  const rk = await reconcileRechargekitFromWebhook(refs);
  if (rk.matched) {
    await auditWebhook(
      { channel: "rechargekit", eventType, outcome: rk.outcome, verified, deliveryId },
      "Transaction"
    );
    return NextResponse.json({ ok: true, channel: "rechargekit", ...rk });
  }

  // ── 4c. Unknown / uncorrelated → ACK so Same Day stops retrying.
  log.warn(
    { action: "webhook.sameday_unmatched", eventType, refs, deliveryId },
    "unmatched Same Day webhook"
  );
  await auditWebhook({ channel: "unmatched", eventType, refs, verified, deliveryId });
  return NextResponse.json({ ok: true, action: "ignored" }, { status: 200 });
}

// ---------------------------------------------------------------------------
// Channel detection & reference extraction
// ---------------------------------------------------------------------------

/** POS events are name-prefixed `pos.*`, carry a terminal id / mappedStatus, or
 *  a reversal `action: "remove"`. Settlement/RechargeKit payloads never do. */
function isPosEvent(eventType: string, body: Record<string, unknown>): boolean {
  if (eventType.startsWith("pos")) return true;
  if (String(body.action ?? "").toLowerCase() === "remove") return true;
  return "mappedStatus" in body || "tid" in body || "rrNumber" in body;
}

/** Gather every candidate correlation id a non-POS payload might carry. */
function collectRefs(body: Record<string, unknown>): string[] {
  const keys = [
    "reference_id", "referenceId",
    "txn_id", "txnId",
    "request_id", "requestId",
    "order_id", "orderId",
    "id",
  ];
  const out: string[] = [];
  for (const k of keys) {
    const v = body[k];
    if (typeof v === "string" && v.length > 0) out.push(v);
    else if (typeof v === "number") out.push(String(v));
  }
  return out;
}

async function auditWebhook(
  meta: Record<string, unknown>,
  entity?: string,
  entityId?: string
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: "webhook.sameday",
        entity: entity ?? null,
        entityId: entityId ?? null,
        meta: meta as Prisma.InputJsonValue,
      },
    });
  } catch {
    // Never fail a webhook on an audit write.
  }
}

// ---------------------------------------------------------------------------
// POS channel processing (ported from /api/pos/webhook so both routes share it)
// ---------------------------------------------------------------------------

async function processSamedayPosEvent(
  txnData: Record<string, unknown>,
  ctx: { verified: boolean; deliveryId: string | null; eventHeader: string | null }
): Promise<Response> {
  const { verified, deliveryId, eventHeader } = ctx;

  // ── Reversal event: pos.transaction.reversed ────────────────────────────
  // A previously-CAPTURED swipe was voided/failed/refunded at the terminal.
  const eventType = (eventHeader ?? String(txnData.event ?? "")).toLowerCase();
  if (
    eventType === "pos.transaction.reversed" ||
    String(txnData.action ?? "").toLowerCase() === "remove"
  ) {
    const terminalId = String(txnData.terminal_id ?? txnData.tid ?? "");
    const rrn = String(txnData.rrn ?? txnData.rrNumber ?? "");
    const reversalRef = canonicalPosCaptureRef({
      rrn,
      terminalId,
      fallbackId: String(txnData.txn_id ?? txnData.txnId ?? ""),
    });
    if (!reversalRef) {
      return NextResponse.json({ error: "Missing transaction reference" }, { status: 400 });
    }

    const rawStatus = String(txnData.status ?? "").toUpperCase();
    const newStatus: "VOIDED" | "REFUNDED" =
      rawStatus === "REFUNDED" ? "REFUNDED" : "VOIDED";

    const wasSettledFlag = Boolean(txnData.was_settled);
    const result = await handlePosReversal({
      transactionRef: reversalRef,
      status: newStatus,
      reason: String(txnData.reason ?? txnData.reversal_reason ?? "").trim() || null,
      reversedAt: (txnData.reversed_at as string | undefined) ?? null,
      source: "WEBHOOK",
    });

    await prisma.auditLog.create({
      data: {
        action: "pos.webhook.reversal",
        entity: "PosSettlementEntry",
        entityId: reversalRef,
        meta: {
          status: newStatus,
          rawStatus,
          outcome: result.outcome,
          wasSettled: result.wasSettled ?? false,
          wasSettledUpstream: wasSettledFlag,
          needsManualReview: wasSettledFlag || result.wasSettled,
          previousStatus: String(txnData.previous_status ?? "") || null,
          reason: String(txnData.reason ?? "") || null,
          terminalId: terminalId || null,
          signatureVerified: verified,
          deliveryId: deliveryId ?? null,
        },
      },
    });

    return NextResponse.json({ ok: true, action: "reversed", ...result });
  }

  // ── Normal capture: "pos.transaction" ───────────────────────────────────
  const mappedStatus = String(txnData.mappedStatus ?? "").toUpperCase();
  if (mappedStatus !== "CAPTURED") {
    return NextResponse.json({ ok: true, action: "ignored", status: mappedStatus });
  }

  const rawCaptureStatus = String(txnData.status ?? "").toUpperCase();
  if (REVERSED_STATUSES.has(rawCaptureStatus) || txnData.reversed_at != null) {
    return NextResponse.json({ ok: true, action: "ignored", reason: "reversed upstream" });
  }

  const terminalId = String(txnData.tid ?? "");
  const rrn = String(txnData.rrNumber ?? txnData.rrn ?? "");
  const transactionRef = canonicalPosCaptureRef({
    rrn,
    terminalId,
    fallbackId: String(txnData.txnId ?? ""),
  });
  if (!transactionRef) {
    return NextResponse.json({ error: "Missing transaction reference" }, { status: 400 });
  }

  // `amount` is an integer in PAISE (e.g. 129998 = ₹1299.98) → convert to rupees.
  const grossAmount = Number(txnData.amount ?? 0) / 100;
  if (!(grossAmount > 0)) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }
  const paymentMode = "CARD";
  const cardType = String(txnData.paymentCardType ?? "").toUpperCase() || undefined;
  const brandType = String(txnData.paymentCardBrand ?? "").toUpperCase() || undefined;
  let classification = String(txnData.cardClassification ?? "").toUpperCase() || undefined;
  const providerRaw = String(txnData.acquiringBank ?? "").trim();
  const provider = providerRaw ? providerRaw.toUpperCase() : undefined;

  // BIN enrichment: derive card classification from masked PAN when not provided.
  const cardNumber = String(txnData.formattedPan ?? txnData.maskedCardNumber ?? "").replace(/\D/g, "");
  if (!classification && cardNumber.length >= 6 && paymentMode === "CARD" && (await isCardClassificationEnabled())) {
    try {
      const binData = await lookupBin(cardNumber);
      if (binData) {
        classification = classificationFromBin(binData) ?? classification;
      }
    } catch {
      // Non-blocking: settle without classification if BIN lookup fails
    }
  }

  // The partner's reported swipe time — the ANCHOR for holder attribution in
  // the settlement engine (who owned the terminal WHEN it was swiped). Falls
  // back to now (real-time capture) when the feed omits a usable timestamp.
  const maskedPan = String(txnData.formattedPan ?? txnData.maskedCardNumber ?? "").trim() || null;
  const capturedAt = (() => {
    for (const raw of [txnData.txnTime, txnData.transactionTime, txnData.txnDate, txnData.createdAt]) {
      if (raw == null) continue;
      const d = new Date(String(raw));
      if (!Number.isNaN(d.getTime())) return d;
    }
    return null;
  })();

  const result = await handlePosCapture({
    transactionRef,
    terminalId: terminalId || undefined,
    grossAmount,
    paymentMode,
    provider,
    cardType,
    brandType,
    classification,
    capturedAt: capturedAt ?? undefined,
  });

  // Mirror the capture into the display read-model. Best-effort.
  try {
    await upsertMirrorFromWebhook({
      transactionRef,
      terminalId,
      grossAmount,
      paymentMode,
      status: "CAPTURED",
      rrn: rrn || null,
      cardType,
      cardBrand: brandType,
      cardClassification: classification ?? null,
      cardNumber: maskedPan,
      acquiringBank: provider ?? null,
      authCode: String(txnData.authCode ?? txnData.authcode ?? "").trim() || null,
      customerName: String(txnData.customerName ?? txnData.cardHolderName ?? "").trim() || null,
      mid: String(txnData.mid ?? "").trim() || null,
      txnTime: capturedAt,
      raw: txnData,
    });
  } catch {
    // Non-blocking: the reconciliation sweep will pick this capture up.
  }

  // Log the webhook for audit.
  await prisma.auditLog.create({
    data: {
      action: "pos.webhook.capture",
      entity: "PosSettlementEntry",
      entityId: transactionRef,
      meta: {
        status: result.status,
        grossAmount,
        netAmount: result.netAmount ?? null,
        mdrAmount: result.mdrAmount ?? null,
        mode: result.mode ?? null,
        terminalId: terminalId || null,
        paymentMode,
        provider: provider ?? null,
        signatureVerified: verified,
        deliveryId: deliveryId ?? null,
      },
    },
  });

  return NextResponse.json({ ok: true, ...result });
}
