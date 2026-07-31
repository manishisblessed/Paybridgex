import crypto from "crypto";
import { requireEnv, env } from "@/lib/env";
import type {
  PosTransactionsRequest,
  PosTransactionsResponse,
  PosMachinesQuery,
  PosMachinesResponse,
  PosExportRequest,
  PosExportCreateResponse,
  PosExportStatusResponse,
  PosApiError,
} from "./sameday-pos.types";

// ---------------------------------------------------------------------------
// Same Day Solution — POS Partner API client
//
// Auth: every request needs 3 headers:
//   x-api-key    — public key
//   x-signature  — HMAC-SHA256( api_secret, JSON.stringify(body) + timestamp )
//                  for GET: HMAC-SHA256( api_secret, '' + timestamp )
//   x-timestamp  — Unix timestamp (ms)
//
// Timestamp tolerance: 5 minutes. Rate limit: 100 req/min. HTTPS required.
// ---------------------------------------------------------------------------

function getCredentials() {
  return {
    baseUrl: env.SAMEDAY_POS_BASE_URL,
    apiKey: requireEnv("SAMEDAY_POS_API_KEY"),
    apiSecret: requireEnv("SAMEDAY_POS_API_SECRET"),
  };
}

// ---------------------------------------------------------------------------
// Outbound rate control — stay under the partner's 100 req/min ceiling.
//
// A process-wide token bucket paces EVERY outbound partner call so a burst
// (e.g. a paginated sweep, or overlapping jobs) can never exceed the partner's
// limit and trigger 429s. We cap at 90/min (10% headroom) with a small burst
// allowance. Now that the dashboard feed + exports serve from the local mirror,
// virtually all partner traffic originates from the single background worker
// process, so this in-process bucket is effectively global.
//
// On a 429 we still back off and retry (respecting Retry-After) as a safety net
// for anything outside our own pacing (e.g. another client on the same account).
// ---------------------------------------------------------------------------

const RATE_PER_MIN = 90;
const BUCKET_CAPACITY = 20; // allow a short burst, then settle to the rate
const REFILL_PER_MS = RATE_PER_MIN / 60_000;
const MAX_RETRIES = 3; // total attempts = MAX_RETRIES + 1
const MAX_BACKOFF_MS = 15_000;

let _tokens = BUCKET_CAPACITY;
let _lastRefill = Date.now();
// Serialize token math so concurrent callers can't race across await points.
let _acquireChain: Promise<void> = Promise.resolve();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

/** Block until a rate-limit token is available, then consume one. */
async function acquireToken(): Promise<void> {
  const run = async () => {
    const now = Date.now();
    _tokens = Math.min(BUCKET_CAPACITY, _tokens + (now - _lastRefill) * REFILL_PER_MS);
    _lastRefill = now;
    if (_tokens < 1) {
      const waitMs = Math.ceil((1 - _tokens) / REFILL_PER_MS);
      await sleep(waitMs);
      const after = Date.now();
      _tokens = Math.min(BUCKET_CAPACITY, _tokens + (after - _lastRefill) * REFILL_PER_MS);
      _lastRefill = after;
    }
    _tokens -= 1;
  };
  const next = _acquireChain.then(run, run);
  _acquireChain = next.catch(() => {});
  return next;
}

/** Parse a Retry-After header (seconds, or an HTTP date) into milliseconds. */
function retryAfterMs(header: string | null, attempt: number): number {
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, MAX_BACKOFF_MS);
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.min(Math.max(0, date - Date.now()), MAX_BACKOFF_MS);
  }
  // Exponential fallback: 1s, 2s, 4s … capped.
  return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
}

function sign(secret: string, payload: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
}

function authHeaders(
  apiKey: string,
  apiSecret: string,
  body?: string
): Record<string, string> {
  const timestamp = Date.now().toString();
  const signaturePayload = (body ?? "") + timestamp;
  return {
    "x-api-key": apiKey,
    "x-signature": sign(apiSecret, signaturePayload),
    "x-timestamp": timestamp,
  };
}

/**
 * Canonical, cross-path idempotency reference for a POS capture.
 *
 * The same physical swipe reaches us via TWO independent paths that identify it
 * with DIFFERENT primary ids: the real-time webhook sends `txnId`, while the
 * ingest sweep sees `razorpay_txn_id` / `external_ref` / numeric `id`. If each
 * path keyed the settlement entry on its own id, the two paths would create TWO
 * entries for one swipe — double-crediting the retailer and paying commission
 * twice.
 *
 * The RRN (Retrieval Reference Number) is the ONE identifier both paths carry
 * and that uniquely identifies a card transaction network-wide. Deriving the
 * reference from `${tid}:${rrn}` makes BOTH paths converge on the SAME
 * `transactionRef`, so the `PosSettlementEntry.transactionRef @unique`
 * constraint makes a second insert physically impossible — no double credit.
 *
 * When no RRN is present (rare, non-card), we fall back to the path's own id
 * (the pre-existing behaviour). Returns "" only when nothing identifies the
 * capture, which callers reject.
 */
export function canonicalPosCaptureRef(input: {
  rrn?: string | null;
  terminalId?: string | null;
  fallbackId?: string | null;
}): string {
  const rrn = (input.rrn ?? "").replace(/\s+/g, "").toUpperCase();
  const tid = (input.terminalId ?? "").trim().toUpperCase();
  if (rrn) return tid ? `SDPOS:${tid}:${rrn}` : `SDPOS:${rrn}`;
  return (input.fallbackId ?? "").trim();
}

/** Max age (seconds) accepted for a webhook timestamp — replay protection. */
const WEBHOOK_MAX_SKEW_SEC = 300; // 5 minutes

