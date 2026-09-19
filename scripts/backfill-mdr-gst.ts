/**
 * Backfill the GST split on historical POS / PG / QR settlement transactions.
 *
 * Before per-scheme MDR GST, the acquiring rails recorded the company MDR margin
 * (MDR − vendor) in `fee` with `gst = 0` — so the GST report under-reported the
 * output-tax due on that margin. Going forward the settlement engines carve GST
 * from the margin per the slab's `mdrGstInclusive` flag (default: inclusive @18%);
 * this one-off backfill applies the SAME inclusive derivation to legacy rows so
 * past months' GST filings tie out.
 *
 * Derivation (margin is treated as GST-INCLUSIVE @18%, the chosen default):
 *
 *   base = ROUND(fee / 1.18, 2)      gst = fee − base
 *
 * Scope: settlement anchors only (`isSettlement = true` — minted exclusively for
 * POS/PG/QR upline commission), SUCCESS, `fee > 0`, and `gst = 0` (so already
 * correct rows are never touched — this makes re-runs idempotent).
 *
 * NOTE: this corrects the GST REPORT figures only; it deliberately does NOT
 * rewrite historical Revenue Wallet ledger entries (those balances stay as
 * booked). Going forward, revenue is booked ex-GST at settlement time.
 *
 * SAFETY: dry-run by default (writes NOTHING). Pass `--apply` to persist.
 *
 * Run (repo root, DATABASE_URL set):
 *   npx tsx scripts/backfill-mdr-gst.ts            # dry-run (preview only)
 *   npx tsx scripts/backfill-mdr-gst.ts --apply    # write
 */
import "./_load-env";
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");

// base = ROUND(fee/1.18, 2); gst = fee − base (keeps base + gst === fee exactly).
const GST_EXPR = "(fee - ROUND(fee / 1.18, 2))";
const WHERE_SQL = `"isSettlement" = true AND status = 'SUCCESS' AND gst = 0 AND fee > 0`;

async function main() {
  const preview = await prisma.$queryRawUnsafe<
    Array<{ label: string; rows: bigint; feetotal: string; gsttotal: string }>
  >(
    `SELECT CASE
              WHEN service::text = 'WALLET_TOPUP' THEN 'PG'
              ELSE service::text
            END AS label,
            COUNT(*)::bigint AS rows,
            COALESCE(SUM(fee), 0)::text AS feetotal,
            COALESCE(SUM(${GST_EXPR}), 0)::text AS gsttotal
     FROM "Transaction"
     WHERE ${WHERE_SQL}
     GROUP BY label
     ORDER BY label`
  );

  if (preview.length === 0) {
    console.log("Nothing to backfill — every settlement transaction already has gst set.");
    return;
  }

  console.log(
    `${APPLY ? "APPLYING" : "DRY-RUN"} — historical POS/PG/QR settlement GST backfill (gst = fee − ROUND(fee/1.18, 2)):\n`
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
      `  ${p.label.padEnd(16)} ${String(rows).padStart(7)} rows   margin ₹${fee.toLocaleString(
        "en-IN"
      )}   → gst ₹${gst.toLocaleString("en-IN")}`
    );
  }
  console.log(`\n  TOTAL ${String(totalRows).padStart(17)} rows   → gst ₹${totalGst.toLocaleString("en-IN")}\n`);

  if (!APPLY) {
    console.log("Dry-run only — nothing written. Re-run with --apply to persist.");
    console.log("NOTE: historical Revenue Wallet balances are NOT rewritten (report figures only).");
    return;
  }

  const affected = await prisma.$executeRawUnsafe(
    `UPDATE "Transaction" SET gst = ${GST_EXPR}, "updatedAt" = now() WHERE ${WHERE_SQL}`
  );
  console.log(`✔ Backfill complete — updated ${affected} settlement transaction(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
