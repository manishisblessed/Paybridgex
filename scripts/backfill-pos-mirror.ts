/**
 * One-time historical backfill for the POS transaction MIRROR.
 *
 * The ongoing reconciliation sweep (QUEUES.POS_MIRROR_SYNC) only pulls a short
 * rolling window (settings `pos.mirror_sync.lookbackDays`, default 2 days), and
 * the real-time webhook only fills captures going forward. So a freshly-created
 * `PosTransactionMirror` has no history — this script seeds it by sweeping a
 * wider window from the partner feed. Idempotent (upsert by canonical txn ref),
 * so it's safe to re-run and safe to overlap with the live sweep.
 *
 * Usage:  npm run backfill:pos-mirror -- [days] [maxPages]
 *   days      how far back to pull (default 60)
 *   maxPages  partner pages to fetch, 100 rows each (default 500 = 50k rows)
 */
try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.();
} catch {
  /* env provided by the shell */
}

async function main() {
  const { runPosMirrorSweep } = await import("@/lib/pos/mirror-sweep");

  const days = Number(process.argv[2]) || 60;
  const maxPages = Number(process.argv[3]) || 500;

  const dateTo = new Date();
  const dateFrom = new Date(dateTo.getTime() - days * 24 * 60 * 60 * 1000);

  console.log(
    `[backfill:pos-mirror] sweeping ${dateFrom.toISOString()} → ${dateTo.toISOString()} ` +
      `(maxPages=${maxPages})…`
  );

  const r = await runPosMirrorSweep({
    dateFrom: dateFrom.toISOString(),
    dateTo: dateTo.toISOString(),
    maxPages,
  });

  console.log("[backfill:pos-mirror] result:", JSON.stringify(r, null, 2));
  if (r.skipped) {
    console.warn(
      `[backfill:pos-mirror] SKIPPED (${r.reason}). Ensure POS is enabled and the ` +
        `pos.mirror_sync setting isn't paused.`
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("[backfill:pos-mirror] failed:", e);
  process.exit(1);
});
