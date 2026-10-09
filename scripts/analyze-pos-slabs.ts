/**
 * READ-ONLY: why do the Oct-9 eligible captures resolve to NO_SCHEME?
 * Dumps, for each scheme involved, its active POS slabs (band + every pinned
 * dimension) and contrasts them with the dimensions the stuck transactions
 * actually carry (cardType / brandType / classification / company), so we can
 * see exactly which dimension is blocking the match.
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
const inr = (n: number) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 0 });
function istDayWindow(day: string) {
  const [y, mo, d] = day.split("-").map(Number);
  const fromMs = Date.UTC(y, mo - 1, d) - 5.5 * 3600_000;
  return { from: new Date(fromMs), to: new Date(fromMs + 24 * 3600_000) };
}
const show = (v: unknown) => (v == null || v === "" ? "*" : String(v));

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { resolvePosHolderAt } = await import("../src/lib/pos/holder");
  const { from, to } = istDayWindow(DAY);

  // All CAPTURED mirror rows for the day with their dimensions.
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

  // Resolve holder + scheme for every row; bucket into settled vs stuck.
  type Row = { ref: string; amount: number; cardType: string | null; cardBrand: string | null; classification: string | null; company: string | null; schemeId: string | null; userName: string; settled: boolean };
  const rows: Row[] = [];
  for (const t of mirror) {
    if (!t.transactionRef || !t.terminalId) continue;
    const h = await resolvePosHolderAt(t.terminalId, t.txnTime);
    if (!h) continue; // not an eligible/assigned terminal
    const u = await prisma.user.findUnique({ where: { id: h.userId }, select: { schemeId: true, name: true } });
    rows.push({
      ref: t.transactionRef, amount: Number(t.amount),
      cardType: t.cardType, cardBrand: t.cardBrand, classification: t.cardClassification,
      company: h.company, schemeId: u?.schemeId ?? null, userName: u?.name ?? h.userId,
      settled: settledRefs.has(t.transactionRef),
    });
  }

  const schemeIds = [...new Set(rows.map((r) => r.schemeId).filter(Boolean) as string[])];
  const schemes = await prisma.scheme.findMany({ where: { id: { in: schemeIds } }, select: { id: true, name: true, active: true } });
  const schemeById = new Map(schemes.map((s) => [s.id, s]));

  for (const sid of schemeIds) {
    const sc = schemeById.get(sid);
    const slabs = await prisma.mdrSlab.findMany({
      where: { schemeId: sid, serviceKind: "POS" as never, active: true },
      orderBy: { minAmount: "asc" },
    });
    const mine = rows.filter((r) => r.schemeId === sid);
    const stuck = mine.filter((r) => !r.settled);
    const ok = mine.filter((r) => r.settled);
    console.log(`\n══════════════════════════════════════════════════════════════`);
    console.log(`SCHEME ${sc?.name ?? "?"} (${sid})  active=${sc?.active}`);
    console.log(`  txns on this scheme: ${mine.length}  settled=${ok.length}  stuck(NO_SCHEME)=${stuck.length}`);
    console.log(`  active POS slabs: ${slabs.length}`);
    for (const s of slabs) {
      console.log(
        `    band ${inr(Number(s.minAmount)).padStart(9)}–${inr(Number(s.maxAmount)).padStart(11)}  ` +
        `mode=${show(s.paymentMode)} company=${show(s.company)} cardType=${show(s.cardType)} ` +
        `brand=${show(s.brandType)} class=${show(s.classification)}  ` +
        `mdr=${s.mdrType}:${String(s.mdrValue)} t0=${String(s.mdrValueT0)}`
      );
    }
    // Distinct dimension tuples the STUCK txns carry.
    const tuples = new Map<string, number>();
    for (const r of stuck) {
      const key = `company=${show(r.company)} cardType=${show(r.cardType)} brand=${show(r.cardBrand)} class=${show(r.classification)}`;
      tuples.set(key, (tuples.get(key) ?? 0) + 1);
    }
    console.log(`  STUCK txn dimension tuples:`);
    for (const [k, n] of [...tuples.entries()].sort((a, b) => b[1] - a[1])) console.log(`    [${n}x] ${k}`);
    // And the SETTLED txns' tuples for contrast.
    if (ok.length) {
      const okT = new Map<string, number>();
      for (const r of ok) {
        const key = `company=${show(r.company)} cardType=${show(r.cardType)} brand=${show(r.cardBrand)} class=${show(r.classification)}`;
        okT.set(key, (okT.get(key) ?? 0) + 1);
      }
      console.log(`  SETTLED txn dimension tuples (for contrast):`);
      for (const [k, n] of [...okT.entries()].sort((a, b) => b[1] - a[1])) console.log(`    [${n}x] ${k}`);
    }
    // Amount coverage check.
    const bands = slabs.map((s) => [Number(s.minAmount), Number(s.maxAmount)] as [number, number]);
    const uncovered = stuck.filter((r) => !bands.some(([lo, hi]) => r.amount >= lo && r.amount <= hi));
    console.log(`  stuck txns OUTSIDE every slab band: ${uncovered.length}` + (uncovered.length ? ` (amounts: ${uncovered.slice(0, 8).map((r) => inr(r.amount)).join(", ")}${uncovered.length > 8 ? ", …" : ""})` : ""));
  }

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("✗", e); process.exit(1); });
