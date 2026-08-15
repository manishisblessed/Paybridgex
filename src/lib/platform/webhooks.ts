import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptField } from "@/lib/crypto/fieldEncryption";
import { enqueue, QUEUES } from "@/lib/queue";
import { logger } from "@/lib/logger";
import { sendOpsAlert } from "@/lib/monitoring/alerts";

/**
 * Outbound webhooks (Phase 4 — platform play).
 *
 * Partners (white-label MDs/SDs) register HTTPS endpoints; platform events are
 * delivered as signed JSON POSTs with automatic retries.
 *
 * Delivery pipeline:
 *   emitWebhookEvent() — fire-and-forget from money paths. Creates a
 *     WebhookDelivery row per matching endpoint and enqueues a job. NEVER
 *     throws: a webhook must never break the transaction it reports on.
 *   deliverWebhook()   — worker handler. Signs the raw body with the
 *     endpoint's secret (HMAC-SHA256, hex, in X-NGP-Signature), POSTs with a
 *     10s timeout, records the outcome. Throws on failure so pg-boss retries
 *     with backoff; gives up permanently after MAX_ATTEMPTS.
 */

export const WEBHOOK_EVENTS = [
  { id: "txn.success", label: "Service transaction succeeded" },
  { id: "txn.failed", label: "Service transaction failed" },
  { id: "topup.credited", label: "Wallet top-up credited" },
  { id: "payout.success", label: "Payout completed (UTR available)" },
  { id: "payout.failed", label: "Payout failed / refunded" },
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]["id"];

const EVENT_IDS = new Set<string>(WEBHOOK_EVENTS.map((e) => e.id));

export const MAX_ATTEMPTS = 8;

export function isValidEvent(event: string): event is WebhookEvent {
  return EVENT_IDS.has(event);
}

export function signWebhookBody(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Fan an event out to the user's active endpoints. Fire-and-forget — call
 * with `void` or `.catch(() => {})`; internally guaranteed not to throw.
 */
export async function emitWebhookEvent(
  userId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { userId, active: true, events: { has: event } },
      select: { id: true },
    });
    if (endpoints.length === 0) return;

    for (const ep of endpoints) {
      const delivery = await prisma.webhookDelivery.create({
        data: {
          endpointId: ep.id,
          event,
          payload: { event, createdAt: new Date().toISOString(), data: payload } as Prisma.InputJsonValue,
        },
      });
      await enqueue(
        QUEUES.WEBHOOK_DELIVER,
        { deliveryId: delivery.id },
        { singletonKey: `webhook:${delivery.id}`, retryLimit: MAX_ATTEMPTS, retryDelaySec: 30 }
      );
    }
  } catch (e) {
    // Webhooks are best-effort by contract — log and move on.
    logger.warn({ action: "webhook.emit_failed", event, err: String(e) });
  }
}

/** Worker handler. Throws on retryable failure (pg-boss backs off and retries). */
export async function deliverWebhook(deliveryId: string): Promise<void> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  });
  if (!delivery || delivery.status === "SUCCESS") return;
  if (!delivery.endpoint.active) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: "FAILED", lastError: "endpoint deactivated" },
    });
    return;
  }

  const body = JSON.stringify(delivery.payload);
  const secret = decryptField(delivery.endpoint.secret);
  const attempt = delivery.attempts + 1;

  let responseCode: number | null = null;
  let error: string | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(delivery.endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Paybridgex-Webhooks/1.0",
        "X-NGP-Event": delivery.event,
        "X-NGP-Delivery": delivery.id,
        "X-NGP-Signature": signWebhookBody(secret, body),
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    responseCode = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (e) {
    error = String(e).slice(0, 300);
  }

  if (!error) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: "SUCCESS", attempts: attempt, responseCode, deliveredAt: new Date(), lastError: null },
    });
    return;
  }

  const exhausted = attempt >= MAX_ATTEMPTS;
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: { status: exhausted ? "FAILED" : "PENDING", attempts: attempt, responseCode, lastError: error },
  });

  if (exhausted) {
    await sendOpsAlert({
      title: "Webhook delivery exhausted retries",
      severity: "warning",
      details: { delivery: deliveryId, event: delivery.event, error, attempts: attempt },
    });
    return; // swallow — no more retries
  }

  throw new Error(`[webhook] delivery ${deliveryId} attempt ${attempt} failed: ${error}`);
}