/**
 * Verify an INCOMING Same Day POS capture webhook (POST /api/pos/webhook).
 *
 * Same Day's confirmed scheme:
 *   X-Sameday-Signature = HMAC-SHA256( secret, `${X-Sameday-Timestamp}.${rawBody}` )  (hex)
 *   X-Sameday-Timestamp = unix time in SECONDS at signing
 * The signature covers the timestamp, a literal ".", then the exact raw body
 * bytes — so it must be verified BEFORE JSON parsing. Comparison is constant
 * time; stale timestamps (> 5 min skew) are rejected to blunt replay attacks.
 *
 * Return value:
 *   "SKIP" — SAMEDAY_POS_WEBHOOK_SECRET is not configured yet. The caller
 *            ACCEPTS the webhook but flags it unverified. This is the bootstrap
 *            phase: captures keep saving while we await Same Day's signing
 *            secret. Set the env var to turn enforcement on (fail-closed).
 *   true   — signature present, timestamp fresh, and HMAC valid.
 *   false  — secret configured but signature/timestamp missing, stale, or invalid
 *            → caller rejects 401.
 */
export function verifySamedayPosWebhook(
  rawBody: string,
  signature: string | null,
  timestamp: string | null
): boolean | "SKIP" {
  const secret = process.env.SAMEDAY_POS_WEBHOOK_SECRET;
  if (!secret) return "SKIP";
  if (!signature || !timestamp) return false;

  // Replay protection: reject timestamps outside the tolerance window.
  const skewSec = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(skewSec) || skewSec > WEBHOOK_MAX_SKEW_SEC) return false;

  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature.trim();
  const expected = sign(secret, `${timestamp}.${rawBody}`);
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

type ApiResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: PosApiError; status: number };

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  query?: Record<string, string>
): Promise<ApiResult<T>> {
  const { baseUrl, apiKey, apiSecret } = getCredentials();
  const bodyStr = body ? JSON.stringify(body) : undefined;

  let url = `${baseUrl}${path}`;
  if (query) {
    const params = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v !== "" && v != null)
    );
    if (params.toString()) url += `?${params}`;
  }

  let lastError: ApiResult<T> = {
    ok: false,
    error: { success: false, error: { code: "PARTNER_REQUEST_FAILED", message: "POS partner request failed" } },
    status: 502,
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Pace every attempt through the shared token bucket so we never burst past
    // the partner's per-minute ceiling in the first place.
    await acquireToken();

    try {
      // Sign per-attempt: the HMAC covers a fresh timestamp (5-min tolerance),
      // so a retry after a backoff still presents a valid, non-stale signature.
      const headers: Record<string, string> = { ...authHeaders(apiKey, apiSecret, bodyStr) };
      if (bodyStr) headers["Content-Type"] = "application/json";

      const res = await fetch(url, { method, headers, body: bodyStr, cache: "no-store" });

      // Rate limited: back off (honoring Retry-After) and retry if attempts remain.
      if (res.status === 429) {
        await res.text().catch(() => {}); // drain body to free the connection
        lastError = {
          ok: false,
          error: { success: false, error: { code: "RATE_LIMITED", message: "POS partner rate limit hit (429)" } },
          status: 429,
        };
        if (attempt < MAX_RETRIES) {
          await sleep(retryAfterMs(res.headers.get("retry-after"), attempt));
          continue;
        }
        return lastError;
      }

      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        return {
          ok: false,
          error: {
            success: false,
            error: {
              code: "INVALID_RESPONSE",
              message: `POS partner returned a non-JSON response (${res.status})`,
            },
          },
          status: res.status || 502,
        };
      }

      if (!res.ok || (json as { success?: boolean } | null)?.success === false) {
        return {
          ok: false,
          error: (json as PosApiError) ?? {
            success: false,
            error: { code: "UPSTREAM_ERROR", message: "Failed to fetch from POS partner" },
          },
          status: res.status || 502,
        };
      }
      return { ok: true, data: json as T, status: res.status };
    } catch (e) {
      // Transient network error: retry with backoff if attempts remain.
      const message = e instanceof Error ? e.message : "POS partner request failed";
      lastError = {
        ok: false,
        error: { success: false, error: { code: "PARTNER_REQUEST_FAILED", message } },
        status: 502,
      };
      if (attempt < MAX_RETRIES) {
        await sleep(retryAfterMs(null, attempt));
        continue;
      }
      return lastError;
    }
  }

  return lastError;
}

// ── Public API ──

export async function getPosTransactions(params: PosTransactionsRequest) {
  return request<PosTransactionsResponse>(
    "POST",
    "/api/partner/pos-transactions",
    params
  );
}

export async function getPosMachines(params?: PosMachinesQuery) {
  const query: Record<string, string> = {};
  if (params?.page) query.page = String(params.page);
  if (params?.limit) query.limit = String(params.limit);
  if (params?.status) query.status = params.status;
  if (params?.machine_type) query.machine_type = params.machine_type;
  if (params?.search) query.search = params.search;

  return request<PosMachinesResponse>(
    "GET",
    "/api/partner/pos-machines",
    undefined,
    query
  );
}

export async function createPosExport(params: PosExportRequest) {
  return request<PosExportCreateResponse>(
    "POST",
    "/api/partner/pos-transactions/export",
    params
  );
}

export async function getPosExportStatus(jobId: string) {
  return request<PosExportStatusResponse>(
    "GET",
    `/api/partner/export-status/${jobId}`
  );
}

export async function checkPosHealth() {
  const { baseUrl } = getCredentials();
  const res = await fetch(`${baseUrl}/pos-health`, { cache: "no-store" });
  return res.json();
}
