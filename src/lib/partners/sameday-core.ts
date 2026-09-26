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
import { currentTxnRefId } from "./callContext";
import type { PartnerResult } from "./types";

const log = logger.child({ module: "partners/sameday-core" });

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
  const bodyString = body !== undefined ? JSON.stringify(body) : "";
  const headers: Record<string, string> = samedayAuthHeaders(
    creds.apiKey,
    creds.apiSecret,
    bodyString
  );
  if (bodyString) headers["Content-Type"] = "application/json";

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

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: bodyString || undefined,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as T & SamedayError;
    const ok = res.ok && json.success !== false;
    const code = ok ? null : json.error?.code || `HTTP_${res.status}`;
    // Patch the durable log the INSTANT the response is in hand — before the
    // caller (runTransaction) does anything else — so the provider reference is
    // safe even if the caller dies immediately after this returns.
    await auditPatch(auditId, { response: json, httpStatus: res.status, ok, code });
    if (!ok) {
      return {
        ok: false,
        code: code!,
        message: json.error?.message || res.statusText || "Same Day request failed",
        raw: json,
      };
    }
    return { ok: true, data: json, raw: json };
  } catch (e) {
    await auditPatch(auditId, { response: null, httpStatus: null, ok: false, code: "NETWORK" });
    return { ok: false, code: "NETWORK", message: (e as Error).message };
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
