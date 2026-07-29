/**
 * BulkPe BBPS — utility bill payments across all categories.
 *
 * Activate: PARTNER_BBPS_ENABLED=true  (flags.bbps)
 *   needs: BULKPE_TOKEN (same Bearer token as payouts / Simple PG)
 *   opt:   BULKPE_BASE_URL (defaults to https://api.bulkpe.in/client)
 *
 * Flow (see the Bulkpe Bill Payments doc):
 *   listBillCategory → selectBiller → FetchBillSingle (save fetchId)
 *   → BillPayTxn (fetchId + unique reference) → transactionStatusCheck
 *
 * Money movement: payment debits our BulkPe Virtual Account. The retailer's
 * wallet debit / commission still runs through our own scheme (runTransaction)
 * — same split as the Same Day rail.
 *
 * Quirk: selectBiller's response swaps billerId/billerName (the BBPS code like
 * "AIRT00000NAT87" arrives under `billerName`). normalizeBulkpeBiller() fixes
 * that defensively regardless of which side the code lands on.
 *
 * Timeout rule: NEVER blind-retry pay. Payment carries our idempotencyKey as
 * the unique `reference`; on timeout use status() with the transactionId, and
 * runTransaction refunds on failure.
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
import { bulkpePost, bulkpeGet } from "./bulkpe";

const P = "/bbps";

/**
 * BBPS bearer token. BulkPe issues a BBPS-scoped token that is separate from
 * the payout/PG token, so BBPS uses BULKPE_BBPS_TOKEN when present and only
 * falls back to the shared BULKPE_TOKEN for backward compatibility.
 */
function bbpsToken(): string {
  const t = process.env.BULKPE_BBPS_TOKEN || process.env.BULKPE_TOKEN;
  if (!t) throw new Error("[bulkpe-bbps] no BBPS token configured (set BULKPE_BBPS_TOKEN or BULKPE_TOKEN)");
  return t;
}

/** BBPS POST/GET pinned to the BBPS-scoped token. */
function bbpsPost<T>(path: string, body: unknown) {
  return bulkpePost<T>(path, body, bbpsToken());
}
function bbpsGet<T>(path: string, params?: Record<string, string>) {
  return bulkpeGet<T>(path, params, bbpsToken());
}

/** True when a BBPS token (dedicated or shared) is present. */
export function bulkpeBbpsConfigured(): boolean {
  return Boolean(process.env.BULKPE_BBPS_TOKEN || process.env.BULKPE_TOKEN);
}

// ---------- category mapping ----------

/** Our category enum → BulkPe "biller" value from listBillCategory. */
export const BULKPE_CATEGORY: Record<BbpsFetchInput["category"], string> = {
  ELECTRICITY: "Electricity",
  WATER: "Water",
  GAS: "Gas",
  CREDIT_CARD: "Credit Card",
  EDUCATION: "Education Fees",
  INSURANCE: "Life Insurance",
  BROADBAND: "Broadband Postpaid",
};

// ---------- response shapes ----------

type BulkpeBillerRow = {
  category?: string;
  billerId?: string;
  billerName?: string;
  customerparams?: Array<{
    paramName?: string;
    dataType?: string;
    optional?: boolean;
  }>;
};

type BulkpeFetchBillData = {
  fetchId?: string;
  reference?: string;
  billerId?: string;
  category?: string;
  minAmount?: number | string;
  maxAmount?: number | string;
  amount?: number | string;
  status?: string;
  billDetails?: {
    customerName?: string;
    amount?: number | string;
    dueDate?: string;
    billDate?: string;
    billNumber?: string | null;
  };
  additionalData?: {
    tag?: Array<{ name?: string; value?: string }>;
  };
};

type BulkpePayData = {
  billerId?: string;
  category?: string;
  billerName?: string;
  reference?: string;
  transactionId?: string;
  fetchId?: string;
  npciRef?: string;
  amount?: number;
  charge?: number;
  gst?: number;
  totalCharge?: number;
  status?: string;
  message?: string;
};

// ---------- pure mapping helpers (unit-tested) ----------

/** True when a value looks like a BBPS biller code (e.g. AIRT00000NAT87). */
function looksLikeBillerCode(v: string): boolean {
  return /^[A-Z0-9]{8,20}$/.test(v) && /\d/.test(v);
}

