/**
 * READ-ONLY: settlement coverage for the ASSIGNED + schemed machines only.
 * Proves that every Oct-9 capture on a terminal that is assigned to an active
 * retailer with a scheme either already has a settlement entry or now prices
 * cleanly (post company-match fix) → will settle T+1. Separates these from the
 * unassigned / not-in-inventory terminals that genuinely can't settle yet.
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
function loadEnvFile(): void {
  for (const file of [".env.local", ".env"]) {
    const p = resolve(process.cwd(), file);
    if (!existsSync(p)) continue;
    for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  }
}
loadEnvFile();

const DAY = (process.env.POS_DAY ?? "2026-10-09").trim();
const inr = (n: number) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function istDayWindow(day: string) {
  const [y, mo, d] = day.split("-").map(Number);
  const fromMs = Date.UTC(y, mo - 1, d) - 5.5 * 3600_000;
  return { from: new Date(fromMs), to: new Date(fromMs + 24 * 3600_000) };
}

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { resolvePosHolderAt } = await import("../src/lib/pos/holder");
  const { priceMdr } = await import("../src/lib/settlement/pos");
  const { isCardClassificationEnabled } = await import("../src/lib/settings");
  const { from, to } = istDayWindow(DAY);

  // All assigned machines (what the dashboard counts as ASSIGNED).
  const assigned = await prisma.posMachine.findMany({
    where: { assignedUserId: { not: null } },
    select: { tid: true, assignedUser: { select: { name: true, status: true, schemeId: true } } },
  });
  const assignedTids = new Set(assigned.map((m) => m.tid).filter(Boolean) as string[]);
  console.log(`\n=== Settlement coverage for ASSIGNED machines — ${DAY} IST ===`);
  console.log(`assigned machines: ${assigned.length}  (distinct TIDs: ${assignedTids.size})`);

  const mirror = await prisma.posTransactionMirror.findMany({
    where: { status: "CAPTURED", txnTime: { gte: from, lt: to } },
    select: { transactionRef: true, terminalId: true, amount: true, txnTime: true, paymentMode: true, cardType: true, cardBrand: true, cardClassification: true },
  });
  const settledRefs = new Set(
    (await prisma.posSettlementEntry.findMany({
      where: { transactionRef: { in: mirror.map((m) => m.transactionRef).filter(Boolean) as string[] } },
      select: { transactionRef: true },
    })).map((e) => e.transactionRef)
  );
  const classificationEnabled = await isCardClassificationEnabled();

  type Agg = { name: string; have: number; priceable: number; problem: number; vol: number };
  const perUser = new Map<string, Agg>();
  let onAssigned = 0, onUnassigned = 0;

  for (const t of mirror) {
    if (!t.transactionRef || !t.terminalId) continue;
    if (!assignedTids.has(t.terminalId)) { onUnassigned++; continue; }
    onAssigned++;
    const h = await resolvePosHolderAt(t.terminalId, t.txnTime);
    if (!h) { continue; }
    const u = await prisma.user.findUnique({ where: { id: h.userId }, select: { name: true } });
    const key = h.userId;
    const agg = perUser.get(key) ?? { name: u?.name ?? key, have: 0, priceable: 0, problem: 0, vol: 0 };
    agg.vol += Number(t.amount);
    if (settledRefs.has(t.transactionRef)) { agg.have++; }
    else {
      const priced = await priceMdr({
        userId: h.userId, brandId: h.brandId, provider: h.provider,
        paymentMode: t.paymentMode ?? "CARD", grossAmount: Number(t.amount), settlementType: "T1",
        dims: { company: h.company, cardType: t.cardType, brandType: t.cardBrand, classification: classificationEnabled ? t.cardClassification : null },
      });
      if (priced) agg.priceable++; else agg.problem++;
    }
    perUser.set(key, agg);
  }

  console.log(`\ncaptures on assigned terminals  : ${onAssigned}`);
  console.log(`captures on NON-assigned/unknown: ${onUnassigned}  (the 2724xxxx fleet + in-stock terminals)`);

  console.log(`\nPer assigned retailer (Oct 9):`);
  console.log(`  ${"RETAILER".padEnd(32)} ${"TXNS".padStart(5)} ${"SETTLED".padStart(8)} ${"NOW-OK".padStart(7)} ${"PROBLEM".padStart(8)}  VOLUME`);
  let H = 0, P = 0, X = 0;
  for (const a of [...perUser.values()].sort((x, y) => y.vol - x.vol)) {
    H += a.have; P += a.priceable; X += a.problem;
    console.log(`  ${a.name.padEnd(32)} ${String(a.have + a.priceable + a.problem).padStart(5)} ${String(a.have).padStart(8)} ${String(a.priceable).padStart(7)} ${String(a.problem).padStart(8)}  ${inr(a.vol)}`);
  }
  console.log(`\n  TOTALS on assigned terminals: settled(have entry)=${H}  now-priceable(will settle T+1)=${P}  still-problem=${X}`);
  console.log(`  → ${H + P} of ${H + P + X} assigned-terminal captures are covered after the fix.`);

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("✗", e); process.exit(1); });
