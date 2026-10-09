/**
 * Same Day Solution — shared partner API transport.
 *
 * Used by the BBPS-2 (Pay2New) and Settlement adapters. The POS adapter
 * (sameday-pos.ts) predates this file and keeps its own copy of the same
 * scheme.
 *
 * Auth (every request):
 *   x-api-key    — partner API key
 *   x-signature  — HMAC-SHA256( api_secret, bodyString + timestamp )
 *                  where bodyString is the COMPACT JSON actually sent
 *                  (empty string for GET/DELETE)
 *   x-timestamp  — Unix timestamp in milliseconds
 *
 * Constraints: server IP must be whitelisted, timestamp within 5 minutes,
 * and the signature must be computed over the exact bytes sent — so we
 * JSON.stringify once and reuse that string for both signing and the body.
 */
import crypto from "crypto";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { deriveTxnRefs } from "@/lib/recon/refs";
import { recordBbpsOutcome } from "@/lib/services/bbpsHealth";
import { currentTxnRefId } from "./callContext";
import type { PartnerResult } from "./types";

const log = logger.child({ module: "partners/sameday-core" });

/** Hard ceiling for a single Same Day request before we abort it (ms). */
const SAMEDAY_REQUEST_TIMEOUT_MS = 45_000;

/**
 * An HTTP failure is INDETERMINATE (outcome unknown — the provider may have
 * processed it) for 5xx (gateway/upstream error after possible completion), 408
 * (request timeout) and 429 (rate limited). Everything else (4xx auth/validation,
 * explicit business declines) is a DEFINITIVE failure that did not move money.
 */
function isIndeterminateHttp(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/**
 * Transient rate-limit (HTTP 429) retry policy.
 *
 * A 429 is the provider's throttle REJECTING the call before it reaches the
 * payment processor — no money moved — so it is the ONLY transient outcome we
 * may safely RE-SEND (unlike 5xx / 408 / network drops, which may have completed
 * upstream and must never be blind-retried). Without this, a momentary throttle
 * strands a pay in NEEDS_REVIEW with a BLANK partnerTxnId (the provider never
 * returned an order_id / request_id), and the status API can't resolve it from
 * the surviving bill_fetch_ref (ORDER_NOT_FOUND) — leaving the retailer's
 * reserve held until a manual panel lookup.
 *
 * Bounded + jittered so a PERSISTENT throttle still falls through to the normal
 * indeterminate "hold" path rather than looping. The provider's own
 * idempotent_replay guard (keyed on bill_fetch_ref) stays the backstop if a
 * retried pay were ever to double-hit.
 */
const SAMEDAY_MAX_ATTEMPTS = 3; // 1 initial + up to 2 retries, 429 only
const SAMEDAY_RETRY_BASE_MS = 400;
const SAMEDAY_RETRY_CAP_MS = 3_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exponential backoff with jitter for the Nth attempt (1-based). */
function backoffMs(attempt: number): number {
  const base = Math.min(SAMEDAY_RETRY_BASE_MS * 2 ** (attempt - 1), SAMEDAY_RETRY_CAP_MS);
  return base + Math.floor(Math.random() * 200);
}

/** Honour a `Retry-After` header (delta-seconds or HTTP-date); capped; null if absent/invalid. */
function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1_000, SAMEDAY_RETRY_CAP_MS);
  const when = Date.parse(header);
  if (!Number.isNaN(when)) return Math.min(Math.max(when - Date.now(), 0), SAMEDAY_RETRY_CAP_MS);
  return null;
}

export type SamedayCredentials = {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
};

/** HMAC-SHA256 hex signature over `bodyString + timestamp`. */
export function samedaySign(apiSecret: string, payload: string): string {
  return crypto.createHmac("sha256", apiSecret).update(payload).digest("hex");
}

export function samedayAuthHeaders(
  apiKey: string,
  apiSecret: string,
  bodyString: string
): Record<string, string> {
  const timestamp = Date.now().toString();
  return {
    "x-api-key": apiKey,
    "x-signature": samedaySign(apiSecret, bodyString + timestamp),
    "x-timestamp": timestamp,
  };
}

export type SamedayError = {
  success: false;
  error?: { code?: string; message?: string };
  [k: string]: unknown;
};

