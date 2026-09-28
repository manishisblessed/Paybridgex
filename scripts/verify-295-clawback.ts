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
const REF = "SDPOS:43136393:000000000295";

(async () => {
  const { prisma } = await import("../src/lib/db");

  const entry = await prisma.posSettlementEntry.findUnique({ where: { transactionRef: REF } });
  console.log("=== Settlement entry 295 ===");
  console.log(`  status=${entry?.status}  settledVia=${entry?.settledVia}  walletTxnId=${entry?.walletTxnId}  reversedAt=${iso(entry?.reversedAt as any)}  reason=${(entry as any)?.reversalReason ?? "—"}`);
  console.log(`  gross=${inr(entry?.grossAmount)} mdr=${inr(entry?.mdrAmount)} net=${inr(Number(entry?.grossAmount) - Number(entry?.mdrAmount))} userId=${entry?.userId}`);

  const userId = entry?.userId;
  if (userId) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, walletBalance: true } });
    console.log(`\n=== Retailer ${u?.name}  balance=${inr(u?.walletBalance)} ===`);
    const since = new Date("2026-09-28T00:00:00Z");
    const txns = await prisma.walletTxn.findMany({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: { amount: true, direction: true, reason: true, note: true, createdAt: true, idempotencyKey: true },
    });
    console.log(`Wallet txns since 28 Sep 00:00 UTC: ${txns.length}`);
    for (const t of txns) {
      console.log(`  ${iso(t.createdAt)}  ${t.direction.padEnd(6)} ${inr(t.amount).padStart(14)}  ${String(t.reason).padEnd(16)} key=${t.idempotencyKey ?? "—"}  ${t.note ?? ""}`);
    }
  }

  const audits = await prisma.auditLog.findMany({
    where: { entityId: REF },
    orderBy: { createdAt: "asc" },
    select: { action: true, createdAt: true, meta: true },
  });
  console.log(`\n=== Audit logs for 295: ${audits.length} ===`);
  for (const a of audits) console.log(`  ${iso(a.createdAt)}  ${a.action}  ${JSON.stringify(a.meta)}`);

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
