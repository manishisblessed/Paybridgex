import { dec, toNumber } from "@/lib/money";

/**
 * Shared rail-aggregation primitives for the "business overview" family of
 * dashboards (platform-wide master-admin overview AND the hierarchical network
 * overview). Extracted so both surfaces classify statuses, fold status-grouped
 * rows and total rails IDENTICALLY — the numbers must never diverge between the
 * admin view and what a distributor sees for their own network.
 *
 * Convention (matches the app's reporting rules):
 *   • the headline rupee AMOUNT reflects COMPLETED business only (success/settled
 *     rows) so pending captures and failed/reversed rows never inflate it;
 *   • the transaction COUNT reflects ALL activity, broken out by status bucket.
 */

export type Bucket = "success" | "pending" | "failed";

export type ServiceToday = {
  /** Rupee value of COMPLETED business only (success/settled rows). Headline. */
  amount: number;
  /** Rupee value still awaiting settlement / in-flight (pending rows). */
  pendingAmount: number;
  /** Rupee value of failed / reversed rows (money did not move). */
  failedAmount: number;
  /** Total activity across every status. */
  count: number;
  success: number;
  pending: number;
  failed: number;
};

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Normalize a Prisma groupBy-by-status result into flat rows. */
export function normalize(
  rows: Array<{ status: string; _count: number; _sum: Record<string, unknown> }>,
  amountField: string
): Array<{ status: string; count: number; amount: number }> {
  return rows.map((r) => ({
    status: String(r.status),
    count: typeof r._count === "number" ? r._count : 0,
    amount: toNumber(dec((r._sum?.[amountField] as never) ?? 0)),
  }));
}

/**
 * Fold status-grouped rows into a single card summary. `amount` is the value of
 * COMPLETED business only (rows whose status maps to "success"); pending/failed
 * contribute to their counts but never to the headline rupee figure. `count` is
 * total activity across every status.
 */
export function summarize(
  rows: Array<{ status: string; count: number; amount: number }>,
  classify: (status: string) => Bucket
): ServiceToday {
  const out = emptyServiceToday();
  for (const r of rows) {
    const bucket = classify(r.status);
    out.count += r.count;
    out[bucket] += r.count;
    if (bucket === "success") out.amount += r.amount;
    else if (bucket === "pending") out.pendingAmount += r.amount;
    else out.failedAmount += r.amount;
  }
  out.amount = round2(out.amount);
  out.pendingAmount = round2(out.pendingAmount);
  out.failedAmount = round2(out.failedAmount);
  return out;
}

export function emptyServiceToday(): ServiceToday {
  return {
    amount: 0,
    pendingAmount: 0,
    failedAmount: 0,
    count: 0,
    success: 0,
    pending: 0,
    failed: 0,
  };
}

export function addServiceTotals(parts: ServiceToday[]): ServiceToday {
  const total = emptyServiceToday();
  for (const p of parts) {
    total.amount += p.amount;
    total.pendingAmount += p.pendingAmount;
    total.failedAmount += p.failedAmount;
    total.count += p.count;
    total.success += p.success;
    total.pending += p.pending;
    total.failed += p.failed;
  }
  total.amount = round2(total.amount);
  total.pendingAmount = round2(total.pendingAmount);
  total.failedAmount = round2(total.failedAmount);
  return total;
}

/** Add `b` into `a` in place (per-member rollup accumulation). */
export function accumulate(a: ServiceToday, b: ServiceToday): void {
  a.amount = round2(a.amount + b.amount);
  a.pendingAmount = round2(a.pendingAmount + b.pendingAmount);
  a.failedAmount = round2(a.failedAmount + b.failedAmount);
  a.count += b.count;
  a.success += b.success;
  a.pending += b.pending;
  a.failed += b.failed;
}

/* ── per-rail status classifiers (each rail uses its own status vocabulary) ── */

export const classifyQr = (s: string): Bucket =>
  s === "SETTLED" || s === "APPROVED"
    ? "success"
    : s === "REJECTED" || s === "CLAWED_BACK"
    ? "failed"
    : "pending";

export const classifyPos = (s: string): Bucket =>
  s === "SETTLED" ? "success" : s === "FAILED" || s === "REVERSED" ? "failed" : "pending";

export const classifyPg = (s: string): Bucket =>
  s === "SETTLED" ? "success" : s === "FAILED" ? "failed" : "pending";

export const classifyTxn = (s: string): Bucket =>
  s === "SUCCESS" ? "success" : s === "FAILED" || s === "REFUNDED" ? "failed" : "pending";

export const classifyPayout = (s: string): Bucket =>
  s === "SUCCESS"
    ? "success"
    : s === "FAILED" || s === "REJECTED" || s === "REVERSED"
    ? "failed"
    : "pending";