export type SamedayRequestOpts = {
  /**
   * Persist this call to `PartnerApiLog` (request before the call, response the
   * instant it returns). Enable ONLY for money-moving calls (pay/payout/settle):
   * if the process dies after the provider acted but before runTransaction
   * stores the response, the durable provider poll key survives here so recon
   * can recover it. Best-effort — a logging failure never blocks the call.
   */
  audit?: boolean;
};

/** Insert the pre-call audit row; returns its id (or null on any failure). */
async function auditCreate(
  method: string,
  path: string,
  body: unknown
): Promise<string | null> {
  try {
    const row = await prisma.partnerApiLog.create({
      data: {
        txnRefId: currentTxnRefId() ?? null,
        provider: "SAMEDAY",
        method,
        path,
        request: (body ?? null) as never,
      },
      select: { id: true },
    });
    return row.id;
  } catch (e) {
    // Never let audit logging break a payment.
    log.warn({ action: "partner_api_log.create_failed", path, err: String(e) });
    return null;
  }
}

/** Patch the audit row with the response + mined durable provider reference. */
async function auditPatch(
  id: string | null,
  fields: { response: unknown; httpStatus: number | null; ok: boolean; code: string | null }
): Promise<void> {
  if (!id) return;
  try {
    // The request_id/order_id/txn_id survives even for FAILED pays (provider
    // docs), so mine regardless of ok so a failed txn can still be resolved.
    const providerRef = deriveTxnRefs({ response: fields.response }).find(Boolean) ?? null;
    await prisma.partnerApiLog.update({
      where: { id },
      data: {
        response: (fields.response ?? null) as never,
        httpStatus: fields.httpStatus,
        ok: fields.ok,
        code: fields.code,
        providerRef,
      },
    });
  } catch (e) {
    log.warn({ action: "partner_api_log.patch_failed", id, err: String(e) });
  }
}

/**
 * Fire a signed request. Same Day responses always carry `success`; business
 * failures can come back with HTTP 200 + success:false, so we normalize both.
 */
