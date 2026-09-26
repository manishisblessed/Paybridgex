/**
 * READ-ONLY: For the Sep-24 IST day, group every CAPTURED POS mirror txn by TID
 * and report captures vs. settlement-entries created. Flags any capture on an
 * ASSIGNED machine that produced NO entry (i.e. would NOT settle) so we can be
 * certain all assigned retailers' Sep-24 txns are covered.
 *
 * Run on the server: ./node_modules/.bin/tsx scripts/audit-sep24-coverage.ts
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
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  }
}
loadEnvFile();

const inr = (n: number) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = (d: Date) => d.toISOString();

function startOfIstDay(now: Date): Date {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 5.5 * 60 * 60 * 1000);
}

async function main() {
  const { prisma } = await import("../src/lib/db");

  // Sep 24 IST window.
  const dayStart = startOfIstDay(new Date("2026-09-24T12:00:00.000Z"));
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  console.log(`\n=== Sep-24 IST coverage audit  [${iso(dayStart)} , ${iso(dayEnd)}) ===`);

  const rows = await prisma.posTransactionMirror.findMany({
    where: { txnTime: { gte: dayStart, lt: dayEnd }, source: { not: "MANUAL" } },
    select: { transactionRef: true, terminalId: true, amount: true, status: true },
  });
  console.log(`Total mirror txns on Sep 24: ${rows.length}`);

  const refs = rows.map((r) => r.transactionRef).filter(Boolean) as string[];
  const withEntry = new Set(
    (await prisma.posSettlementEntry.findMany({ where: { transactionRef: { in: refs } }, select: { transactionRef: true } })).map((e) => e.transactionRef),
  );

  // Which TIDs are currently assigned (have a holder)?
  const machines = await prisma.posMachine.findMany({
    where: { tid: { in: [...new Set(rows.map((r) => r.terminalId))] } },
    select: { tid: true, assignedUserId: true, assignedUser: { select: { name: true, schemeId: true } } },
  });
  const mByTid = new Map(machines.map((m) => [m.tid, m]));

  // Group by TID.
  const byTid = new Map<string, { total: number; captured: number; withEntry: number; noEntry: number; noEntryAmt: number }>();
  for (const r of rows) {
    const g = byTid.get(r.terminalId) ?? { total: 0, captured: 0, withEntry: 0, noEntry: 0, noEntryAmt: 0 };
    g.total++;
    if (r.status === "CAPTURED") {
      g.captured++;
      if (r.transactionRef && withEntry.has(r.transactionRef)) g.withEntry++;
      else { g.noEntry++; g.noEntryAmt += Number(r.amount); }
    }
    byTid.set(r.terminalId, g);
  }

  console.log(`\nTID            assigned  holder                scheme   total  captured  entry  NO-ENTRY  (amt)`);
  const tids = [...byTid.keys()].sort();
  for (const tid of tids) {
    const g = byTid.get(tid)!;
    const m = mByTid.get(tid);
    const assigned = m?.assignedUserId ? "YES" : "no ";
    const holder = (m?.assignedUser?.name ?? "—").padEnd(20);
    const scheme = m?.assignedUser?.schemeId ? "yes" : "NONE";
    const flag = m?.assignedUserId && g.noEntry > 0 ? "  ⚠ STRANDED" : "";
    console.log(
      `${tid.padEnd(14)} ${assigned}      ${holder}  ${scheme.padEnd(6)}  ${String(g.total).padStart(4)}   ${String(g.captured).padStart(6)}   ${String(g.withEntry).padStart(4)}   ${String(g.noEntry).padStart(6)}  ${inr(g.noEntryAmt).padStart(12)}${flag}`,
    );
  }

  // Summary for assigned machines only.
  const assignedTids = tids.filter((t) => mByTid.get(t)?.assignedUserId);
  const strandedAssigned = assignedTids.filter((t) => byTid.get(t)!.noEntry > 0);
  console.log(`\nAssigned machines with Sep-24 txns: ${assignedTids.length}`);
  console.log(`  → fully covered (all captures have entries): ${assignedTids.length - strandedAssigned.length}`);
  console.log(`  → with stranded captures (won't settle): ${strandedAssigned.length}${strandedAssigned.length ? " → " + strandedAssigned.join(", ") : ""}`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
