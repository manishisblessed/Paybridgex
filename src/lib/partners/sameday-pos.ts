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
  try {
    const { baseUrl, apiKey, apiSecret } = getCredentials();

    const bodyStr = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {
      ...authHeaders(apiKey, apiSecret, bodyStr),
    };
    if (bodyStr) {
      headers["Content-Type"] = "application/json";
    }

    let url = `${baseUrl}${path}`;
    if (query) {
      const params = new URLSearchParams(
        Object.entries(query).filter(([, v]) => v !== "" && v != null)
      );
      if (params.toString()) url += `?${params}`;
    }

    const res = await fetch(url, {
      method,
      headers,
      body: bodyStr,
      cache: "no-store",
    });

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
    const message = e instanceof Error ? e.message : "POS partner request failed";
    return {
      ok: false,
      error: {
        success: false,
        error: { code: "PARTNER_REQUEST_FAILED", message },
      },
      status: 502,
    };
  }
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
