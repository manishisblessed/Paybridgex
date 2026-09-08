/**
 * One-time POS back-reconciliation against the Same Day Solution pull API.
 *
 * Some historical reversals may predate our webhook handling. This script pulls
 * ALL transactions from the partner feed over the affected date range and fixes
 * any we still hold as CAPTURED/SETTLED that are now reversed upstream.
 *
 * What it does:
 *   1. Pages through the partner feed from date_from to date_to (max 90 days).
 *   2. For every record where reversed_at != null OR status in (FAILED, VOIDED, REFUNDED):
 *      - Reverses/removes it in our books (mirror + settlement entry).
 *   3. Produces a reconciliation report of what was changed.
 *
 * This is a STATUS/BOOKKEEPING correction only — no fund movement expected.
 * Entries that were already settled (money left the building) are flagged for
 * the admin Reversals desk.
 *
 * Usage:
 *   npx tsx scripts/pos-back-reconcile.ts [dateFrom] [dateTo] [maxPages]
 *
 *   dateFrom   ISO date, default 2026-07-01
 *   dateTo     ISO date, default now
 *   maxPages   max partner pages to fetch (default 500)
 *
 * Idempotent: safe to re-run. handlePosReversal is idempotent and the mirror
 * upsert is keyed on the canonical transactionRef.
 */

// Mark this file as a module so its top-level `main` is scoped here and does
// not collide with the `main` declared in other standalone scripts (TS2393).
export {};

try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.();
} catch {
  /* env provided by the shell */
}

const REVERSED_STATUSES = new Set(["FAILED", "VOIDED", "REFUNDED"]);

type ReconEntry = {
  transactionRef: string;
  txnId: string;
  terminalId: string;
  rrn: string;
  amount: string;
  previousStatus: string;
  newStatus: string;
  reversedAt: string | null;
  reversalReason: string | null;
  outcome: string;
  wasSettled: boolean;
};

