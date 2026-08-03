/**
 * Same Day Solution — BBPS-2 (Pay2New) Credit Card Bill Payment adapter.
 *
 * Activate: PARTNER_BBPS_ENABLED=true  (flags.bbps)
 *   needs: SAMEDAY_BBPS_API_KEY / SAMEDAY_BBPS_API_SECRET
 *          (falls back to SAMEDAY_POS_API_KEY / SECRET — one key pair per
 *          partner account)
 *   opt:   SAMEDAY_POS_BASE_URL (shared base, default api.samedaysolution.in)
 *
 * Flow (see postman/BBPS2-Partner-Integration-Guide.md):
 *   billers → fetch bill (save order_id) → pay with bill_fetch_ref → status
 *
 * Only the CREDIT_CARD category is live on this rail. Charges/wallet debit
 * happen at the PARTNER level on Same Day's side; our retailer-facing charge
 * and commissions still come from our own scheme via runTransaction.
 *
 * Timeout rule: NEVER blind-retry pay. If pay times out, callers should use
 * status() with the request_id/order_id; runTransaction treats a network
 * error as failure and refunds, and the nightly recon sweep catches the rare
 * case where the payment actually went through.
 */
import type {
  BbpsBill,
  BbpsBiller,
  BbpsFetchInput,
  BbpsPayInput,
  BbpsPayOutput,
  BbpsProvider,
  PartnerResult,
} from "./types";
import { samedayCredentials, samedayRequest } from "./sameday-core";

const P = "/api/partner/pay2new";
const DEFAULT_PINCODE = "414002";

export function samedayBbpsConfigured(): boolean {
  return samedayCredentials("BBPS") !== null;
}

function creds() {
  const c = samedayCredentials("BBPS");
  if (!c) throw new Error("[sameday-bbps] SAMEDAY_BBPS_API_KEY/SECRET not configured");
  return c;
}

// ---------- response shapes ----------

type BillersResponse = {
  success: boolean;
  billers?: Array<{ product_code: string; product_name: string }>;
};

type FetchBillResponse = {
  success: boolean;
  data?: Record<string, string>;
  order_id?: string;
  request_id?: string;
};

type PayResponse = {
  success: boolean;
  order_id?: string;
  operator_reference?: string;
  request_id?: string;
  charge?: number;
};

type StatusResponse = {
  success: boolean;
  order_id?: string | null;
  status?: string;
  operator_reference?: string | null;
};

// ---------- pure mapping helpers (unit-tested) ----------

/** Normalize Pay2New's loosely-keyed bill payload into our BbpsBill. */
export function mapPay2NewBill(json: FetchBillResponse): BbpsBill {
  const d = json.data ?? {};
  const num = (v: string | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    customerName: d.customer_name || d.customerName || "",
    amount: num(d.amount) ?? 0,
    dueDate: d.bill_due_date || d.dueDate || undefined,
    billDate: d.bill_date || d.billDate || undefined,
    billNumber: d.bill_number || undefined,
    minAmount: num(d["Minimum Amount Due"]),
    maxAmount: num(d["Maximum Permissible Amount"]),
    billFetchRef: json.order_id,
  };
}

