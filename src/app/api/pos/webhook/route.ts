import { NextResponse } from "next/server";
import { handlePosCapture } from "@/lib/settlement/pos";
import { prisma } from "@/lib/db";
import { lookupBin, classificationFromBin } from "@/lib/pos/binLookup";
import { isCardClassificationEnabled } from "@/lib/settings";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * POST /api/pos/webhook
 *
 * Webhook endpoint for Same Day Solution POS transaction notifications.
 * When a transaction is CAPTURED, this triggers the settlement flow
 * (instant or T+1 depending on the retailer's configuration).
 *
 * The webhook payload shape follows Same Day's documentation. If your
 * provider uses a different shape, adapt the mapping below.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Same Day webhook sends nested data in various shapes; normalize.
  const txnData = (body.data ?? body) as Record<string, unknown>;

  const status = String(txnData.status ?? txnData.txn_status ?? "").toUpperCase();
  if (status !== "CAPTURED" && status !== "SUCCESS") {
    // Only process captured/successful transactions.
    return NextResponse.json({ ok: true, action: "ignored", status });
  }

  const transactionRef = String(
    txnData.transaction_id ?? txnData.txn_id ?? txnData.id ?? ""
  );
  if (!transactionRef) {
    return NextResponse.json({ error: "Missing transaction reference" }, { status: 400 });
  }

  const grossAmount = Number(txnData.amount ?? txnData.txn_amount ?? 0);
  if (grossAmount <= 0) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  const terminalId = String(txnData.terminal_id ?? txnData.tid ?? "");
  const paymentMode = String(txnData.payment_mode ?? txnData.mode ?? "CARD").toUpperCase();
  // Card dimensions (optional in the payload) drive company/card-wise MDR.
  const cardType = String(txnData.card_type ?? txnData.cardType ?? "").toUpperCase() || undefined;
  const brandType = String(txnData.brand_type ?? txnData.card_brand ?? txnData.brand ?? "").toUpperCase() || undefined;
  let classification = String(txnData.card_classification ?? txnData.classification ?? "").toUpperCase() || undefined;
  // Acquiring / service provider (RAZORPAY | PAYTM | PINELAB | ...) that handled
  // the swipe. Falls back to the machine's configured provider in the engine.
  const providerRaw = String(txnData.provider ?? txnData.acquirer ?? txnData.gateway ?? "").trim();
  const provider = providerRaw ? providerRaw.toUpperCase() : undefined;

  // BIN enrichment: when the acquirer (e.g. Teachway/Razorpay) doesn't provide
  // card classification, look it up via eKYC Hub so MDR can be priced accurately.
  const cardNumber = String(txnData.card_number ?? txnData.cardNumber ?? "").replace(/\D/g, "");
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
      },
    },
  });

  return NextResponse.json({ ok: true, ...result });
}