async function main() {
  const { getPosTransactions, canonicalPosCaptureRef } = await import(
    "@/lib/partners/sameday-pos"
  );
  const { handlePosReversal } = await import("@/lib/settlement/pos");
  const { upsertMirrorFromFeed } = await import("@/lib/pos/mirror");

  const defaultFrom = "2026-07-01T00:00:00.000Z";
  const dateFrom = process.argv[2] || defaultFrom;
  const dateTo = process.argv[3] || new Date().toISOString();
  const maxPages = Number(process.argv[4]) || 500;

  console.log(
    `[pos-back-reconcile] scanning ${dateFrom} → ${dateTo} (maxPages=${maxPages})…`
  );

  const report: ReconEntry[] = [];
  let totalScanned = 0;
  let totalReversed = 0;
  let totalAlreadyOk = 0;
  let totalSettledFlagged = 0;
  let totalPendingCancelled = 0;
  let totalNoEntry = 0;
  let totalMirrorWritten = 0;
  let pages = 0;

  // Page through the ENTIRE affected range. Max 90-day window per API call.
  // If the range exceeds 90 days, chunk it.
  const startDate = new Date(dateFrom);
  const endDate = new Date(dateTo);
  const MAX_RANGE_MS = 89 * 24 * 60 * 60 * 1000; // 89 days (safety margin)

  let chunkFrom = new Date(startDate);

  while (chunkFrom < endDate && pages < maxPages) {
    const chunkTo = new Date(
      Math.min(chunkFrom.getTime() + MAX_RANGE_MS, endDate.getTime())
    );

    console.log(
      `[pos-back-reconcile] chunk: ${chunkFrom.toISOString()} → ${chunkTo.toISOString()}`
    );

    let page = 1;
    let hasNext = true;

    while (hasNext && pages < maxPages) {
      const res = await getPosTransactions({
        date_from: chunkFrom.toISOString(),
        date_to: chunkTo.toISOString(),
        status: null,
        page,
        page_size: 100,
      });

      pages++;

      if (!res.ok) {
        console.error(
          `[pos-back-reconcile] partner fetch failed on page ${page}:`,
          res.error.error?.message ?? "unknown error"
        );
        break;
      }

      const rows = res.data.data ?? [];
      totalScanned += rows.length;

      // First, upsert ALL rows into the mirror so statuses are up-to-date.
      const mirrorResult = await upsertMirrorFromFeed(rows);
      totalMirrorWritten += mirrorResult.written;

      // Then, find rows that are reversed upstream and reconcile.
      for (const row of rows) {
        const status = (row.status ?? "").toUpperCase();
        const isReversed =
          REVERSED_STATUSES.has(status) || row.reversed_at != null;
        if (!isReversed) continue;

        const transactionRef = canonicalPosCaptureRef({
          rrn: row.rrn,
          terminalId: row.terminal_id,
          fallbackId: row.razorpay_txn_id || row.external_ref || `SDP-${row.id}`,
        });
        if (!transactionRef) continue;

        const reversalStatus: "VOIDED" | "REFUNDED" =
          status === "REFUNDED" ? "REFUNDED" : "VOIDED";

        try {
          const result = await handlePosReversal({
            transactionRef,
            status: reversalStatus,
            reason: row.reversal_reason ?? `recon:${status}`,
            reversedAt: row.reversed_at ?? null,
            source: "SWEEP",
          });

          const entry: ReconEntry = {
            transactionRef,
            txnId: row.razorpay_txn_id ?? "",
            terminalId: row.terminal_id,
            rrn: row.rrn,
            amount: row.amount,
            previousStatus: "CAPTURED",
            newStatus: status,
            reversedAt: row.reversed_at ?? null,
            reversalReason: row.reversal_reason ?? null,
            outcome: result.outcome,
            wasSettled: result.wasSettled ?? false,
          };

          switch (result.outcome) {
            case "PENDING_CANCELLED":
              totalPendingCancelled++;
              totalReversed++;
              report.push(entry);
              break;
            case "SETTLED_FLAGGED":
              totalSettledFlagged++;
              totalReversed++;
              report.push(entry);
              break;
            case "NO_ENTRY":
              totalNoEntry++;
              totalReversed++;
              report.push(entry);
              break;
            case "ALREADY_REVERSED":
              totalAlreadyOk++;
              break;
          }
        } catch (e) {
          console.error(
            `[pos-back-reconcile] failed to reconcile ${transactionRef}:`,
            e instanceof Error ? e.message : e
          );
        }
      }

      hasNext = res.data.pagination?.has_next ?? false;
      page++;

      // Progress logging every 5 pages.
      if (pages % 5 === 0) {
        console.log(
          `[pos-back-reconcile] progress: ${pages} pages, ${totalScanned} scanned, ` +
            `${totalReversed} reversed, ${totalAlreadyOk} already ok`
        );
      }
    }

    // Move to the next 90-day chunk.
    chunkFrom = new Date(chunkTo.getTime() + 1);
  }

  // ── Print reconciliation report ─────────────────────────────────────────
  console.log("\n" + "=".repeat(80));
  console.log("POS BACK-RECONCILIATION REPORT");
  console.log("=".repeat(80));
  console.log(`Date range   : ${dateFrom} → ${dateTo}`);
  console.log(`Pages fetched: ${pages}`);
  console.log(`Rows scanned : ${totalScanned}`);
  console.log(`Mirror writes: ${totalMirrorWritten}`);
  console.log(`Reversals    : ${totalReversed}`);
  console.log(`  - PENDING cancelled (no money moved)   : ${totalPendingCancelled}`);
  console.log(`  - SETTLED flagged (needs clawback review): ${totalSettledFlagged}`);
  console.log(`  - NO_ENTRY (display-only, mirror flipped): ${totalNoEntry}`);
  console.log(`Already reversed (idempotent no-op)       : ${totalAlreadyOk}`);

  if (totalSettledFlagged > 0) {
    console.log("\n⚠ ATTENTION: The following entries had ALREADY been settled to");
    console.log("retailer wallets. Review them in Admin → POS → Reversals desk:");
    for (const e of report.filter((r) => r.wasSettled)) {
      console.log(
        `  ${e.transactionRef} | ₹${e.amount} | ${e.terminalId} | ` +
          `${e.newStatus} | ${e.reversalReason ?? "no reason"}`
      );
    }
  }

  if (report.length > 0) {
    console.log("\n── Detailed changes ─────────────────────────────────────────");
    console.log(
      "transactionRef | amount | terminalId | rrn | status | outcome | wasSettled | reason"
    );
    for (const e of report) {
      console.log(
        `${e.transactionRef} | ₹${e.amount} | ${e.terminalId} | ` +
          `${e.rrn} | ${e.newStatus} | ${e.outcome} | ${e.wasSettled} | ${e.reversalReason ?? "-"}`
      );
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log(
    totalSettledFlagged > 0
      ? `Done. ${totalSettledFlagged} entries need manual clawback review.`
      : "Done. No manual intervention required."
  );

  process.exit(0);
}

main().catch((e) => {
  console.error("[pos-back-reconcile] FATAL:", e);
  process.exit(1);
});
