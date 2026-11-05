/**
 * POST /api/webhooks/chagans-pg
 *
 * Receives payment capture notifications from Chagans PG (both Comet and Star
 * gateways — they share the same webhook format and IP range).
 *
 * Security:
 *   1. Source IP must be in the Chagans whitelist (103.160.106.129,
 *      103.160.160.129, 34.126.212.125 + env-override CHAGAN_WEBHOOK_IPS).
 *   2. Payload is parsed defensively — unknown shapes → 200 + logged, not 4xx
 *      (Chagans retries on non-200; logging avoids an infinite storm).
 *
 * Paybridgex server IP to whitelist with Chagans: 13.202.49.156
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseChagansWebhook, isChagansWebhookIp } from "@/lib/partners/chagans-pg";
import { settleTopup } from "@/lib/wallet/topup";
import { clientIp } from "@/lib/security/audit";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ip = clientIp(req);

  // ── IP allowlist ──────────────────────────────────────────────────────────
  if (!isChagansWebhookIp(ip)) {
    logger.warn({ ip }, "chagans-pg webhook: rejected — unknown source IP");
    // Return 403 so our infra logs the attempt, but DON'T expose details.
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    logger.warn({ ip }, "chagans-pg webhook: unparseable JSON");
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const parsed = parseChagansWebhook(body);
  logger.info(
    { ip, orderId: parsed.orderId, status: parsed.status, amount: parsed.amount },
    "chagans-pg webhook received"
  );

  // ── Resolve our transaction by Chagans' orderId ───────────────────────────
  // Chagans echoes the orderId (their reference) not our refId, so we look up
  // by partnerTxnId which we persisted on the Transaction row at initiate time.
  if (!parsed.orderId) {
    logger.warn({ body }, "chagans-pg webhook: no orderId in payload — ignoring");
    return NextResponse.json({ ok: true, note: "no_order_id" });
  }

  const txn = await prisma.transaction.findFirst({
    where: {
      partnerTxnId: parsed.orderId,
      service: "WALLET_TOPUP",
    },
  });

  if (!txn) {
    // May be a test ping or a webhook for a transaction created before this
    // integration went live.  Log it and ACK so Chagans stops retrying.
    logger.warn({ orderId: parsed.orderId }, "chagans-pg webhook: no matching transaction");
    return NextResponse.json({ ok: true, note: "txn_not_found" });
  }

  // ── Settle ────────────────────────────────────────────────────────────────
  try {
    const result = await settleTopup(txn.refId, {
      status: parsed.status === "PAID"    ? "PAID" :
              parsed.status === "FAILED"  ? "FAILED" : "EXPIRED",
      amount: parsed.amount ?? Number(txn.amount),
      // Use Chagans' transactionId (their numeric ref) as the providerRef for audit
      reference: parsed.transactionId ?? parsed.orderId,
      paymentMode: parsed.paymentMode,
    });

    logger.info(
      { refId: txn.refId, status: result.status, net: result.net },
      "chagans-pg webhook: settled"
    );

    return NextResponse.json({ ok: true, status: result.status });
  } catch (err) {
    logger.error({ err, refId: txn.refId }, "chagans-pg webhook: settle threw");
    // Return 500 so Chagans retries (idempotent settle handles duplicates).
    return NextResponse.json({ ok: false, error: "settle_failed" }, { status: 500 });
  }
}

