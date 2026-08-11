/**
 * Backfill the GST split on historical BBPS bill-payment transactions.
 *
 * Before service-rail revenue tracking, `Transaction.gst` was never populated
 * for BBPS: the whole GST-inclusive customer charge sat in `fee` with `gst = 0`.
 * The revenue report now nets GST out of platform revenue, so legacy rows would
 * still overstate revenue by the embedded GST until this one-off backfill runs.
 *
 * Derivation (safe for BOTH GST-inclusive and exclusive slabs, because in every
 * case `fee` is the GST-INCLUSIVE total the customer paid):
 *
 *   base = ROUND(fee / 1.18, 2)      gst = fee − base
 *
 * Scope: the six BILL_* service codes (produced ONLY by the /services/bbps/pay
 * route, where `fee` is guaranteed GST-inclusive), SUCCESS, `fee > 0`, and
 * `gst = 0` (so already-correct new rows are never touched). RECHARGE_BROADBAND
 * is deliberately EXCLUDED — that code is ambiguous (it can also flow through a
 * recharge route with different fee semantics).
 *
 * `vendorCharge` is NOT backfilled: historical upstream/vendor rates are not
 * snapshotted on old rows, so it stays 0 (revenue for these rows excludes GST
 * but still treats the whole ex-GST charge as revenue — a strict improvement).
 *
 * SAFETY: dry-run by default (writes NOTHING). Pass `--apply` to persist. The
 * `gst = 0` filter makes re-runs idempotent — once set, a row is skipped.
 *
 * Run (repo root, DATABASE_URL set):
 *   npx tsx scripts/backfill-bbps-gst.ts            # dry-run (preview only)
 *   npx tsx scripts/backfill-bbps-gst.ts --apply    # write
 */
import "./_load-env";
import { prisma } from "../src/lib/db";

const BBPS_SERVICES = [
  "BILL_ELECTRICITY",
  "BILL_WATER",
  "BILL_GAS",
  "BILL_CREDIT_CARD",
  "BILL_EDUCATION",
  "BILL_INSURANCE",
] as const;

const APPLY = process.argv.includes("--apply");

// base = ROUND(fee/1.18, 2); gst = fee − base (keeps base + gst === fee exactly).
const GST_EXPR = "(fee - ROUND(fee / 1.18, 2))";

async function main() {
  const inList = BBPS_SERVICES.map((s) => `'${s}'`).join(", ");
  const whereSql = `status = 'SUCCESS' AND gst = 0 AND fee > 0 AND service::text IN (${inList})`;

  const preview = await prisma.$queryRawUnsafe<
    Array<{ service: string; rows: bigint; feetotal: string; gsttotal: string }>
  >(
    `SELECT service::text AS service,
            COUNT(*)::bigint AS rows,
            COALESCE(SUM(fee), 0)::text AS feetotal,
            COALESCE(SUM(${GST_EXPR}), 0)::text AS gsttotal
     FROM "Transaction"
     WHERE ${whereSql}
     GROUP BY service
     ORDER BY service`
  );

  if (preview.length === 0) {
    console.log("Nothing to backfill — every eligible BBPS transaction already has gst set.");
    return;
  }

  console.log(
    `${APPLY ? "APPLYING" : "DRY-RUN"} — historical BBPS Transaction.gst backfill (gst = fee − ROUND(fee/1.18, 2)):\n`
  );
  let totalRows = 0;
  let totalGst = 0;
  for (const p of preview) {
    const rows = Number(p.rows);
    const fee = parseFloat(p.feetotal);
    const gst = parseFloat(p.gsttotal);
    totalRows += rows;
    totalGst += gst;
    console.log(
      `  ${p.service.padEnd(20)} ${String(rows).padStart(7)} rows   fee ₹${fee.toLocaleString(
        "en-IN"
      )}   → gst ₹${gst.toLocaleString("en-IN")}`
    );
  }
  console.log(`\n  TOTAL ${String(totalRows).padStart(21)} rows   → gst ₹${totalGst.toLocaleString("en-IN")}\n`);

  if (!APPLY) {
    console.log("Dry-run only — nothing written. Re-run with --apply to persist.");
    console.log("NOTE: vendorCharge is NOT backfilled (historical vendor rates aren't snapshotted).");
    return;
  }

  const affected = await prisma.$executeRawUnsafe(
    `UPDATE "Transaction" SET gst = ${GST_EXPR}, "updatedAt" = now() WHERE ${whereSql}`
  );
  console.log(`✔ Backfill complete — updated ${affected} transaction(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
