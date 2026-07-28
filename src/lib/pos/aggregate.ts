import { getPosTransactions } from "@/lib/partners/sameday-pos";
import type {
  PosTransaction,
  PosTransactionsSummary,
  PosTransactionStatus,
  PosPaymentMode,
} from "@/lib/partners/sameday-pos.types";
import type { ScopedTerminal } from "@/lib/pos/assignments";

/**
 * Multi-terminal aggregation for the POS feed.
 *
 * The partner transactions endpoint only accepts a SINGLE `terminal_id` (or
 * null, which returns the tenant-wide feed and must never be exposed to
 * non-admins). So when a user owns several terminals and hasn't picked one, we
 * crawl each of their terminals, union the rows, sort newest-first and compute a
 * combined summary here — giving an "all my terminals" view that is still
 * strictly scoped to what the caller owns.
 */

const PARTNER_PAGE_SIZE = 100;

export type AggregateFilters = {
  date_from: string;
  date_to: string;
  status?: PosTransactionStatus | null;
  payment_mode?: PosPaymentMode | null;
};

export type AggregateCaps = {
  /** Max pages fetched per terminal (partner page size is 100). */
  maxPagesPerTerminal?: number;
  /** Global row ceiling so a single aggregation can never run unbounded. */
  maxTotalRows?: number;
};

export type AggregateResult = {
  /** Merged rows across all terminals, sorted by txn_time descending (unenriched). */
  rows: PosTransaction[];
  summary: PosTransactionsSummary;
  /** True when a cap was hit before the full history could be crawled. */
  truncated: boolean;
  /** True when at least one terminal's fetch failed upstream. */
  failed: boolean;
};

function computeSummary(rows: PosTransaction[]): PosTransactionsSummary {
  let totalAmount = 0;
  let capturedAmount = 0;
  let authorized = 0;
  let captured = 0;
  let failed = 0;
  let refunded = 0;
  const tids = new Set<string>();

  for (const r of rows) {
    const amt = parseFloat(r.amount) || 0;
    totalAmount += amt;
    if (r.terminal_id) tids.add(r.terminal_id);
    switch (r.status) {
      case "AUTHORIZED":
        authorized++;
        break;
      case "CAPTURED":
        captured++;
        capturedAmount += amt;
        break;
      case "FAILED":
        failed++;
        break;
      case "REFUNDED":
        refunded++;
        break;
      default:
        break;
    }
  }

  return {
    total_transactions: rows.length,
    total_amount: totalAmount.toFixed(2),
    authorized_count: authorized,
    captured_count: captured,
    failed_count: failed,
    refunded_count: refunded,
    captured_amount: capturedAmount.toFixed(2),
    terminal_count: tids.size,
  };
}

function txnTimeMs(t: PosTransaction): number {
  const ms = new Date(t.txn_time ?? t.created_at).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Crawl every terminal in `terminals` and return the merged, newest-first feed.
 * Each terminal's `date_from` is clamped to its assignment time so a caller can
 * never see transactions from before they held the machine.
 */
export async function crawlScopedTransactions(
  terminals: ScopedTerminal[],
  filters: AggregateFilters,
  caps: AggregateCaps = {}
): Promise<AggregateResult> {
  const maxPagesPerTerminal = caps.maxPagesPerTerminal ?? 20;
  const maxTotalRows = caps.maxTotalRows ?? 5000;

  const all: PosTransaction[] = [];
  let truncated = false;
  let failed = false;

  for (const t of terminals) {
    if (all.length >= maxTotalRows) {
      truncated = true;
      break;
    }

    // Clamp to the assignment date so previous holders' data stays hidden.
    let dateFrom = filters.date_from;
    if (t.assignedAt) {
      const assignedIso = t.assignedAt.toISOString();
      if (dateFrom < assignedIso) dateFrom = assignedIso;
    }

    for (let page = 1; page <= maxPagesPerTerminal; page++) {
      const res = await getPosTransactions({
        date_from: dateFrom,
        date_to: filters.date_to,
        status: filters.status ?? null,
        payment_mode: filters.payment_mode ?? null,
        terminal_id: t.tid,
        page,
        page_size: PARTNER_PAGE_SIZE,
      });

      if (!res.ok) {
        failed = true;
        break;
      }

      all.push(...res.data.data);

      const hasNext = res.data.pagination?.has_next ?? false;
      if (!hasNext || res.data.data.length === 0) break;

      if (all.length >= maxTotalRows) {
        truncated = true;
        break;
      }
    }
  }

  all.sort((a, b) => {
    const diff = txnTimeMs(b) - txnTimeMs(a);
    if (diff !== 0) return diff;
    return (b.id ?? 0) - (a.id ?? 0);
  });

  return { rows: all, summary: computeSummary(all), truncated, failed };
}
