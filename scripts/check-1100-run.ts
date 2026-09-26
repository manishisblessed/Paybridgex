/**
 * READ-ONLY: reconcile today's wallet CREDITS per assigned retailer vs the POS
 * settlements, to explain the dashboard "Credits (today)" column.
 */
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

function startOfIstDay(now: Date): Date {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 5.5 * 60 * 60 * 1000);
}

(async () => {
  const { prisma } = await import("../src/lib/db");
  const dayStart = startOfIstDay(new Date());
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  console.log(`Today IST window: [${iso(dayStart)} , ${iso(dayEnd)})\n`);

  const NAMES = ["Govindbhai Kachrabhai Chauhan", "Shah Mitesh Jitendrakumar", "Jignesh Manubhai Patel", "Beriwala Mohsin Kutbuddinbhai"];
  for (const name of NAMES) {
    const u = await prisma.user.findFirst({ where: { name }, select: { id: true, name: true, walletBalance: true } });
    if (!u) { console.log(`no user ${name}`); continue; }
    const txns = await prisma.walletTxn.findMany({
      where: { userId: u.id, createdAt: { gte: dayStart, lt: dayEnd }, direction: "CREDIT" },
      select: { amount: true, reason: true, note: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const total = txns.reduce((a, t) => a + Number(t.amount), 0);
    const byReason: Record<string, number> = {};
    for (const t of txns) byReason[t.reason] = (byReason[t.reason] ?? 0) + Number(t.amount);
    console.log(`=== ${u.name}  balance=${inr(u.walletBalance)}  todayCredits=${inr(total)} (${txns.length} txns) ===`);
    for (const [r, amt] of Object.entries(byReason)) console.log(`   ${r.padEnd(18)} ${inr(amt)}`);
    // list non-POS credits explicitly
    for (const t of txns.filter((x) => x.reason !== "POS_SETTLEMENT")) {
      console.log(`     • ${t.reason} ${inr(t.amount)}  ${iso(t.createdAt)}  ${t.note ?? ""}`);
    }
    console.log("");
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
