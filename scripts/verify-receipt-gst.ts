/**
 * Receipt / GST consistency audit (READ-ONLY).
 *
 * Transaction receipts are generated on-demand from `Transaction.fee` and
 * `Transaction.gst` — nothing is persisted, so there is no receipt data to
 * "backfill". This script instead PROVES the stored inputs are internally
 * consistent, i.e. that every fee-bearing row can render a correct receipt:
 *
 *   fee            = GST-inclusive service charge  (taxable + gst)
 *   taxable value  = fee − gst
 *   effective rate = gst / taxable × 100           (expected: 18%)
 *   wallet debit   = amount + fee                  (GST is NOT added on top)
 *
 * It NEVER writes to the database. Mutating `Transaction.gst` retroactively
 * would corrupt already-filed GST reports (GSTR), so any anomaly this surfaces
 * should be reviewed manually before any correction — not blind-backfilled.
 *
 * Usage:
 *   npm run verify:receipt-gst              # audit all fee-bearing transactions
 *   npm run verify:receipt-gst -- --all     # also list clean rows (verbose)
 */

export {};

try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.();
} catch {
  /* env provided by the shell */
}

const EXPECTED_RATE = 18; // standard GST slab for these financial services
const BATCH = 1000;

type Flag =
  | "GST_NOT_BROKEN_OUT" // fee > 0 but gst = 0 (whole fee treated as taxable)
  | "GST_EXCEEDS_FEE" // gst >= fee → taxable <= 0 (impossible / corrupt)
  | "NEGATIVE" // fee or gst < 0
  | "RATE_OFF"; // gst > 0 but effective rate != 18%

async function main() {
  const verbose = process.argv.includes("--all");
  const { prisma } = await import("@/lib/db");
  const { dec, sub, toNumber } = await import("@/lib/money");

  let cursor: string | undefined;
  let scanned = 0;
  let feeBearing = 0;
  const anomalies: Array<{
    refId: string;
    service: string;
    status: string;
    amount: number;
    fee: number;
    gst: number;
    taxable: number;
    rate: number;
    flags: Flag[];
    createdAt: Date;
  }> = [];

  // Round-trip the whole ledger in id-cursor batches (stable, memory-bounded).
  // Only rows with a service charge can have GST implications, so we filter to
  // fee > 0 at the DB and count the rest as trivially-consistent.
  for (;;) {
    const rows = await prisma.transaction.findMany({
      where: { fee: { gt: 0 } },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true,
        refId: true,
        service: true,
        status: true,
        amount: true,
        fee: true,
        gst: true,
        createdAt: true,
      },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    scanned += rows.length;
    feeBearing += rows.length;

    for (const r of rows) {
      const fee = dec(r.fee);
      const gst = dec(r.gst);
      const taxable = sub(fee, gst);
      const flags: Flag[] = [];

      if (fee.lt(0) || gst.lt(0)) flags.push("NEGATIVE");
      if (gst.gt(0) && !taxable.gt(0)) flags.push("GST_EXCEEDS_FEE");
      if (fee.gt(0) && gst.eq(0)) flags.push("GST_NOT_BROKEN_OUT");

      let rate = 0;
      if (gst.gt(0) && taxable.gt(0)) {
        rate = Math.round(gst.div(taxable).mul(100).toNumber());
        if (rate !== EXPECTED_RATE) flags.push("RATE_OFF");
      }

      if (flags.length > 0 || verbose) {
        anomalies.push({
          refId: r.refId,
          service: r.service,
          status: r.status,
          amount: toNumber(r.amount),
          fee: toNumber(fee),
          gst: toNumber(gst),
          taxable: toNumber(taxable),
          rate,
          flags,
          createdAt: r.createdAt,
        });
      }
    }
  }

  const real = anomalies.filter((a) => a.flags.length > 0);

  console.log(`[verify:receipt-gst] Scanned ${feeBearing} fee-bearing transaction(s).`);
  console.log(
    `[verify:receipt-gst] Convention: fee is GST-inclusive; taxable = fee − gst; expected rate ${EXPECTED_RATE}% (9% CGST + 9% SGST).\n`
  );

  const toShow = verbose ? anomalies : real;
  if (toShow.length === 0) {
    console.log("✅ All fee-bearing transactions are GST-consistent. No backfill needed.");
    console.log("   (Receipts are derived on-demand, so the fix already applies to every past row.)");
    process.exit(0);
  }

  console.log(
    ["REF_ID".padEnd(16), "SERVICE".padEnd(18), "AMOUNT".padStart(12), "FEE".padStart(9), "GST".padStart(8), "TAXABLE".padStart(9), "RATE".padStart(5), "FLAGS"].join(
      "  "
    )
  );
  for (const a of toShow) {
    console.log(
      [
        a.refId.padEnd(16),
        a.service.padEnd(18),
        `₹${a.amount.toFixed(2)}`.padStart(12),
        a.fee.toFixed(2).padStart(9),
        a.gst.toFixed(2).padStart(8),
        a.taxable.toFixed(2).padStart(9),
        `${a.rate}%`.padStart(5),
        a.flags.join(",") || "ok",
      ].join("  ")
    );
  }

  if (real.length > 0) {
    console.log(
      `\n⚠️  ${real.length} row(s) look inconsistent. Do NOT blind-backfill — review manually:\n` +
        `   • GST_NOT_BROKEN_OUT: legacy row where the fee has no GST split (receipt shows the full fee as taxable, 0% GST).\n` +
        `   • RATE_OFF: gst/taxable ≠ 18% — verify the original pricing before any correction.\n` +
        `   • GST_EXCEEDS_FEE / NEGATIVE: data corruption — escalate.\n` +
        `   Correcting Transaction.gst changes filed GST reports (GSTR), so it must be a deliberate, audited action.`
    );
    process.exit(3);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("[verify:receipt-gst] failed:", e);
  process.exit(1);
});
