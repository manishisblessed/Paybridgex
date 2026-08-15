import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyBulkpeWebhook } from "@/lib/partners/bulkpe";
import { settleTopup } from "@/lib/wallet/topup";
import { settlePgCollect, isPgCollectRef } from "@/lib/wallet/pgCollect";

/**
 * BulkPe Simple PG (collect) webhook — wallet top-up + PG collection auto-credit.
 *
 * Configure in the BulkPe dashboard alongside the payout webhook:
 *   URL    : https://app.paybridgex.in/api/webhooks/bulkpe-pg
 *   Secret : BULKPE_WEBHOOK_SECRET (env)
 *
 * Defense in depth: the webhook body is only used to LOCATE our transaction
 * (referenceId). The actual settlement re-verifies the payment state with
 * BulkPe via pg1CheckTxnStatus before any wallet credit — so even a replayed
 * or forged-but-signed payload cannot mint money.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

function pick(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature =
    req.headers.get("x-bulkpe-signature") ||
    req.headers.get("x-webhook-signature") ||
    req.headers.get("signature");

  if (!verifyBulkpeWebhook(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const data = (payload.data && typeof payload.data === "object"
    ? (payload.data as Record<string, unknown>)
    : payload) as Record<string, unknown>;

  const referenceId = pick(data, ["referenceId", "reference_id"]);

  // We settle two kinds of reference: `TOPUP…` (wallet top-up) and `PGC…` (a
  // retailer PG collection). Acknowledge everything else so BulkPe stops
  // retrying payloads we cannot act on.
  const isTopup = !!referenceId && referenceId.startsWith("TOPUP");
  const isCollect = isPgCollectRef(referenceId);
  if (!referenceId || (!isTopup && !isCollect)) {
    return NextResponse.json({ ok: true, matched: false });
  }

  await prisma.auditLog.create({
    data: {
      action: "webhook.bulkpe_pg",
      entity: "Transaction",
      entityId: referenceId,
      meta: { status: pick(data, ["status", "state"]) ?? null, kind: isTopup ? "TOPUP" : "PG_COLLECT" },
    },
  });

  try {
    const result = isTopup
      ? await settleTopup(referenceId)
      : await settlePgCollect(referenceId);
    return NextResponse.json({ ok: true, matched: true, status: result.status });
  } catch {
    // Unknown reference or provider hiccup — acknowledge; the user-facing
    // status poll and recon will converge the state.
    return NextResponse.json({ ok: true, matched: false });
  }
}
