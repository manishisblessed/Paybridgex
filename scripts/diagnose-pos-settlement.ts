/**
 * READ-ONLY diagnostic: why did (or didn't) a terminal's captures settle?
 *
 * For a given TID it prints the assignment windows, every CAPTURED mirror row,
 * and the matching PosSettlementEntry (status / mode / capturedAt / settledAt /
 * settledVia / reversedAt / walletTxnId), plus the settlement pipeline config.
 * This shows exactly which captures have a settlement entry, in what state, and
 * whether the T+1 cron would pick them up (only PENDING + capturedAt < today IST).
 *
 * Run (PowerShell, repo root):
 *   $env:POS_TID="43136393"; npx tsx scripts/diagnose-pos-settlement.ts
 * Makes NO writes.
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
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  }
}
loadEnvFile();

const TID = (process.env.POS_TID ?? "43136393").trim();
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "—");
const inr = (n: number | string) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Start of the current IST calendar day, as a UTC Date (matches the T+1 cron). */
function startOfTodayIst(now = new Date()): Date {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const startIstMs = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return new Date(startIstMs - 5.5 * 60 * 60 * 1000);
}

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { getSetting } = await import("../src/lib/settings");

  console.log(`\n=== POS settlement diagnostic — TID ${TID} ===\n`);

  const machines = await prisma.posMachine.findMany({
    where: { tid: TID },
    select: {
      id: true, tid: true, brandId: true, company: true, assignedUserId: true, assignedAt: true,
      assignedUser: { select: { name: true, userCode: true, status: true, schemeId: true } },
      assignmentLogs: {
        where: { action: "assign" },
        orderBy: { createdAt: "asc" },
        select: { toUserId: true, assignedDate: true, createdAt: true, returnedDate: true, status: true },
      },
    },
  });
  if (machines.length === 0) {
    console.log("No PosMachine for that TID.");
    await prisma.$disconnect();
    return;
  }

  for (const m of machines) {
    console.log(`Machine ${m.id}  brand=${m.brandId ?? "—"}  company=${m.company ?? "—"}`);
    console.log(`  current holder: ${m.assignedUser?.name ?? "STOCK"} (${m.assignedUser?.userCode ?? "—"}) status=${m.assignedUser?.status ?? "—"} scheme=${m.assignedUser?.schemeId ?? "NONE"} assignedAt=${iso(m.assignedAt)}`);
    console.log(`  holding windows:`);
    for (const l of m.assignmentLogs) {
      console.log(`    holder=${l.toUserId ?? "—"} [${l.status}] ${iso(l.assignedDate ?? l.createdAt)} → ${iso(l.returnedDate)}`);
    }
  }

  const todayIst = startOfTodayIst();
  console.log(`\nT+1 due boundary (start of today IST): ${iso(todayIst)}`);

  // Config
  const [ingest, t1, instant] = await Promise.all([
    getSetting("settlement.pos_ingest"),
    getSetting("settlement.pos_t1"),
    getSetting("settlement.pos_instant"),
  ]);
  console.log("\nPipeline config:");
  console.log(`  pos_ingest: enabled=${ingest.enabled} paused=${ingest.paused} lookbackDays=${ingest.lookbackDays}`);
  console.log(`  pos_t1    : enabled=${t1.enabled} hour=${t1.hour} minAmount=${(t1 as { minAmount?: number }).minAmount ?? "—"}`);
  console.log(`  pos_instant: defaultEnabled=${instant.defaultEnabled} paused=${instant.paused}`);

  // Captured mirror rows for this TID.
  const mirror = await prisma.posTransactionMirror.findMany({
    where: { terminalId: TID },
    orderBy: { txnTime: "asc" },
    select: { transactionRef: true, amount: true, status: true, source: true, txnTime: true, createdAt: true },
  });
  console.log(`\nMirror rows (${mirror.length}):`);
  for (const t of mirror) {
    console.log(`  ${(t.transactionRef ?? "—").padEnd(30)} ${inr(t.amount).padStart(14)} ${t.status.padEnd(9)} ${t.source.padEnd(7)} swipe ${iso(t.txnTime)}`);
  }

  // Settlement entries for this TID's captures (match by transactionRef).
  const refs = mirror.map((t) => t.transactionRef).filter(Boolean) as string[];
  const entries = refs.length
    ? await prisma.posSettlementEntry.findMany({
        where: { transactionRef: { in: refs } },
        orderBy: { capturedAt: "asc" },
        select: {
          transactionRef: true, userId: true, status: true, mode: true, netAmount: true, mdrAmount: true,
          capturedAt: true, settledAt: true, settledVia: true, reversedAt: true, walletTxnId: true, createdAt: true,
          user: { select: { name: true, userCode: true } },
        },
      })
    : [];

  console.log(`\nSettlement entries (${entries.length} of ${mirror.length} captures have one):`);
  const byStatus: Record<string, { n: number; net: number }> = {};
  for (const e of entries) {
    const due = e.status === "PENDING" && (e.capturedAt ?? e.createdAt) < todayIst;
    byStatus[e.status] = byStatus[e.status] ?? { n: 0, net: 0 };
    byStatus[e.status].n++;
    byStatus[e.status].net += Number(e.netAmount);
    console.log(
      `  ${e.transactionRef.padEnd(30)} ${e.status.padEnd(8)} ${String(e.mode).padEnd(7)} ` +
        `net=${inr(e.netAmount).padStart(13)} → ${e.user?.name ?? e.userId} ` +
        `swipe=${iso(e.capturedAt)} settledAt=${iso(e.settledAt)} via=${e.settledVia ?? "—"} ` +
        `reversedAt=${iso(e.reversedAt)} wtxn=${e.walletTxnId ?? "—"}${due ? "  [T+1 DUE NOW]" : ""}`
    );
  }

  const capturedRefsWithNoEntry = refs.filter((r) => !entries.some((e) => e.transactionRef === r));
  console.log(`\nCaptures with NO settlement entry (never queued): ${capturedRefsWithNoEntry.length}`);
  for (const r of capturedRefsWithNoEntry) console.log(`  ${r}`);

  console.log(`\nSummary by settlement-entry status:`);
  for (const [st, agg] of Object.entries(byStatus)) console.log(`  ${st.padEnd(8)} count=${agg.n} net=${inr(agg.net)}`);
  const dueNow = entries.filter((e) => e.status === "PENDING" && (e.capturedAt ?? e.createdAt) < todayIst);
  console.log(`\nT+1 cron would settle now: ${dueNow.length} entries, net ${inr(dueNow.reduce((s, e) => s + Number(e.netAmount), 0))}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n✗ Diagnostic failed:", e);
  process.exit(1);
});