export async function samedayRequest<T extends { success?: boolean }>(
  creds: SamedayCredentials,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  query?: Record<string, string>,
  opts?: SamedayRequestOpts
): Promise<PartnerResult<T>> {
  // Compact JSON — the server re-serializes and verifies against this form.
  // Auth headers are (re)computed PER ATTEMPT below so each retry carries a
  // fresh x-timestamp inside the provider's 5-minute signing window.
  const bodyString = body !== undefined ? JSON.stringify(body) : "";

  // Real-time rail-health signal: record ONLY user-facing Pay2New bill
  // fetch/pay outcomes (not recon status polls or billers listing) so the UI
  // banner + ops monitor reflect what retailers actually experience.
  const bbpsStep: "fetch" | "pay" | null = path.endsWith("/pay2new/bill/fetch")
    ? "fetch"
    : path.endsWith("/pay2new/bill/pay")
      ? "pay"
      : null;
  const bbpsBiller =
    bbpsStep && body && typeof body === "object"
      ? ((body as { product_code?: string }).product_code ?? null)
      : null;
  const noteHealth = (ok: boolean, code?: string | null, message?: string | null) => {
    if (!bbpsStep) return;
    recordBbpsOutcome({ ok, step: bbpsStep, billerCode: bbpsBiller, code, message });
  };

  let url = `${creds.baseUrl.replace(/\/+$/, "")}${path}`;
  if (query) {
    const params = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v !== "" && v != null)
    );
    if (params.toString()) url += `?${params}`;
  }

  // Durably record the ATTEMPT before we call, so a crash mid-call still leaves
  // a trace (and, once patched, the provider poll key) for reconciliation.
  const auditId = opts?.audit ? await auditCreate(method, path, body) : null;

  // 429-aware request loop. Each attempt recomputes auth headers (fresh
  // x-timestamp) and bounds the socket so a hung connection fails fast
  // (→ NETWORK, indeterminate) instead of blocking a money-moving call forever.
  // We NEVER blind-retry on timeout / 5xx — only on an explicit 429, which the
  // provider rejected BEFORE processing (see retry policy above).
  for (let attempt = 1; ; attempt++) {
    const headers: Record<string, string> = samedayAuthHeaders(
      creds.apiKey,
      creds.apiSecret,
      bodyString
    );
    if (bodyString) headers["Content-Type"] = "application/json";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SAMEDAY_REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: bodyString || undefined,
        cache: "no-store",
        signal: controller.signal,
      });

      // Rate limited → the provider threw the request away BEFORE processing it
      // (no money moved), so re-send after a bounded backoff. A persistent
      // throttle exhausts the retries and falls through to the normal
      // indeterminate "hold" path below — never an infinite loop.
      if (res.status === 429 && attempt < SAMEDAY_MAX_ATTEMPTS) {
        const waitMs = retryAfterMs(res.headers.get("retry-after")) ?? backoffMs(attempt);
        log.warn({ action: "sameday_request_rate_limited", method, path, attempt, waitMs });
        clearTimeout(timeout);
        await sleep(waitMs);
        continue;
      }

      const json = (await res.json().catch(() => ({}))) as T & SamedayError;
      const ok = res.ok && json.success !== false;
      const code = ok ? null : json.error?.code || `HTTP_${res.status}`;
      // Patch the durable log the INSTANT the response is in hand — before the
      // caller (runTransaction) does anything else — so the provider reference is
      // safe even if the caller dies immediately after this returns.
      await auditPatch(auditId, { response: json, httpStatus: res.status, ok, code });
      noteHealth(ok, code, json.error?.message ?? res.statusText ?? null);
      if (!ok) {
        // Surface the RAW provider failure in server logs for EVERY call (fetch,
        // billers, pay, …) — not just audited money calls — so a fetch/preview
        // failure (which creates no PartnerApiLog row) is still diagnosable from
        // pm2 logs. User-facing text stays sanitized via friendlyPartnerError.
        log.warn({
          action: "sameday_request_failed",
          method,
          path,
          httpStatus: res.status,
          code,
          attempts: attempt,
          message: json.error?.message ?? res.statusText ?? null,
        });
        return {
          ok: false,
          code: code!,
          message: json.error?.message || res.statusText || "Same Day request failed",
          raw: json,
          // INDETERMINATE when the transport/gateway never gave a definitive
          // business answer: HTTP 5xx (upstream may have completed), 408 (request
          // timeout) or 429 (rate limited → may be retried by provider). An
          // explicit decline (HTTP 200 success:false, 4xx auth/validation) is
          // DEFINITIVE — the provider did not process it, safe to fail + refund.
          indeterminate: isIndeterminateHttp(res.status),
        };
      }
      return { ok: true, data: json, raw: json };
    } catch (e) {
      await auditPatch(auditId, { response: null, httpStatus: null, ok: false, code: "NETWORK" });
      noteHealth(false, "NETWORK", (e as Error).message ?? null);
      log.warn({
        action: "sameday_request_error",
        method,
        path,
        err: (e as Error).name === "AbortError" ? "timeout" : String((e as Error).message),
      });
      // A thrown fetch (socket drop, DNS, TLS, abort/timeout) means we got NO
      // answer at all — always indeterminate; the provider may have charged.
      return {
        ok: false,
        code: "NETWORK",
        message: (e as Error).name === "AbortError" ? "Same Day request timed out" : (e as Error).message,
        indeterminate: true,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Resolve credentials for a Same Day product. Product-specific keys win;
 * otherwise we fall back to the POS keys since the admin panel issues one
 * key pair per partner account.
 */
export function samedayCredentials(
  product: "BBPS" | "SETTLEMENT" | "RECHARGEKIT"
): SamedayCredentials | null {
  const keyMap = {
    BBPS: env.SAMEDAY_BBPS_API_KEY,
    SETTLEMENT: env.SAMEDAY_SETTLEMENT_API_KEY,
    RECHARGEKIT: env.SAMEDAY_RECHARGEKIT_API_KEY,
  };
  const secretMap = {
    BBPS: env.SAMEDAY_BBPS_API_SECRET,
    SETTLEMENT: env.SAMEDAY_SETTLEMENT_API_SECRET,
    RECHARGEKIT: env.SAMEDAY_RECHARGEKIT_API_SECRET,
  };
  const apiKey = keyMap[product] || env.SAMEDAY_POS_API_KEY;
  const apiSecret = secretMap[product] || env.SAMEDAY_POS_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  return { baseUrl: env.SAMEDAY_POS_BASE_URL, apiKey, apiSecret };
}