/**
 * BulkPe's selectBiller swaps billerId/billerName in its documented response.
 * Pick whichever value looks like a BBPS code as `code`, the other as `name`.
 */
export function normalizeBulkpeBiller(
  row: BulkpeBillerRow,
  category: BbpsFetchInput["category"]
): BbpsBiller {
  const a = row.billerId ?? "";
  const b = row.billerName ?? "";
  const [code, name] = looksLikeBillerCode(b) && !looksLikeBillerCode(a) ? [b, a] : [a, b];
  return {
    code,
    name: name || code,
    category,
    params: (row.customerparams ?? []).map((p) => ({
      name: p.paramName ?? "",
      dataType: p.dataType ?? "ALPHANUMERIC",
      optional: Boolean(p.optional),
    })),
  };
}

/** Normalize the FetchBillSingle payload into our BbpsBill. */
export function mapBulkpeBill(data: BulkpeFetchBillData): BbpsBill {
  const num = (v: number | string | null | undefined) => {
    if (v === null || v === undefined || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const d = data.billDetails ?? {};
  const tag = (name: string) =>
    data.additionalData?.tag?.find((t) => (t.name ?? "").toLowerCase() === name.toLowerCase())?.value;
  return {
    customerName: d.customerName ?? "",
    amount: num(d.amount) ?? num(data.amount) ?? 0,
    dueDate: d.dueDate || undefined,
    billDate: d.billDate || undefined,
    billNumber: d.billNumber || undefined,
    minAmount: num(data.minAmount) ?? num(tag("Minimum Amount Due")),
    maxAmount: num(data.maxAmount) ?? num(tag("Maximum Permissible Amount")),
    billFetchRef: data.fetchId,
  };
}

export function mapBulkpeBbpsStatus(
  raw: string | undefined
): "SUCCESS" | "PENDING" | "FAILED" | "REFUNDED" {
  switch ((raw || "").toUpperCase()) {
    case "SUCCESS":
      return "SUCCESS";
    case "FAILED":
    case "CANCELLED":
      return "FAILED";
    case "REFUNDED":
    case "REFUND":
    case "REVERSED":
      return "REFUNDED";
    default:
      return "PENDING";
  }
}

/**
 * Build BulkPe's custParam array from our generic customerParams bag.
 * Keys are passed through as biller param names (the UI collects them from
 * billers() → params). Known internal credit-card keys are translated to
 * their canonical BBPS names as a best effort for the existing CC form.
 */
export function buildCustParams(customerParams: Record<string, string>): Array<{ name: string; value: string }> {
  const RESERVED = new Set(["billFetchRef", "bill_fetch_ref", "productName", "pincode"]);
  const TRANSLATE: Record<string, string> = {
    number: "Last 4 digits of Credit Card Number",
    cardLast4: "Last 4 digits of Credit Card Number",
    card_last4: "Last 4 digits of Credit Card Number",
    customerNumber: "Registered Mobile Number",
    customer_number: "Registered Mobile Number",
    mobile: "Registered Mobile Number",
    phone: "Registered Mobile Number",
  };
  const out: Array<{ name: string; value: string }> = [];
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(customerParams)) {
    if (RESERVED.has(key) || !value) continue;
    const name = TRANSLATE[key] ?? key;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, value });
  }
  return out;
}

// ---------- provider ----------

