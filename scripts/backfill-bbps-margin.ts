/**
 * One-off backfill: book the company SERVICE margin for BBPS bill payments that
 * settled via the OLD reconciliation sweep, which credited the retailer/marked
 * SUCCESS but never booked the platform margin ((fee − GST) − vendorCharge) to
 * the Revenue Wallet — a silent revenue under-booking now fixed going forward
 * (recon/bbps.ts uses the shared finalizer).
 *
 * How it stays safe + accurate:
 *   - Margin credits are idempotency-keyed `service-margin:{txnId}` (see
 *     creditServiceMargin). The pay path and the new finalizer both use that
    10| *     exact key, so any txn that ALREADY booked its margin is detected by the
 *     key and skipped. Only genuinely-missing rows are credited.
 *   - Re-runnable: running twice books nothing the second time.
 *
 * Usage:
 *   npm run backfill:bbps-margin -- --dry-run   # report only, write nothing
 *   npm run backfill:bbps-margin                # book missing margins
 */

export {};

    20|try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.();
} catch {
  /* env provided by the shell */
}

const BBPS_SERVICES = [
  "BILL_ELECTRICITY",
  "BILL_WATER",
  "BILL_GAS",
    30|  "BILL_CREDIT_CARD",
  "BILL_EDUCATION",
  "BILL_INSURANCE",
  "RECHARGE_BROADBAND",
] as const;

const PAGE = 500;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const { prisma } = await import("@/lib/db");
    40|  const { creditServiceMargin } = await import("@/lib/commission/revenue");
  const { dec, sub, round, toNumber, gt } = await import("@/lib/money");

  console.log(
    `[backfill:bbps-margin] ${dryRun ? "DRY RUN — no writes" : "LIVE — booking missing margins"}…`
  );

  let cursor: string | undefined;
  let scanned = 0;
  let booked = 0;
    50|  let skippedAlreadyBooked = 0;
  let skippedNonPositive = 0;
  let failed = 0;
  let totalBooked = 0;

  for (;;) {
    const batch = await prisma.transaction.findMany({
      where: { status: "SUCCESS", service: { in: BBPS_SERVICES as unknown as string[] } },
      orderBy: { id: "asc" },
      take: PAGE,
      60|      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, service: true, fee: true, gst: true, vendorCharge: true },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;
    scanned += batch.length;

    // One query per page: which of these already booked their margin?
    const keys = batch.map((t) => `service-margin:${t.id}`);
    const existing = new Set(
    70|      (
        await prisma.walletTxn.findMany({
          where: { idempotencyKey: { in: keys } },
          select: { idempotencyKey: true },
        })
      ).map((w) => w.idempotencyKey)
    );

    for (const t of batch) {
      const key = `service-margin:${t.id}`;
    80|      if (existing.has(key)) {
        skippedAlreadyBooked++;
        continue;
      }
      const margin = round(sub(sub(dec(t.fee), dec(t.gst)), dec(t.vendorCharge)));
      if (!gt(margin, 0)) {
        skippedNonPositive++;
        continue;
      }

    90|      if (dryRun) {
        booked++;
        totalBooked += toNumber(margin);
        continue;
      }

      await creditServiceMargin(t.id, t.service, margin);
      // Verify the credit actually landed (creditServiceMargin is best-effort
      // and swallows errors, so confirm the keyed ledger row now exists).
      const ok = await prisma.walletTxn.findUnique({
   100|        where: { idempotencyKey: key },
        select: { id: true },
      });
      if (ok) {
        booked++;
        totalBooked += toNumber(margin);
      } else {
        failed++;
        console.warn(`[backfill:bbps-margin] FAILED to book margin for txn ${t.id}`);
      }
    }
   110|
    console.log(
      `[backfill:bbps-margin] …scanned=${scanned} booked=${booked} ` +
        `alreadyBooked=${skippedAlreadyBooked} nonPositive=${skippedNonPositive} failed=${failed}`
    );
  }

  console.log(
    `\n[backfill:bbps-margin] DONE (${dryRun ? "dry run" : "live"}):\n` +
      `  scanned            = ${scanned}\n` +
   120|      `  ${dryRun ? "would book" : "booked"}          = ${booked}\n` +
      `  already booked     = ${skippedAlreadyBooked}\n` +
      `  non-positive margin= ${skippedNonPositive}\n` +
      `  failed             = ${failed}\n` +
      `  total margin ₹      = ${totalBooked.toFixed(2)}`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
   130|  console.error("[backfill:bbps-margin] failed:", e);
  process.exit(1);
});
