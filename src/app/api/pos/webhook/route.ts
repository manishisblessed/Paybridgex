import { handleSamedayWebhook } from "@/lib/partners/sameday-webhook";

/**
 * POST /api/pos/webhook  (legacy alias)
 *
 * Same Day POS transaction notifications. This endpoint now delegates to the
 * unified Same Day receiver (src/lib/partners/sameday-webhook.ts) so POS shares
 * the exact same verify → dedupe → dispatch pipeline as Settlement, Payout and
 * RechargeKit. Kept for backward compatibility with any Same Day configuration
 * still pointed here; new deployments should register /api/webhooks/sameday.
 *
 * Behaviour is unchanged for POS:
 *   - "pos.transaction"          → capture settlement (+ mirror upsert)
 *   - "pos.transaction.reversed" → reversal handling
 *   - HMAC over `${X-Sameday-Timestamp}.${rawBody}`; stale → 400, invalid → 401
 *   - Idempotent on X-Sameday-Delivery (PosWebhookDelivery)
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return handleSamedayWebhook(req);
}
