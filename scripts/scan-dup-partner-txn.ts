/**
 * READ-ONLY: find every provider order (partnerTxnId) that is attached to MORE
 * THAN ONE terminal/live Transaction row — i.e. the "one provider order charged
 * the retailer twice" defect. Mutates NOTHING.
 *
 * This also tells us what MUST be cleaned up before the partial unique index on
 * partnerTxnId (WHERE status='SUCCESS') can be created, since Postgres will
 * refuse to build a unique index over existing duplicates.
 *
 *   ./node_modules/.bin/tsx scripts/scan-dup-partner-txn.ts
 */
import "./_load-env";
import { prisma } from "../src/lib/db";

const inr = (n: unknown) =>
  "₹" + Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "—");

async function main() {
  // All non-null partnerTxnIds that appear on >1 row.
  const groups = await prisma.transaction.groupBy({
    by: ["partnerTxnId"],
    where: { partnerTxnId: { not: null } },
    _count: { _all: true },
    having: { partnerTxnId: { _count: { gt: 1 } } },
  });

  console.log(`\n=== partnerTxnId values shared by >1 Transaction row: ${groups.length} ===\n`);

  let dupSuccessGroups = 0;
  for (const g of groups) {
    const rows = await prisma.transaction.findMany({
      where: { partnerTxnId: g.partnerTxnId },
      orderBy: { createdAt: "asc" },
      select: {
        refId: true, userId: true, service: true, status: true, amount: true, fee: true,
        customer: true, createdAt: true, refundedAt: true,
        user: { select: { name: true, userCode: true } },
      },
    });
    const successCount = rows.filter((r) => r.status === "SUCCESS").length;
    // Reversal check per row (durable ledger link).
    const flag = successCount > 1 ? "  <-- DUPLICATE SUCCESS (double charge)" : "";
    if (successCount > 1) dupSuccessGroups++;
    console.log(`• partnerTxnId=${g.partnerTxnId}  rows=${g._count._all}  successRows=${successCount}${flag}`);
    for (const r of rows) {
      const rev = await prisma.walletTxn.aggregate({
        where: { userId: r.userId, direction: "CREDIT", reason: "REVERSAL", refType: "Transaction",
                 refId: undefined },
        _sum: { amount: true }, _count: true,
      });
      void rev; // (reversal is keyed by internal txn id; shown per-row below instead)
      console.log(
        `    - ${iso(r.createdAt)} ${r.refId} ${r.status} amt=${inr(r.amount)} fee=${inr(r.fee)} ` +
          `cust=${r.customer ?? "—"} owner=${r.user?.name ?? "?"} (${r.user?.userCode ?? "?"}) refundedAt=${iso(r.refundedAt)}`
      );
    }
    console.log("");
  }

  console.log(`=== SUMMARY ===`);
  console.log(`shared-partnerTxnId groups : ${groups.length}`);
  console.log(`groups with >1 SUCCESS     : ${dupSuccessGroups}  (these BLOCK the unique index & are real double-charges)`);
  console.log("");

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
