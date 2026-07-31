import { flags } from "@/lib/env";
import { getSetting } from "@/lib/settings";
import { getPosTransactions } from "@/lib/partners/sameday-pos";
import { upsertMirrorFromFeed } from "@/lib/pos/mirror";

/**
 * POS transaction mirror reconciliation sweep (step D of the read-model design).
 *
 * Pulls the partner's tenant-wide transaction feed (ALL statuses) over a short
 * lookback window and upserts every row into `PosTransactionMirror` by its
 * canonical RRN key. This is the completeness net behind the real-time capture
 * webhook: webhooks are at-most-once in practice (dropped during deploys,
 * partner outages, network blips), and they only carry CAPTURED rows — this
 * sweep repairs anything missed and backfills AUTHORIZED / FAILED / REFUNDED /
 * VOIDED rows so the display feed is complete.
 *
 * It reads from the partner but writes only to our DB (moves no money), and is
 * fully idempotent via the `transactionRef` @unique key, so overlapping/retried
 * runs are safe. Crucially, ONE tenant-wide sweep every couple of minutes
 * replaces N browsers each polling the partner every 5s — which is exactly what
 * keeps us under the partner's 100 req/min limit.
 */

export type PosMirrorSweepResult = {
  skipped: boolean;
  reason?: string;
  dateFrom?: string;
  dateTo?: string;
  pages: number;
  scanned: number;
  written: number;
  skippedRows: number;
};

/** Start of the IST day `days` ago, as a UTC ISO string. */
function istStartDaysAgoIso(days: number): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const startIstMs = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - days);
  return new Date(startIstMs - 5.5 * 60 * 60 * 1000).toISOString();
}

export async function runPosMirrorSweep(opts?: {
  dateFrom?: string;
  dateTo?: string;
  maxPages?: number;
}): Promise<PosMirrorSweepResult> {
  const base: PosMirrorSweepResult = {
    skipped: false,
    pages: 0,
    scanned: 0,
    written: 0,
    skippedRows: 0,
  };

  if (!flags.pos) return { ...base, skipped: true, reason: "POS partner disabled" };

  const cfg = await getSetting("pos.mirror_sync");
  if (!cfg.enabled || cfg.paused) return { ...base, skipped: true, reason: "mirror sync disabled/paused" };

  const dateFrom = opts?.dateFrom ?? istStartDaysAgoIso(cfg.lookbackDays);
  const dateTo = opts?.dateTo ?? new Date().toISOString();
  const maxPages = opts?.maxPages ?? cfg.maxPages;

  base.dateFrom = dateFrom;
  base.dateTo = dateTo;

  for (let page = 1; page <= maxPages; page++) {
    const res = await getPosTransactions({
      date_from: dateFrom,
      date_to: dateTo,
      status: null, // ALL statuses — the display feed shows more than captures
      terminal_id: null, // tenant-wide (this sweep runs server-side, not per user)
      page,
      page_size: 100,
    });

    if (!res.ok) {
      // Keep whatever we mirrored so far; surface the partner failure reason.
      return { ...base, reason: res.error.error?.message ?? "partner fetch failed" };
    }

    base.pages++;
    const rows = res.data.data ?? [];
    base.scanned += rows.length;

    const { written, skipped } = await upsertMirrorFromFeed(rows);
    base.written += written;
    base.skippedRows += skipped;

    if (!res.data.pagination?.has_next || rows.length === 0) break;
  }

  return base;
}

/**
 * Fast, narrow "recent" poll for near-real-time feed freshness (seconds-level).
 *
 * Same Day exposes NO capture webhooks, so freshness is bounded by how often we
 * poll them. This pulls only the last `windowMinutes` of activity, page 1 only,
 * so it is always a SINGLE partner request regardless of daily volume — cheap
 * enough to run every ~10s and stay far under the partner's 100 req/min limit.
 *
 * It delegates to `runPosMirrorSweep` so it inherits every guard (POS flag,
 * enabled/paused setting) and the idempotent RRN upsert. The 2-minute
 * `runPosMirrorSweep` sweep (2-day lookback) remains the completeness net that
 * repairs missed rows and backfills status changes (refunds / voids / amends).
 */
export async function runPosRecentSweep(opts?: {
  windowMinutes?: number;
}): Promise<PosMirrorSweepResult> {
  const windowMinutes = opts?.windowMinutes ?? 15;
  const dateFrom = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const dateTo = new Date().toISOString();
  return runPosMirrorSweep({ dateFrom, dateTo, maxPages: 1 });
}
