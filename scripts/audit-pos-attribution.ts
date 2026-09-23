/**
 * READ-ONLY audit for POS settlement ATTRIBUTION correctness.
 *
 * Answers: "did any retailer receive (or is queued to receive) a POS settlement
 * for a swipe captured while they did NOT hold the terminal?" — i.e. the
 * pre-assignment / wrong-holder leak fixed by src/lib/pos/holder.ts.
 *
 * For every PosSettlementEntry it recomputes the RIGHTFUL holder at the entry's
 * capturedAt (from the assignment-history windows) and compares it to the user
 * the entry actually credits. It also previews how many CAPTURED mirror rows the
 * settlement sweep will now correctly SKIP as pre-assignment.
 *
 * Trusted manual-slip entries (transactionRef MPOS:*) are reported separately —
 * they are admin-authorised and intentionally exempt from the automatic gate.
 *
 * Makes NO writes.
 *
 * Run (PowerShell, repo root):
 *   npx tsx scripts/audit-pos-attribution.ts
 *   $env:AUDIT_LOOKBACK_DAYS="7"; $env:AUDIT_USER_ID="<userId>"; npx tsx scripts/audit-pos-attribution.ts
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
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  }
}
loadEnvFile();

const LOOKBACK_DAYS = Math.max(1, Number(process.env.AUDIT_LOOKBACK_DAYS ?? "30") || 30);
const USER_FILTER = (process.env.AUDIT_USER_ID ?? "").trim() || null;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "—");
const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { buildHoldingPeriods, resolveHolderFromPeriods } = await import("../src/lib/pos/holder");

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  console.log(`\n=== POS attribution audit — last ${LOOKBACK_DAYS} days${USER_FILTER ? ` (user ${USER_FILTER})` : ""} ===\n`);

  // 1) Every settlement entry in the window.
  const entries = await prisma.posSettlementEntry.findMany({
    where: {
      createdAt: { gte: since },
      ...(USER_FILTER ? { userId: USER_FILTER } : {}),
    },
    select: {
      id: true,
      transactionRef: true,
      userId: true,
      machineId: true,
      capturedAt: true,
      createdAt: true,
      status: true,
      netAmount: true,
      user: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // PosSettlementEntry.machineId has no Prisma relation — load the machines
  // (with their assignment history) separately and index by id.
  const entryMachineIds = [...new Set(entries.map((e) => e.machineId).filter(Boolean) as string[])];
  const entryMachines = entryMachineIds.length
    ? await prisma.posMachine.findMany({
        where: { id: { in: entryMachineIds } },
        select: {
          id: true,
          tid: true,
          assignedUserId: true,
          assignedAt: true,
          assignmentLogs: {
            where: { action: "assign", toUserId: { not: null } },
            select: { toUserId: true, assignedDate: true, createdAt: true, returnedDate: true },
            orderBy: { createdAt: "asc" },
          },
        },
      })
    : [];
  const machineById = new Map(entryMachines.map((m) => [m.id, m]));

  type Leak = {
    ref: string;
    status: string;
    creditedUser: string;
    creditedUserId: string;
    rightfulUserId: string | null;
    net: number;
    capturedAt: Date | null;
    tid: string | null;
  };
  const leaks: Leak[] = [];
  let checked = 0;

  for (const e of entries) {
    const anchor = e.capturedAt ?? e.createdAt;
    const machine = e.machineId ? machineById.get(e.machineId) : null;
    if (!machine) continue; // machine deleted / no machineId — cannot re-derive; skip
    checked++;
    const rightful = resolveHolderFromPeriods(buildHoldingPeriods(machine), anchor);
    if (rightful === e.userId) continue; // correctly attributed

    // Every source is gated uniformly now (webhook, sweep, AND manual slip), so
    // any credited≠capture-window mismatch is a real leak — MPOS included.
    leaks.push({
      ref: e.transactionRef,
      status: e.status,
      creditedUser: e.user?.name ?? e.userId,
      creditedUserId: e.userId,
      rightfulUserId: rightful,
      net: Number(e.netAmount),
      capturedAt: e.capturedAt,
      tid: machine.tid,
    });
  }

  console.log(`Settlement entries checked: ${checked} (of ${entries.length} fetched)\n`);

  // Report — automatic leaks (the real problem).
  const settledLeak = leaks.filter((l) => l.status === "SETTLED");
  const pendingLeak = leaks.filter((l) => l.status === "PENDING");
  const settledSum = settledLeak.reduce((s, l) => s + l.net, 0);
  const pendingSum = pendingLeak.reduce((s, l) => s + l.net, 0);

  console.log("── MIS-ATTRIBUTED (automatic) ──────────────────────────────");
  console.log(`  Already SETTLED to the wrong holder : ${settledLeak.length} entries, ${inr(settledSum)}  (direct exposure)`);
  console.log(`  PENDING to the wrong holder         : ${pendingLeak.length} entries, ${inr(pendingSum)}  (the fix now blocks these)`);
  if (leaks.length) {
    console.log("\n  Detail:");
    for (const l of leaks) {
      console.log(
        `   [${l.status.padEnd(8)}] ${l.ref.padEnd(28)} tid=${(l.tid ?? "—").padEnd(12)} ` +
          `credited=${l.creditedUser} rightful=${l.rightfulUserId ?? "NOBODY (pre-assignment/stock)"} ` +
          `net=${inr(l.net)} swipe=${iso(l.capturedAt)}`
      );
    }
  }

  // 2) Forward-looking preview: CAPTURED mirror rows on assigned terminals that
  //    the sweep will now SKIP because they predate the holder's window.
  console.log("\n── Sweep preview: pre-assignment CAPTURED mirror rows (will be SKIPPED) ──");
  const machines = await prisma.posMachine.findMany({
    where: {
      tid: { not: null },
      assignedUserId: { not: null },
      ...(USER_FILTER ? { assignedUserId: USER_FILTER } : {}),
    },
    select: {
      tid: true,
      assignedUserId: true,
      assignedAt: true,
      assignmentLogs: {
        where: { action: "assign", toUserId: { not: null } },
        select: { toUserId: true, assignedDate: true, createdAt: true, returnedDate: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  const periodsByTid = new Map<string, ReturnType<typeof buildHoldingPeriods>>();
  for (const m of machines) if (m.tid) periodsByTid.set(m.tid, buildHoldingPeriods(m));

  const tids = [...periodsByTid.keys()];
  let preCount = 0;
  let preSum = 0;
  if (tids.length) {
    const rows = await prisma.posTransactionMirror.findMany({
      where: { status: "CAPTURED", source: { not: "MANUAL" }, terminalId: { in: tids }, txnTime: { gte: since } },
      select: { terminalId: true, amount: true, txnTime: true },
    });
    for (const r of rows) {
      if (!r.terminalId) continue;
      const holder = resolveHolderFromPeriods(periodsByTid.get(r.terminalId) ?? [], r.txnTime);
      if (!holder) {
        preCount++;
        preSum += Number(r.amount);
      }
    }
  }
  console.log(`  ${preCount} captured rows across ${tids.length} assigned terminals are pre-assignment (gross ${inr(preSum)}).`);
  console.log("  These are NO LONGER auto-credited to the current holder — handle manually if genuinely owed.\n");

  console.log("=== Summary ===");
  console.log(`  Direct historical exposure (settled to wrong holder): ${inr(settledSum)} across ${settledLeak.length} entries.`);
  console.log(`  Blocked-going-forward pending mis-credits           : ${inr(pendingSum)} across ${pendingLeak.length} entries.`);
  console.log(leaks.length === 0 ? "  ✓ No automatic mis-attribution detected in the window." : "  ⚠ Review the entries above.");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n✗ Audit failed:", e);
  process.exit(1);
});
