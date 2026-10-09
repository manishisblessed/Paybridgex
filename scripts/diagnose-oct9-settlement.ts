/**
 * READ-ONLY: for a given IST day, reconcile the LIVE feed (PosTransactionMirror,
 * "107 captured") against the SETTLEMENT ledger (PosSettlementEntry, "9 settled")
 * and bucket EVERY captured swipe that has no settlement entry by its reason:
 *
 *   • notEligibleTerminal — TID unassigned / holder inactive / no scheme & no brand
 *   • preAssignment       — swiped before the holder's assignment window (manual only)
 *   • manualSource        — MANUAL slip row (settled only at admin approval)
 *   • eligibleNoEntry     — SHOULD have settled but didn't (sweep gap / NO_SCHEME / not run)
 *
 * This is exactly the set of gates runPosMirrorSettleSweep + handlePosCapture apply,
 * so the buckets tell you precisely which lever is dropping the 98 missing txns.
 *
 * Run (PowerShell, repo root):
 *   $env:POS_DAY="2026-10-09"; npx tsx scripts/diagnose-oct9-settlement.ts
 * Defaults to 2026-10-09. Makes NO writes.
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

/** [startOfDay, startOfNextDay) in UTC for the given IST calendar date (YYYY-MM-DD). */
function istDayWindow(day: string): { from: Date; to: Date } {
  const [y, mo, d] = day.split("-").map(Number);
  const fromMs = Date.UTC(y, mo - 1, d) - 5.5 * 3600_000;
  return { from: new Date(fromMs), to: new Date(fromMs + 24 * 3600_000) };
}

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { loadHoldingPeriodsByTid, resolveHolderFromPeriods } = await import("../src/lib/pos/holder");

  const { from, to } = istDayWindow(DAY);
  console.log(`\n=== POS capture → settlement reconciliation for ${DAY} IST ===`);
  console.log(`window: ${from.toISOString()} → ${to.toISOString()}\n`);

  // 1) The LIVE feed: every CAPTURED mirror row swiped on this IST day.
  const mirror = await prisma.posTransactionMirror.findMany({
    where: { status: "CAPTURED", txnTime: { gte: from, lt: to } },
    select: {
      transactionRef: true, terminalId: true, amount: true, source: true, txnTime: true, paymentMode: true,
    },
  });
  const capturedVol = mirror.reduce((s, r) => s + Number(r.amount), 0);
  console.log(`LIVE feed (PosTransactionMirror, CAPTURED): ${mirror.length} txns, vol ${inr(capturedVol)}`);

  // 2) The LEDGER: settlement entries whose capture lands on this IST day.
  const entries = await prisma.posSettlementEntry.findMany({
    where: {
      OR: [
        { capturedAt: { gte: from, lt: to } },
        { capturedAt: null, createdAt: { gte: from, lt: to } },
      ],
    },
    select: { transactionRef: true, status: true, netAmount: true },
  });
  const entryRefs = new Set(entries.map((e) => e.transactionRef));
  const byStatus: Record<string, { n: number; net: number }> = {};
  for (const e of entries) {
    byStatus[e.status] = byStatus[e.status] ?? { n: 0, net: 0 };
    byStatus[e.status].n++;
    byStatus[e.status].net += Number(e.netAmount);
  }
  console.log(`LEDGER (PosSettlementEntry, capturedAt in day): ${entries.length} entries`);
  for (const [st, a] of Object.entries(byStatus)) console.log(`   ${st.padEnd(9)} ${a.n}  net ${inr(a.net)}`);

  // 3) Eligibility set — exactly what runPosMirrorSettleSweep would scan:
  //    assigned to an ACTIVE user who has a scheme OR the machine has a brand.
  const machines = await prisma.posMachine.findMany({
    where: { tid: { not: null } },
    select: {
      tid: true, brandId: true, assignedUserId: true,
      assignedUser: { select: { status: true, schemeId: true } },
    },
  });
  const machineByTid = new Map(machines.map((m) => [m.tid as string, m]));
  const eligibleTids = new Set<string>();
  for (const m of machines) {
    if (!m.tid || !m.assignedUserId) continue;
    if (m.assignedUser?.status !== "ACTIVE") continue;
    if (m.assignedUser?.schemeId || m.brandId) eligibleTids.add(m.tid);
  }

  // Holding windows for attribution (pre-assignment detection).
  const periods = await loadHoldingPeriodsByTid([...eligibleTids]);

  // 4) Bucket every captured swipe WITHOUT a settlement entry.
  const buckets = {
    notEligibleTerminal: [] as typeof mirror,
    preAssignment: [] as typeof mirror,
    manualSource: [] as typeof mirror,
    eligibleNoEntry: [] as typeof mirror,
  };
  let haveEntry = 0;
  for (const r of mirror) {
    if (r.transactionRef && entryRefs.has(r.transactionRef)) { haveEntry++; continue; }
    const tid = r.terminalId ?? "";
    if (!eligibleTids.has(tid)) { buckets.notEligibleTerminal.push(r); continue; }
    if (r.source === "MANUAL") { buckets.manualSource.push(r); continue; }
    const holder = resolveHolderFromPeriods(periods.get(tid) ?? [], r.txnTime);
    if (!holder) { buckets.preAssignment.push(r); continue; }
    buckets.eligibleNoEntry.push(r);
  }

  const vol = (rows: typeof mirror) => rows.reduce((s, r) => s + Number(r.amount), 0);
  console.log(`\n── Reconciliation of ${mirror.length} captured swipes ──`);
  console.log(`  have settlement entry : ${haveEntry}`);
  console.log(`  MISSING entry         : ${mirror.length - haveEntry}  (vol ${inr(capturedVol - vol(buckets.notEligibleTerminal) - 0)})`);
  console.log(`\n  Missing, bucketed by reason:`);
  console.log(`   notEligibleTerminal : ${buckets.notEligibleTerminal.length.toString().padStart(3)}  vol ${inr(vol(buckets.notEligibleTerminal))}  (TID unassigned / holder inactive / no scheme & no brand)`);
  console.log(`   preAssignment       : ${buckets.preAssignment.length.toString().padStart(3)}  vol ${inr(vol(buckets.preAssignment))}  (swiped before assignment — manual only)`);
  console.log(`   manualSource        : ${buckets.manualSource.length.toString().padStart(3)}  vol ${inr(vol(buckets.manualSource))}  (MANUAL slip — settles at approval)`);
  console.log(`   eligibleNoEntry     : ${buckets.eligibleNoEntry.length.toString().padStart(3)}  vol ${inr(vol(buckets.eligibleNoEntry))}  (SHOULD have settled — sweep gap / NO_SCHEME)`);

  // 5) Break notEligibleTerminal down further so the admin knows the fix.
  const sub = { unassigned: 0, inactive: 0, noSchemeNoBrand: 0, unknownTid: 0 };
  const perTidNotEligible = new Map<string, number>();
  for (const r of buckets.notEligibleTerminal) {
    const m = machineByTid.get(r.terminalId ?? "");
    if (!m) { sub.unknownTid++; }
    else if (!m.assignedUserId) sub.unassigned++;
    else if (m.assignedUser?.status !== "ACTIVE") sub.inactive++;
    else sub.noSchemeNoBrand++;
    perTidNotEligible.set(r.terminalId ?? "—", (perTidNotEligible.get(r.terminalId ?? "—") ?? 0) + 1);
  }
  if (buckets.notEligibleTerminal.length) {
    console.log(`\n   notEligibleTerminal breakdown:`);
    console.log(`      unassigned TID      : ${sub.unassigned}`);
    console.log(`      holder inactive     : ${sub.inactive}`);
    console.log(`      no scheme & no brand: ${sub.noSchemeNoBrand}`);
    console.log(`      TID not in machines : ${sub.unknownTid}`);
    console.log(`      by TID:`);
    for (const [tid, n] of [...perTidNotEligible.entries()].sort((a, b) => b[1] - a[1])) {
      const m = machineByTid.get(tid);
      const why = !m ? "no machine row" : !m.assignedUserId ? "unassigned" : m.assignedUser?.status !== "ACTIVE" ? `holder ${m.assignedUser?.status}` : "no scheme & no brand";
      console.log(`         ${tid.padEnd(16)} ${String(n).padStart(3)} txns  (${why})`);
    }
  }

  if (buckets.eligibleNoEntry.length) {
    console.log(`\n   eligibleNoEntry (the real settlement gap) — first 20 refs:`);
    for (const r of buckets.eligibleNoEntry.slice(0, 20)) {
      console.log(`      ${(r.transactionRef ?? "—").padEnd(30)} ${inr(Number(r.amount)).padStart(13)} TID ${r.terminalId} swipe ${r.txnTime.toISOString()}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n✗ Failed:", e);
  process.exit(1);
});
