/**
 * Same Day Solution — RechargeKit (CC-2) Credit Card Payment adapter.
 *
 * A direct credit card payment rail: the retailer enters the FULL 16-digit
 * card number, bank IFSC, beneficiary name, and an amount; Same Day pushes
 * the payment to the card issuer. No bill-fetch step — the amount is entered
 * manually and charges are quoted before confirmation.
 *
 * Flow:
 *   1. operators  — GET cached operator list (one-per-bank)
 *   2. charges    — POST quote for a given amount
 *   3. pay        — POST initiate payment
 *   4. status     — POST poll by txn_id or request_id
 *
 * Activate: PARTNER_RECHARGEKIT_ENABLED=true
 *   needs: SAMEDAY_RECHARGEKIT_API_KEY / SAMEDAY_RECHARGEKIT_API_SECRET
 *          (falls back to SAMEDAY_POS_API_KEY / SECRET)
 *
 * CRITICAL: on pay timeout/network error, call status() with request_id.
 *           NEVER retry pay — the provider may have already debited.
 */
import { logger } from "@/lib/logger";
import type { PartnerResult } from "./types";
import { samedayCredentials, samedayRequest } from "./sameday-core";

const P = "/api/partner/rechargekit";
const log = logger.child({ module: "sameday-rechargekit" });

// In-memory operator cache — refreshed daily or on demand.
let operatorCache: RechargekitOperator[] | null = null;
let operatorCacheAt = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type RechargekitOperator = {
  operatorId: string;
  operatorName: string;
  operatorCode: string;
  /**
   * Bank-level credit-card IFSC to use verbatim as the Pay `ifsc`. Normalized
   * to `null` when the partner returns "NA"/empty (no IFSC available — the UI
   * must then collect a valid IFSC or block that operator). Never carries "NA".
   */
  operatorIfsc: string | null;
};

/** Canonical IFSC shape: 4 letters, a 0, then 6 alphanumerics (e.g. ICIC0001234). */
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export type RechargekitCharges = {
  amount: number;
  schemeName: string;
  baseCharge: number;
  gstPercent: number;
  gstAmount: number;
  totalCharge: number;
};

export type RechargekitPayResult = {
  success: boolean;
  status: "SUCCESS" | "PENDING" | "FAILED";
  txnId: string;
  operatorReference?: string;
  amount: number;
  charge: number;
  requestId: string;
  message?: string;
};

export type RechargekitStatusResult = {
  txnId: string;
  status: "SUCCESS" | "PENDING" | "FAILED" | "REFUNDED";
  amount: number;
  charge: number;
  operatorReference?: string;
  createdAt?: string;
  updatedAt?: string;
  requestId?: string;
};

export function rechargekitConfigured(): boolean {
  return samedayCredentials("RECHARGEKIT") !== null;
}

function creds() {
  const c = samedayCredentials("RECHARGEKIT");
  if (!c)
    throw new Error(
      "[sameday-rechargekit] SAMEDAY_RECHARGEKIT_API_KEY/SECRET not configured"
    );
  return c;
}

function normalizeStatus(
  raw: string | undefined
): RechargekitStatusResult["status"] {
  switch ((raw || "").toUpperCase()) {
    case "SUCCESS":
      return "SUCCESS";
    case "FAILED":
      return "FAILED";
    case "REFUNDED":
      return "REFUNDED";
    default:
      return "PENDING";
  }
}

/** Fetch operators from the API (cached for 24h). */
export async function rechargekitOperators(
  forceRefresh = false
): Promise<PartnerResult<RechargekitOperator[]>> {
  if (
    !forceRefresh &&
    operatorCache &&
    Date.now() - operatorCacheAt < CACHE_TTL_MS
  ) {
    return { ok: true, data: operatorCache };
  }

  const r = await samedayRequest<{
    success: boolean;
    operators?: Array<{
      operator_id: string;
      operator_name: string;
      operator_code: string;
      operator_ifsc?: string | null;
    }>;
    count?: number;
  }>(creds(), "GET", `${P}/operators`);

  if (!r.ok) return r;

  const operators: RechargekitOperator[] = (r.data.operators ?? []).map(
    (op) => {
      // Normalize the partner IFSC: uppercase, drop "NA"/empty so downstream
      // code never sends a bogus value. Only a well-formed IFSC survives.
      const ifsc = (op.operator_ifsc ?? "").trim().toUpperCase();
      return {
        operatorId: op.operator_id,
        operatorName: op.operator_name,
        operatorCode: op.operator_code,
        operatorIfsc: IFSC_REGEX.test(ifsc) ? ifsc : null,
      };
    }
  );

  operatorCache = operators;
  operatorCacheAt = Date.now();
  log.info(
    { count: operators.length },
    "RechargeKit operators cache refreshed"
  );

  return { ok: true, data: operators, raw: r.raw };
}

