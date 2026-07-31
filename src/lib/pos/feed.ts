import { enrichPosTransactions } from "@/lib/pos/enrich";
import { getBinLastLowBalanceAt } from "@/lib/pos/binLookup";
import { getCardClassificationSetting } from "@/lib/settings";
import { queryMirrorPage, summarizeMirror, type MirrorQueryFilters } from "@/lib/pos/mirror";
import type { PosTransactionsResponse } from "@/lib/partners/sameday-pos.types";

/**
 * Build one page of the POS transaction feed response from the local mirror.
 *
 * Shared by the live feed (POST /api/pos/transactions) and the SSE stream
 * (GET /api/pos/transactions/stream) so both return the IDENTICAL payload shape
 * — a page of enriched rows + a full-set summary + card-classification meta.
 * Reads only our DB (no partner call).
 */
export async function buildPosFeedResponse(
  filters: MirrorQueryFilters,
  page: number,
  pageSize: number,
  company: string | null
): Promise<PosTransactionsResponse> {
  const [{ rows, total }, summary] = await Promise.all([
    queryMirrorPage(filters, page, pageSize),
    summarizeMirror(filters),
  ]);

  // Capture before enrichment so we can tell if a low-balance BIN rejection
  // happened during THIS request (vs. a stale one from an earlier request).
  const enrichStartedAt = Date.now();
  const [enriched, cardClassification] = await Promise.all([
    enrichPosTransactions(rows),
    getCardClassificationSetting(),
  ]);
  const classificationDegraded =
    cardClassification.enabled && getBinLastLowBalanceAt() >= enrichStartedAt;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return {
    success: true,
    company: company ?? "",
    data: enriched,
    pagination: {
      page,
      page_size: pageSize,
      total_records: total,
      total_pages: totalPages,
      has_next: page < totalPages,
      has_prev: page > 1,
    },
    summary,
    enrichment: {
      classificationDegraded,
      showClassification: cardClassification.showInUi,
      ...(classificationDegraded ? { reason: "BIN_PROVIDER_LOW_BALANCE" as const } : {}),
    },
  };
}

/**
 * A cheap change-signature over a feed payload. The SSE stream pushes a new
 * message only when this changes, so idle clients get heartbeats instead of
 * redundant re-renders. Covers row count, monetary totals, per-status counts,
 * and the newest row — which captures new swipes and status transitions.
 */
export function feedSignature(payload: PosTransactionsResponse): string {
  const s = payload.summary;
  const top = payload.data[0];
  return [
    payload.pagination.total_records,
    s.total_amount,
    s.captured_amount,
    s.authorized_count,
    s.captured_count,
    s.failed_count,
    s.refunded_count,
    top?.rrn ?? "",
    top?.txn_time ?? "",
    top?.status ?? "",
  ].join("|");
}
