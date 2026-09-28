import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
for (const file of [".env.local", ".env"]) {
  const p = resolve(process.cwd(), file);
  if (!existsSync(p)) continue;
  for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
const inr = (n: any) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "—");
const REFID = "POS:SDPOS:43136393:000000000295";

(async () => {
  const { prisma } = await import("../src/lib/db");

  const txn = await prisma.transaction.findUnique({ where: { refId: REFID } });
  console.log(`=== Synthetic settlement txn ${REFID} ===`);
  if (!txn) { console.log("  NOT FOUND — no commission distributed."); await prisma.$disconnect(); return; }
  console.log(`  id=${txn.id}  status=${txn.status}  commission=${inr((txn as any).commission ?? 0)}  createdAt=${iso(txn.createdAt)}`);

  const credits = await prisma.commissionCredit.findMany({
    where: { transactionId: txn.id },
    select: { userId: true, tier: true, amount: true, grossAmount: true, tdsAmount: true, walletTxnId: true, service: true, createdAt: true },
  });
  console.log(`\n=== CommissionCredit rows: ${credits.length} ===`);
  let totalNet = 0, totalGross = 0;
  for (const c of credits) {
    const u = await prisma.user.findUnique({ where: { id: c.userId }, select: { name: true, role: true, walletBalance: true } });
    totalNet += Number(c.amount); totalGross += Number(c.grossAmount);
    console.log(`  ${c.tier.padEnd(12)} ${(u?.name ?? c.userId).padEnd(24)} role=${u?.role}  net=${inr(c.amount)} gross=${inr(c.grossAmount)} tds=${inr(c.tdsAmount)}  wtx=${c.walletTxnId ? "yes" : "NO"}  bal=${inr(u?.walletBalance)}`);
  }
  console.log(`\n  TOTAL upline commission on failed txn: gross=${inr(totalGross)}  net-credited=${inr(totalNet)}`);

  // Any reversing debit for these commission wallet txns?
  const commWtxIds = credits.map((c) => c.walletTxnId).filter(Boolean) as string[];
  const reversals = await prisma.walletTxn.findMany({
    where: { direction: "DEBIT", refId: txn.id },
    select: { userId: true, amount: true, reason: true, note: true, createdAt: true },
  });
  console.log(`\n=== Debits referencing this txn (potential reversals): ${reversals.length} ===`);
  for (const r of reversals) console.log(`  ${iso(r.createdAt)} ${r.reason} ${inr(r.amount)} ${r.note ?? ""}`);

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
