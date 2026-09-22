/**
 * READ-ONLY diagnostic for POS transaction OWNERSHIP across (re)assignment.
 *
 * Verifies that a transaction stays attributed to whoever held the terminal
 * WHEN it was captured, even after the machine is unassigned / reassigned to a
 * different holder. For the given TID it prints:
 *   1. The machine's current assignment.
 *   2. Every PosAssignmentLog holding window ([assignedDate, returnedDate]).
 *   3. Every PosTransactionMirror row (amount / source / txnTime / createdAt).
 *   4. For each holder window, which transactions the NEW scope logic surfaces
 *      — i.e. exactly what each retailer will now see in their feed.
 *
 * Run (PowerShell, repo root):
 *   $env:POS_TID="43159311"; npx tsx scripts/diagnose-pos-ownership.ts
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

const TID = (process.env.POS_TID ?? "43159311").trim();
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "—");

async function main() {
  const { prisma } = await import("../src/lib/db");

  console.log(`\n=== POS ownership diagnostic for TID "${TID}" ===\n`);

  const machine = await prisma.posMachine.findFirst({
    where: { tid: TID },
    select: {
      id: true,
      tid: true,
      assignedUserId: true,
      assignedAt: true,
      assignedUser: { select: { name: true, role: true } },
    },
  });
  if (!machine) {
    console.log("No PosMachine row for that TID. Nothing to diagnose.");
    await prisma.$disconnect();
    return;
  }
  console.log("Machine:", JSON.stringify({
    id: machine.id,
    tid: machine.tid,
    currentHolderId: machine.assignedUserId,
    currentHolder: machine.assignedUser?.name ?? null,
    assignedAt: iso(machine.assignedAt),
  }, null, 2));

  // Holding windows from the ledger (assign rows only).
  const logs = await prisma.posAssignmentLog.findMany({
    where: { machineId: machine.id, action: "assign" },
    orderBy: { createdAt: "asc" },
    select: {
      toUserId: true,
      assignedDate: true,
      createdAt: true,
      returnedDate: true,
      status: true,
    },
  });
  const holderIds = [...new Set(logs.map((l) => l.toUserId).filter(Boolean) as string[])];
  const users = holderIds.length
    ? await prisma.user.findMany({ where: { id: { in: holderIds } }, select: { id: true, name: true, role: true } })
    : [];
  const nameOf = (id: string | null) => (id ? users.find((u) => u.id === id)?.name ?? id : "—");

  type Window = { holderId: string; holder: string; from: Date; to: Date | null };
  const windows: Window[] = [];
  console.log(`\nHolding windows (${logs.length} assign rows):`);
  for (const l of logs) {
    const from = l.assignedDate ?? l.createdAt;
    windows.push({ holderId: l.toUserId!, holder: nameOf(l.toUserId), from, to: l.returnedDate });
    console.log(
      `  ${nameOf(l.toUserId).padEnd(16)} [${l.status.padEnd(8)}] from ${iso(from)}  to ${iso(l.returnedDate)}`
    );
  }
  // The live column is an open window too (covers a fresh assign before its log
  // row, and mirrors what scopePosTerminals adds for the current holder).
  if (machine.assignedUserId) {
    const already = windows.some((w) => w.holderId === machine.assignedUserId && w.to === null);
    if (!already) {
      windows.push({ holderId: machine.assignedUserId, holder: machine.assignedUser?.name ?? machine.assignedUserId, from: machine.assignedAt ?? new Date(0), to: null });
    }
  }

  // Transactions on this terminal.
  const txns = await prisma.posTransactionMirror.findMany({
    where: { terminalId: TID },
    orderBy: { txnTime: "asc" },
    select: { amount: true, source: true, status: true, txnTime: true, createdAt: true },
  });
  console.log(`\nTransactions on terminal (${txns.length}):`);
  for (const t of txns)
    console.log(`  ₹${String(t.amount).padStart(10)}  ${t.source.padEnd(8)} ${t.status.padEnd(9)} swipe ${iso(t.txnTime)}  ingested ${iso(t.createdAt)}`);

  // Simulate the NEW scope/window filter (mirror.ts buildWhere semantics).
  const visible = (w: Window, t: (typeof txns)[number]) => {
    if (t.source === "MANUAL") {
      if (t.createdAt < w.from) return false;
      if (w.to && t.createdAt > w.to) return false;
      return true;
    }
    if (t.txnTime < w.from) return false;
    if (w.to && t.txnTime > w.to) return false;
    return true;
  };

  console.log(`\n=== What each holder will now see ===`);
  for (const w of windows) {
    const seen = txns.filter((t) => visible(w, t));
    const label = w.to === null ? "current" : "past";
    console.log(`\n${w.holder} (${label}, window ${iso(w.from)} → ${iso(w.to)}):`);
    if (seen.length === 0) console.log("   (nothing)");
    for (const t of seen) console.log(`   ✓ ₹${String(t.amount)}  ${t.source}  swipe ${iso(t.txnTime)}`);
  }

  // Simulate the NEW /api/pos/terminal-tree for each holder — this is the UI
  // gate that decides whether the dashboard even fires the transactions query.
  console.log(`\n=== /api/pos/terminal-tree (UI feed gate) per holder ===`);
  for (const holderId of holderIds) {
    const [cur, past] = await Promise.all([
      prisma.posMachine.findMany({
        where: { assignedUserId: holderId, tid: { not: null } },
        select: { tid: true },
      }),
      prisma.posAssignmentLog.findMany({
        where: { action: "assign", toUserId: holderId, returnedDate: { not: null }, machine: { tid: { not: null } } },
        select: { machine: { select: { tid: true } } },
      }),
    ]);
    const tids = new Set<string>();
    for (const c of cur) if (c.tid) tids.add(c.tid);
    for (const p of past) if (p.machine?.tid) tids.add(p.machine.tid);
    console.log(`  ${nameOf(holderId).padEnd(16)} → terminals: [${[...tids].join(", ") || "none"}]  → feed ${tids.size ? "FIRES ✓" : "GATED OFF ✗"}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n✗ Diagnostic failed:", e);
  process.exit(1);
});