export const bulkpeBbps: BbpsProvider = {
  name: "BULKPE_BBPS",

  async billers(category) {
    const biller = BULKPE_CATEGORY[category];
    const r = await bbpsPost<BulkpeBillerRow[]>(`${P}/selectBiller`, { biller });
    if (!r.ok) return r;
    const rows = Array.isArray(r.data) ? r.data : [];
    return { ok: true, data: rows.map((row) => normalizeBulkpeBiller(row, category)), raw: r.raw };
  },

  async fetchBill(input) {
    const custParam = buildCustParams(input.customerParams);
    if (custParam.length === 0) {
      return { ok: false, code: "BAD_PARAMS", message: "customerParams must include the biller's required fields" };
    }
    // Fetch references must be unique at BulkPe; suffix so a user retrying a
    // fetch (same idempotencyKey) doesn't collide with the earlier attempt.
    const reference = `${input.idempotencyKey}F${Date.now().toString(36)}`.slice(0, 40);
    const r = await bbpsPost<BulkpeFetchBillData>(`${P}/FetchBillSingle`, {
      reference,
      billerId: input.billerCode,
      custParam,
    });
    if (!r.ok) return r;
    return { ok: true, data: mapBulkpeBill(r.data), partnerTxnId: r.data.fetchId, raw: r.raw };
  },

  async pay(input: BbpsPayInput): Promise<PartnerResult<BbpsPayOutput>> {
    const fetchId = input.customerParams.billFetchRef || input.customerParams.bill_fetch_ref || "";
    if (!fetchId) {
      return {
        ok: false,
        code: "MISSING_BILL_FETCH_REF",
        message: "Pay requires `billFetchRef` from a prior fetchBill (BulkPe fetchId)",
      };
    }
    const r = await bbpsPost<BulkpePayData>(`${P}/BillPayTxn`, {
      fetchId,
      amount: String(input.amount),
      reference: input.idempotencyKey,
    });
    if (!r.ok) return r;
    const status = mapBulkpeBbpsStatus(r.data.status);
    if (status === "FAILED") {
      return { ok: false, code: "BBPS_FAILED", message: r.data.message || "Bill payment failed", raw: r.raw };
    }
    return {
      ok: true,
      pending: status === "PENDING",
      data: {
        txnReference: r.data.transactionId || r.data.reference || "",
        receipt: r.data.npciRef || r.data.transactionId || "",
      },
      partnerTxnId: r.data.transactionId,
      raw: r.raw,
    };
  },

  async status(ref) {
    const transactionId = ref.orderId || ref.requestId;
    if (!transactionId) {
      return { ok: false, code: "BAD_PARAMS", message: "status() needs the BulkPe transactionId (orderId)" };
    }
    const r = await bbpsPost<BulkpePayData>(`${P}/transactionStatusCheck`, { transactionId });
    if (!r.ok) return r;
    return {
      ok: true,
      data: {
        status: mapBulkpeBbpsStatus(r.data.status),
        operatorRef: r.data.npciRef || undefined,
      },
      raw: r.raw,
    };
  },
};

// ---------- extra (non-interface) API surface ----------

/** Live category list (e.g. for an admin catalog page). */
export async function bulkpeBbpsCategories(): Promise<
  PartnerResult<Array<{ biller: string; category: string }>>
> {
  return bbpsPost(`${P}/listBillCategory`, {});
}

/** Paginated BBPS transaction history — used by reconciliation sweeps. */
export async function bulkpeBbpsTransactions(opts: {
  page?: number;
  limit?: number;
  category?: string;
  status?: "SUCCESS" | "PENDING" | "FAILED";
}): Promise<PartnerResult<BulkpePayData[]>> {
  return bbpsPost(`${P}/listBillTransactions`, {
    page: opts.page != null ? String(opts.page) : "",
    limit: String(opts.limit ?? 50),
    category: opts.category ?? "",
    status: opts.status ?? "",
  });
}

// ---------- pending bills ----------

export type BulkpePendingBill = {
  billerId: string;
  category: string;
  billerName: string;
  accountId?: string;
  aliasName?: string;
  customerParams?: Array<{ name: string; value: string }>;
  dueDate?: string;
  billAmount?: number;
  isAutofetchEnabled?: boolean;
  costCenter?: string;
  udf1?: string;
  udf2?: string;
  status?: string;
  createdAt?: string;
};

/** Fetch pending bills from BulkPe (auto-fetched bill accounts). */
export async function bulkpeBbpsPendingBills(opts?: {
  page?: number;
  limit?: number;
  billerCategory?: string;
  isAutofetchEnabled?: 1 | 2;
  sort?: "dueDate" | "createdAt";
  order?: "asc" | "desc";
}): Promise<PartnerResult<BulkpePendingBill[]>> {
  const params: Record<string, string> = {};
  if (opts?.page != null) params.page = String(opts.page);
  if (opts?.limit != null) params.limit = String(opts.limit);
  if (opts?.billerCategory) params.billerCategory = opts.billerCategory;
  if (opts?.isAutofetchEnabled != null) params.isAutofetchEnabled = String(opts.isAutofetchEnabled);
  if (opts?.sort) params.sort = opts.sort;
  if (opts?.order) params.order = opts.order;
  return bbpsGet(`${P}/listPendingBills`, params);
}
