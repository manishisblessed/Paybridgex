import { handleSamedayWebhook } from "@/lib/partners/sameday-webhook";

/**
 * POST /api/webhooks/sameday
 *
 * Unified inbound receiver for EVERY Same Day webhook channel
 * (POS · Settlement · Payout · RechargeKit · BBPS-2/Pay2New). Configure this ONE
 * URL in the Same Day partner panel ("Add Endpoint") and tick the
 * "Events (POS · Settlement · Payout)", "RechargeKit (Credit Card)" and
 * "BBPS-2 / Pay2New" (`pay2new.cc.status`) channels — all endpoints share one
 * signing secret (SAMEDAY_WEBHOOK_SECRET).
 *
 * All verification, idempotency and dispatch live in handleSamedayWebhook so the
 * legacy /api/pos/webhook endpoint can delegate to the exact same pipeline.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return handleSamedayWebhook(req);
}