export function mapPay2NewStatus(
  raw: string | undefined
): "SUCCESS" | "PENDING" | "FAILED" | "REFUNDED" {
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

/** Read the fields Pay2New needs out of our generic customerParams bag. */
function ccParams(input: BbpsFetchInput): {
  number: string;
  mobile: string;
  pincode: string;
} | null {
  const p = input.customerParams;
  const number = p.number || p.cardLast4 || p.card_last4 || "";
  const mobile = p.customerNumber || p.customer_number || p.mobile || p.phone || "";
  if (!/^\d{4}$/.test(number) || !/^\d{10}$/.test(mobile)) return null;
  return { number, mobile, pincode: p.pincode || DEFAULT_PINCODE };
}

// ---------- extra (non-interface) API surface ----------

/** Partner-level charge preview for a given amount (base + 18% GST). */
export async function samedayBbpsCharges(amount: number): Promise<
  PartnerResult<{ baseCharge: number; gstAmount: number; totalCharge: number }>
> {
  const r = await samedayRequest<{
    success: boolean;
    charges?: { base_charge: number; gst_amount: number; total_charge: number };
  }>(creds(), "POST", `${P}/charges`, { amount });
  if (!r.ok) return r;
  const c = r.data.charges;
  return {
    ok: true,
    data: {
      baseCharge: c?.base_charge ?? 0,
      gstAmount: c?.gst_amount ?? 0,
      totalCharge: c?.total_charge ?? 0,
    },
    raw: r.raw,
  };
}

// ---------- provider ----------

export const samedayBbps: BbpsProvider = {
  name: "SAMEDAY_PAY2NEW",

  async billers(category) {
    if (category !== "CREDIT_CARD") {
      return { ok: false, code: "UNSUPPORTED_CATEGORY", message: `Pay2New only serves CREDIT_CARD billers (got ${category})` };
    }
    const r = await samedayRequest<BillersResponse>(creds(), "GET", `${P}/billers`);
    if (!r.ok) return r;
    const billers: BbpsBiller[] = (r.data.billers ?? []).map((b) => ({
      code: b.product_code,
      name: b.product_name,
      category: "CREDIT_CARD",
    }));
    return { ok: true, data: billers, raw: r.raw };
  },

  async fetchBill(input) {
    if (input.category !== "CREDIT_CARD") {
      return { ok: false, code: "UNSUPPORTED_CATEGORY", message: `This biller category is not live yet (${input.category})` };
    }
    const cc = ccParams(input);
    if (!cc) {
      return {
        ok: false,
        code: "BAD_PARAMS",
        message: "customerParams must include `number` (card last 4 digits) and `customerNumber` (registered 10-digit mobile)",
      };
    }
    const r = await samedayRequest<FetchBillResponse>(creds(), "POST", `${P}/bill/fetch`, {
      number: cc.number,
      product_code: input.billerCode,
      customer_number: cc.mobile,
      optional1: cc.mobile, // mandatory for CC billers
      optional2: "",
      optional3: "",
      optional4: "",
      pincode: cc.pincode,
    });
    if (!r.ok) return r;
    return { ok: true, data: mapPay2NewBill(r.data), partnerTxnId: r.data.order_id, raw: r.raw };
  },

  async pay(input: BbpsPayInput): Promise<PartnerResult<BbpsPayOutput>> {
    if (input.category !== "CREDIT_CARD") {
      return { ok: false, code: "UNSUPPORTED_CATEGORY", message: `This biller category is not live yet (${input.category})` };
    }
    const cc = ccParams(input);
    if (!cc) {
      return {
        ok: false,
        code: "BAD_PARAMS",
        message: "customerParams must include `number` (card last 4 digits) and `customerNumber` (registered 10-digit mobile)",
      };
    }
    const billFetchRef =
      input.customerParams.billFetchRef || input.customerParams.bill_fetch_ref || "";
    if (!billFetchRef) {
      return {
        ok: false,
        code: "MISSING_BILL_FETCH_REF",
        message: "Pay requires `billFetchRef` from a prior fetchBill (Pay2New order_id)",
      };
    }
    const r = await samedayRequest<PayResponse>(creds(), "POST", `${P}/bill/pay`, {
      number: cc.number,
      amount: input.amount,
      product_code: input.billerCode,
      product_name: input.customerParams.productName || input.billerCode.replace(/_/g, " "),
      bill_fetch_ref: billFetchRef,
      customer_number: cc.mobile,
      optional1: cc.mobile,
      optional2: input.remark ?? "",
      optional3: "",
      optional4: "",
      pincode: cc.pincode,
    });
    if (!r.ok) return r;
    return {
      ok: true,
      data: {
        txnReference: r.data.order_id || r.data.request_id || "",
        receipt: r.data.operator_reference || r.data.order_id || "",
      },
      partnerTxnId: r.data.order_id || r.data.request_id,
      raw: r.raw,
    };
  },

  async status(ref) {
    const body = ref.orderId ? { order_id: ref.orderId } : { request_id: ref.requestId };
    if (!body.order_id && !body.request_id) {
      return { ok: false, code: "BAD_PARAMS", message: "status() needs orderId or requestId" };
    }
    const r = await samedayRequest<StatusResponse>(creds(), "POST", `${P}/bill/status`, body);
    if (!r.ok) return r;
    return {
      ok: true,
      data: {
        status: mapPay2NewStatus(r.data.status),
        operatorRef: r.data.operator_reference ?? undefined,
      },
      raw: r.raw,
    };
  },
};
