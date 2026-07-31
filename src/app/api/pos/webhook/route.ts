import { NextResponse } from "next/server";
import { handlePosCapture } from "@/lib/settlement/pos";
import { verifySamedayPosWebhook, canonicalPosCaptureRef } from "@/lib/partners/sameday-pos";
import { prisma } from "@/lib/db";
import { lookupBin, classificationFromBin } from "@/lib/pos/binLookup";
import { isCardClassificationEnabled } from "@/lib/settings";
import { upsertMirrorFromWebhook } from "@/lib/pos/mirror";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * POST /api/pos/webhook
 *
 * Webhook endpoint for Same Day Solution POS transaction notifications.
 * When a transaction is CAPTURED, this triggers the settlement flow
 * (instant or T+1 depending on the retailer's configuration).
 *
 * Security: the raw body is HMAC-verified against SAMEDAY_POS_WEBHOOK_SECRET
 * before it is trusted. While that secret is unset (bootstrap phase, before
 * Same Day supplies it) the request is accepted but flagged unverified so
 * captures keep saving; once the secret is set, an invalid/absent signature is
 * rejected 401.
 *
 * The webhook payload shape follows Same Day's documentation. If your
 * provider uses a different shape, adapt the mapping below.
 */
export async function POST(req: Request) {
  // Read the RAW body first — HMAC must be computed over the exact bytes sent.
  const rawBody = await req.text();
  const signature = req.headers.get("x-sameday-signature");
  const timestamp = req.headers.get("x-sameday-timestamp");
  // Stable across retries — Same Day's idempotency id for the delivery.
  const deliveryId = req.headers.get("x-sameday-delivery");

  const verdict = verifySamedayPosWebhook(rawBody, signature, timestamp);
  if (verdict === false) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  const verified = verdict === true;

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Same Day sends a FLAT payload (no {event,data} wrapper).
  const txnData = body;

  // `mappedStatus` is the normalized lifecycle status (CAPTURED | FAILED |
  // PENDING); the raw `status` is the acquirer status (e.g. AUTHORIZED). Same
  // Day fires one callback on authorize and one on capture — only settle the
  // capture. Everything else is acknowledged so retries stop.
  const mappedStatus = String(txnData.mappedStatus ?? "").toUpperCase();
  if (mappedStatus !== "CAPTURED") {
    return NextResponse.json({ ok: true, action: "ignored", status: mappedStatus });
  }

  const terminalId = String(txnData.tid ?? "");
  // Canonical, cross-path idempotency ref (RRN-based) so this webhook and the
  // ingest sweep converge on the SAME transactionRef for one physical swipe —
  // the @unique constraint then makes a double settlement/commission impossible.
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
  // Card dimensions (optional in the payload) drive company/card-wise MDR.
  const cardType = String(txnData.paymentCardType ?? "").toUpperCase() || undefined;
  const brandType = String(txnData.paymentCardBrand ?? "").toUpperCase() || undefined;
  let classification = String(txnData.cardClassification ?? "").toUpperCase() || undefined;
  // Acquiring bank / provider that handled the swipe. Falls back to the
  // machine's configured provider in the engine when absent.
  const providerRaw = String(txnData.acquiringBank ?? "").trim();
  const provider = providerRaw ? providerRaw.toUpperCase() : undefined;

  // BIN enrichment: when the feed omits card classification, derive it from the
  // (masked) PAN's leading BIN digits via eKYC Hub so MDR is priced accurately.
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

  // Mirror the capture into the display read-model so the dashboard feed shows
  // it instantly (the periodic sweep later reconciles/completes it). Masked PAN
  // only, exactly what the feed returns. Best-effort: a mirror write must never
  // fail the webhook or block settlement.
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