/** Preview charges for an amount. */
export async function rechargekitCharges(
  amount: number
): Promise<PartnerResult<RechargekitCharges>> {
  const r = await samedayRequest<{
    success: boolean;
    amount?: number;
    scheme_name?: string;
    charges?: {
      base_charge: number;
      gst_percent: number;
      gst_amount: number;
      total_charge: number;
    };
  }>(creds(), "POST", `${P}/charges`, { amount });

  if (!r.ok) return r;

  const c = r.data.charges;
  return {
    ok: true,
    data: {
      amount: r.data.amount ?? amount,
      schemeName: r.data.scheme_name ?? "",
      baseCharge: c?.base_charge ?? 0,
      gstPercent: c?.gst_percent ?? 18,
      gstAmount: c?.gst_amount ?? 0,
      totalCharge: c?.total_charge ?? 0,
    },
    raw: r.raw,
  };
}

/** Initiate a credit card payment. */
export async function rechargekitPay(input: {
  mobileNo: string;
  accountNo: string;
  ifsc: string;
  bankName: string;
  beneficiaryName: string;
  amount: number;
  operatorCode: string;
}): Promise<PartnerResult<RechargekitPayResult>> {
  if (!/^\d{10}$/.test(input.mobileNo)) {
    return {
      ok: false,
      code: "INVALID_MOBILE",
      message: "Mobile number must be exactly 10 digits",
    };
  }
  if (!/^\d{13,19}$/.test(input.accountNo)) {
    return {
      ok: false,
      code: "INVALID_CARD",
      message: "Card number must be 13-19 digits",
    };
  }

  log.info(
    {
      mobileLast4: input.mobileNo.slice(-4),
      cardLast4: input.accountNo.slice(-4),
      amount: input.amount,
      operatorCode: input.operatorCode,
    },
    "RechargeKit pay initiated"
  );

  const r = await samedayRequest<{
    success: boolean;
    status?: string;
    txn_id?: string;
    operator_reference?: string;
    amount?: number;
    charge?: number;
    request_id?: string;
    message?: string;
  }>(creds(), "POST", `${P}/pay`, {
    mobile_no: input.mobileNo,
    account_no: input.accountNo,
    ifsc: input.ifsc,
    bank_name: input.bankName,
    beneficiary_name: input.beneficiaryName,
    amount: input.amount,
    operator_code: input.operatorCode,
  });

  if (!r.ok) {
    log.warn(
      { code: r.code, message: r.message, cardLast4: input.accountNo.slice(-4) },
      "RechargeKit pay failed"
    );
    return r;
  }

  const result: RechargekitPayResult = {
    success: true,
    status: normalizeStatus(r.data.status) as "SUCCESS" | "PENDING" | "FAILED",
    txnId: r.data.txn_id ?? "",
    operatorReference: r.data.operator_reference,
    amount: r.data.amount ?? input.amount,
    charge: r.data.charge ?? 0,
    requestId: r.data.request_id ?? "",
    message: r.data.message,
  };

  log.info(
    {
      txnId: result.txnId,
      requestId: result.requestId,
      status: result.status,
      amount: result.amount,
    },
    "RechargeKit pay response"
  );

  return {
    ok: true,
    data: result,
    partnerTxnId: result.txnId || result.requestId,
    pending: result.status === "PENDING",
    raw: r.raw,
  };
}

/** Poll payment status by txn_id or request_id. */
export async function rechargekitStatus(ref: {
  txnId?: string;
  requestId?: string;
}): Promise<PartnerResult<RechargekitStatusResult>> {
  const body: Record<string, string> = {};
  if (ref.txnId) body.txn_id = ref.txnId;
  else if (ref.requestId) body.request_id = ref.requestId;
  else {
    return {
      ok: false,
      code: "BAD_PARAMS",
      message: "status() requires txnId or requestId",
    };
  }

  const r = await samedayRequest<{
    success: boolean;
    txn_id?: string;
    status?: string;
    amount?: number;
    charge?: number;
    operator_reference?: string;
    created_at?: string;
    updated_at?: string;
    request_id?: string;
  }>(creds(), "POST", `${P}/status`, body);

  if (!r.ok) return r;

  const result: RechargekitStatusResult = {
    txnId: r.data.txn_id ?? "",
    status: normalizeStatus(r.data.status),
    amount: r.data.amount ?? 0,
    charge: r.data.charge ?? 0,
    operatorReference: r.data.operator_reference,
    createdAt: r.data.created_at,
    updatedAt: r.data.updated_at,
    requestId: r.data.request_id,
  };

  log.info(
    { txnId: result.txnId, requestId: result.requestId, status: result.status },
    "RechargeKit status polled"
  );

  return { ok: true, data: result, raw: r.raw };
}
