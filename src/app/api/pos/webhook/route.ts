import { NextResponse } from "next/server";
import { handlePosCapture, handlePosReversal } from "@/lib/settlement/pos";
import { verifySamedayPosWebhook, canonicalPosCaptureRef } from "@/lib/partners/sameday-pos";
import type { WebhookVerifyResult } from "@/lib/partners/sameday-pos";
import { prisma } from "@/lib/db";
import { lookupBin, classificationFromBin } from "@/lib/pos/binLookup";
import { isCardClassificationEnabled } from "@/lib/settings";
import { upsertMirrorFromWebhook } from "@/lib/pos/mirror";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const REVERSED_STATUSES = new Set(["FAILED", "VOIDED", "REFUNDED"]);

/**
 * POST /api/pos/webhook
 *
 * Webhook endpoint for Same Day Solution POS transaction notifications.
 *
 * Handles two event types:
 *   - "pos.transaction"          — normal capture notification (existing flow)
 *   - "pos.transaction.reversed" — a prior CAPTURED swipe was voided/failed/refunded
 *
 * Security:
 *   1. Raw body read BEFORE JSON parsing (HMAC over exact bytes).
 *   2. Stale timestamps (|now − X-Sameday-Timestamp| > 300s) → 400.
 *   3. HMAC-SHA256 signature verified (constant-time) → 401 on mismatch.
 *   4. Idempotency on X-Sameday-Delivery (durable PosWebhookDelivery table).
 *   5. Always returns 2xx once processed; non-2xx triggers Same Day retries.
 */
export async function POST(req: Request) {
  // ── 1. Read the RAW body first — HMAC must be computed over the exact bytes.
  const rawBody = await req.text();
  const signature = req.headers.get("x-sameday-signature");
  const timestamp = req.headers.get("x-sameday-timestamp");
  const deliveryId = req.headers.get("x-sameday-delivery");
  const eventHeader = req.headers.get("x-sameday-event");

  // ── 2–3. Verify signature with granular rejection.
  const verdict: WebhookVerifyResult = verifySamedayPosWebhook(rawBody, signature, timestamp);
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

  // ── 4. Idempotency: dedupe on X-Sameday-Delivery (stable across retries).
  if (deliveryId) {
    const existing = await prisma.posWebhookDelivery.findUnique({
      where: { deliveryId },
    });
    if (existing) {
      return NextResponse.json({ ok: true, action: "duplicate" }, { status: 200 });
    }
    // Persist BEFORE processing so a crash mid-flight doesn't double-process
    // on the retry (the business logic is idempotent anyway, but this is belt
    // and suspenders).
    try {
      await prisma.posWebhookDelivery.create({
        data: {
          deliveryId,
          event: eventHeader ?? String(body.event ?? "unknown"),
        },
      });
    } catch (e) {
      // P2002 = unique constraint race: another request beat us — treat as duplicate.
      if ((e as { code?: string }).code === "P2002") {
        return NextResponse.json({ ok: true, action: "duplicate" }, { status: 200 });
      }
      throw e;
    }
  }

  // Same Day sends a FLAT payload (no {event,data} wrapper).
  const txnData = body;

  // ── Reversal event: pos.transaction.reversed ────────────────────────────
  // A previously-CAPTURED swipe was voided/failed/refunded at the terminal.
  // ANY "pos.transaction.reversed" with action "remove" is treated as a reversal
  // regardless of the specific status value (FAILED | VOIDED | REFUNDED).
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

    // Map the terminal status to our internal reversal status.
    // FAILED, VOIDED, and REFUNDED are all treated as reversals.
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
  // `mappedStatus` is the normalized lifecycle status (CAPTURED | FAILED |
  // PENDING); only settle captures. Everything else is acked so retries stop.
  // Additionally, reject any capture whose status is FAILED/VOIDED/REFUNDED or
  // has a non-null reversed_at — these are never settleable.
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

  const result = await handlePosCapture({
    transactionRef,
    terminalId: terminalId || undefined,
    grossAmount,
    paymentMode,
    provider,
    cardType,
    brandType,
    classification,
  });

  // Mirror the capture into the display read-model. Best-effort: a mirror write
  // must never fail the webhook or block settlement.
  const maskedPan = String(txnData.formattedPan ?? txnData.maskedCardNumber ?? "").trim() || null;
  const capturedAt = (() => {
    for (const raw of [txnData.txnTime, txnData.transactionTime, txnData.txnDate, txnData.createdAt]) {
      if (raw == null) continue;
      const d = new Date(String(raw));
      if (!Number.isNaN(d.getTime())) return d;
    }
    return null;
  })();
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
