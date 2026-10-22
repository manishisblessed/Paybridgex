import { flags } from "@/lib/env";
import { getSetting } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { getPosTransactions } from "@/lib/partners/sameday-pos";
import { upsertMirrorFromFeed } from "@/lib/pos/mirror";
import { handlePosReversal } from "@/lib/settlement/pos";

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
  /** Captures that flipped to VOIDED/REFUNDED, or CAPTURED→FAILED, and were
   *  reconciled (pending cancelled / settled flagged) this run. */
  reversed: number;
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
    reversed: 0,
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

    const { written, skipped, reversals } = await upsertMirrorFromFeed(rows);
    base.written += written;
    base.skippedRows += skipped;

    // Reconcile any capture that flipped to VOIDED/REFUNDED — or downgraded
    // CAPTURED→FAILED — this page: cancel a still-PENDING settlement, or flag an
    // already-settled one for clawback. This is the guard that stops a failed
    // swipe (briefly seen as captured) from paying out at the next T+1 run.
    // Serialized + best-effort so one bad row never aborts the sweep.
    for (const r of reversals) {
      try {
        await handlePosReversal({
          transactionRef: r.transactionRef,
          status: r.status,
          reason: r.reason,
          reversedAt: r.reversedAt,
          source: "SWEEP",
        });
        base.reversed++;
      } catch (e) {
        console.error("[pos mirror sweep] reversal reconcile failed:", r.transactionRef, e);
      }
    }

    if (!res.data.pagination?.has_next || rows.length === 0) break;
  }

  // ── Post-sweep reconciliation (TOCTOU race guard) ─────────────────────────
  // The mirror-settle sweep (POS_INGEST, every 10 min) reads CAPTURED mirror
  // rows and creates PENDING settlement entries. This mirror sync (every 2 min)
  // detects CAPTURED→FAILED transitions and calls handlePosReversal. A race
  // exists: if the settle sweep reads a CAPTURED row and starts creating the
  // entry at the same moment this sync detects the reversal, handlePosReversal
  // finds NO_ENTRY (entry not yet committed), and the entry is created moments
  // later — orphaned as PENDING on a non-CAPTURED mirror row. Subsequent syncs
  // see FAILED→FAILED (no transition), so the reversal is never re-triggered.
  //
  // This second pass catches ALL such orphans: a single indexed JOIN finds
  // PENDING entries whose mirror is no longer CAPTURED and cancels them. Cheap
  // (the PENDING set is small) and runs every 2 min, so orphans are cleaned up
  // within one sweep cycle instead of waiting for the T+1 cron or manual admin.
  // A 2-minute age gate avoids catching entries that are mid-creation (e.g. the
  // webhook creates the entry then updates the mirror in the same request).
  try {
    const cutoff = new Date(Date.now() - 2 * 60_000); // 2 min grace
    const orphaned = await prisma.$queryRaw<
      { transactionRef: string; mirrorStatus: string }[]
    >`
      SELECT e."transactionRef", m."status" AS "mirrorStatus"
      FROM "PosSettlementEntry" e
      JOIN "PosTransactionMirror" m ON m."transactionRef" = e."transactionRef"
      WHERE e."status" = 'PENDING'
        AND e."createdAt" < ${cutoff}
        AND UPPER(m."status") <> 'CAPTURED'
      LIMIT 100
    `;
    for (const o of orphaned) {
      try {
        const revStatus: "VOIDED" | "REFUNDED" | "FAILED" =
          o.mirrorStatus === "REFUNDED"
            ? "REFUNDED"
            : o.mirrorStatus === "VOIDED"
              ? "VOIDED"
              : "FAILED";
        await handlePosReversal({
          transactionRef: o.transactionRef,
          status: revStatus,
          reason: `auto-reconcile: entry PENDING but mirror ${o.mirrorStatus}`,
          reversedAt: null,
          source: "SWEEP",
        });
        base.reversed++;
      } catch (e) {
        console.error("[pos mirror sweep] orphan reconcile failed:", o.transactionRef, e);
      }
    }
  } catch (e) {
    console.error("[pos mirror sweep] orphan reconciliation query failed:", e);
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
