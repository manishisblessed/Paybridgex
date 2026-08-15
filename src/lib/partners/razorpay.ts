/**
 * Razorpay adapter — UPI Collect (PG) + RazorpayX Payouts.
 *
 * Activate UPI:    PARTNER_UPI_ENABLED=true
 *   needs: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
 * Activate Payout: PARTNER_PAYOUT_ENABLED=true
 *   needs: RAZORPAYX_ACCOUNT_NUMBER, RAZORPAYX_KEY_ID, RAZORPAYX_KEY_SECRET
 */
import crypto from "crypto";
import type { PartnerResult, PayoutProvider, UpiProvider } from "./types";

function authHeader(id: string, secret: string) {
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

async function rzpPost<T>(url: string, body: unknown, auth: string): Promise<PartnerResult<T>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: JSON.stringify(body)
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const err = (json.error ?? {}) as { code?: string; description?: string };
      return { ok: false, code: err.code ?? `HTTP_${res.status}`, message: err.description ?? res.statusText, raw: json };
    }
    return { ok: true, data: json as T, raw: json };
  } catch (e) {
    return { ok: false, code: "NETWORK", message: (e as Error).message };
  }
}

export const razorpayUpi: UpiProvider = {
  name: "RAZORPAY-UPI",
  async collect(input) {
    const auth = authHeader(process.env.RAZORPAY_KEY_ID!, process.env.RAZORPAY_KEY_SECRET!);
    const r = await rzpPost<{ id: string; short_url?: string }>(
      "https://api.razorpay.com/v1/payment_links",
      {
        amount: Math.round(input.amount * 100),
        currency: "INR",
        accept_partial: false,
        description: input.note ?? "Paybridgex collect",
        customer: { email: input.customerEmail, contact: input.customerPhone },
        notify: { sms: true, email: !!input.customerEmail },
        callback_url: input.callbackUrl,
        callback_method: "get",
        notes: { idempotencyKey: input.idempotencyKey, userId: input.userId }
      },
      auth
    );
    if (!r.ok) return r;
    return { ok: true, data: { orderId: r.data.id, paymentUrl: r.data.short_url }, partnerTxnId: r.data.id, raw: r.raw };
  },
  async status(orderId) {
    const auth = authHeader(process.env.RAZORPAY_KEY_ID!, process.env.RAZORPAY_KEY_SECRET!);
    const res = await fetch(`https://api.razorpay.com/v1/payment_links/${orderId}`, { headers: { authorization: auth } });
    const json = (await res.json()) as { status?: string; updated_at?: number };
    const map: Record<string, "CREATED" | "PAID" | "FAILED" | "EXPIRED"> = {
      created: "CREATED", issued: "CREATED", paid: "PAID", expired: "EXPIRED", cancelled: "FAILED"
    };
    return { ok: true, data: { status: map[json.status ?? "created"], paidAt: json.updated_at ? new Date(json.updated_at * 1000).toISOString() : undefined } };
  }
};

export const razorpayPayout: PayoutProvider = {
  name: "RAZORPAYX",
  async payout(input) {
    const auth = authHeader(process.env.RAZORPAYX_KEY_ID!, process.env.RAZORPAYX_KEY_SECRET!);
    const fundAccount: Record<string, unknown> =
      input.mode === "UPI"
        ? { account_type: "vpa", vpa: { address: input.beneficiary.vpa } }
        : { account_type: "bank_account", bank_account: { name: input.beneficiary.name, ifsc: input.beneficiary.ifsc, account_number: input.beneficiary.accountNumber } };

    const r = await rzpPost<{ id: string; utr?: string; status: string }>(
      "https://api.razorpay.com/v1/payouts",
      {
        account_number: process.env.RAZORPAYX_ACCOUNT_NUMBER,
        amount: Math.round(input.amount * 100),
        currency: "INR",
        mode: input.mode,
        purpose: input.purpose,
        fund_account: fundAccount,
        queue_if_low_balance: true,
        reference_id: input.idempotencyKey,
        narration: input.purpose
      },
      auth
    );
    if (!r.ok) return r;
    const map: Record<string, "PROCESSING" | "PAID" | "FAILED"> = {
      queued: "PROCESSING", pending: "PROCESSING", processing: "PROCESSING", processed: "PAID", reversed: "FAILED", failed: "FAILED", cancelled: "FAILED"
    };
    return { ok: true, data: { payoutId: r.data.id, utr: r.data.utr, status: map[r.data.status] ?? "PROCESSING" }, partnerTxnId: r.data.id };
  },
  async status(payoutId) {
    const auth = authHeader(process.env.RAZORPAYX_KEY_ID!, process.env.RAZORPAYX_KEY_SECRET!);
    const res = await fetch(`https://api.razorpay.com/v1/payouts/${payoutId}`, { headers: { authorization: auth } });
    const json = (await res.json()) as { status: string; utr?: string };
    const map: Record<string, "PROCESSING" | "PAID" | "FAILED"> = {
      queued: "PROCESSING", pending: "PROCESSING", processing: "PROCESSING", processed: "PAID", reversed: "FAILED", failed: "FAILED", cancelled: "FAILED"
    };
    return { ok: true, data: { status: map[json.status] ?? "PROCESSING", utr: json.utr } };
  }
};

/** Verify a Razorpay webhook signature. Always run this before trusting the body. */
export function verifyRazorpayWebhook(rawBody: string, signature: string): boolean {
  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function razorpayUpiConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}
export function razorpayPayoutConfigured(): boolean {
  return Boolean(process.env.RAZORPAYX_ACCOUNT_NUMBER && process.env.RAZORPAYX_KEY_ID && process.env.RAZORPAYX_KEY_SECRET);
}
