/**
 * READ-ONLY diagnostic for a "No POS machines found" search on the fleet page.
 *
 * Pins down why a terminal that appears in the POS *transactions* feed is not
 * found by the POS Fleet machine search. It:
 *   1. Reports local PosMachine mirror stats.
 *   2. Runs the exact + partial search the UI runs (tid/mid/serial/externalId).
 *   3. Prints the most recent pos.machines.sync audit-log results.
 *   4. Asks the partner directly whether the terminal is in the inventory feed
 *      (via the `search` param) AND whether it produced transactions.
 *
 * Run (PowerShell, repo root):
 *   $env:POS_TID="43133680"; npx tsx scripts/diagnose-pos-terminal.ts
 * Defaults to 43133680 if POS_TID is unset. Makes NO writes.
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

const TID = (process.env.POS_TID ?? "43133680").trim();
const PARTIAL = TID.slice(0, Math.max(4, TID.length - 1));

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { getPosMachines, getPosTransactions } = await import(
    "../src/lib/partners/sameday-pos"
  );

  console.log(`\n=== POS terminal diagnostic for TID "${TID}" ===\n`);

  // 1. Local mirror stats.
  const [total, bySource, byStatus] = await Promise.all([
    prisma.posMachine.count(),
    prisma.posMachine.groupBy({ by: ["source"], _count: { _all: true } }),
    prisma.posMachine.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  console.log(`Local PosMachine rows: ${total}`);
  console.log(
    "  by source:",
    bySource.map((s) => `${s.source}=${s._count._all}`).join("  ")
  );
  console.log(
    "  by status:",
    byStatus.map((s) => `${s.status}=${s._count._all}`).join("  ")
  );

  // 2. The exact search the UI runs, plus a looser partial to catch formatting.
  const uiMatch = await prisma.posMachine.findMany({
    where: {
      OR: [
        { tid: { contains: TID, mode: "insensitive" } },
        { mid: { contains: TID, mode: "insensitive" } },
        { serial: { contains: TID, mode: "insensitive" } },
        { externalId: { contains: TID, mode: "insensitive" } },
      ],
    },
    select: { id: true, tid: true, mid: true, serial: true, externalId: true, status: true, source: true },
  });
  console.log(`\nLocal exact search (UI logic) matches: ${uiMatch.length}`);
  for (const r of uiMatch) console.log("  ", JSON.stringify(r));

  const partial = await prisma.posMachine.findMany({
    where: {
      OR: [
        { tid: { contains: PARTIAL, mode: "insensitive" } },
        { mid: { contains: PARTIAL, mode: "insensitive" } },
        { serial: { contains: PARTIAL, mode: "insensitive" } },
      ],
    },
    select: { tid: true, mid: true, serial: true, status: true, source: true },
    take: 25,
  });
  console.log(`\nLocal partial search ("${PARTIAL}") matches: ${partial.length}`);
  for (const r of partial) console.log("  ", JSON.stringify(r));

  // 3. Recent sync audit logs (reconciliation removed/retired counts).
  const syncs = await prisma.auditLog.findMany({
    where: { action: "pos.machines.sync" },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { createdAt: true, meta: true },
  });
  console.log(`\nRecent pos.machines.sync audit entries: ${syncs.length}`);
  for (const s of syncs) console.log("  ", s.createdAt.toISOString(), JSON.stringify(s.meta));

  // 4. Ask the partner directly.
  console.log(`\n--- Partner inventory feed (pos-machines?search=${TID}) ---`);
  const inv = await getPosMachines({ search: TID, limit: 100 });
  if (!inv.ok) {
    console.log("  partner error:", JSON.stringify(inv.error));
  } else {
    const rows = inv.data.data ?? [];
    console.log(`  partner returned ${rows.length} machine(s); pagination:`, JSON.stringify(inv.data.pagination));
    for (const m of rows)
      console.log("   ", JSON.stringify({ id: m.id, tid: m.tid, mid: m.mid, serial: m.serial_number, status: m.status }));
  }

  console.log(`\n--- Partner transactions feed (terminal_id=${TID}, last 60d) ---`);
  const to = new Date();
  const from = new Date(to.getTime() - 60 * 24 * 3600 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const txns = await getPosTransactions({
    date_from: iso(from),
    date_to: iso(to),
    terminal_id: TID,
    page: 1,
    page_size: 5,
  });
  if (!txns.ok) {
    console.log("  partner error:", JSON.stringify(txns.error));
  } else {
    console.log(
      `  transactions total_records: ${txns.data.pagination?.total_records}; terminal_count: ${txns.data.summary?.terminal_count}`
    );
    for (const t of txns.data.data.slice(0, 3))
      console.log("   ", JSON.stringify({ terminal_id: t.terminal_id, mid: t.mid, serial: t.device_serial, amount: t.amount, at: t.txn_time }));
  }

  console.log("\n=== Verdict ===");
  if (uiMatch.length === 0 && inv.ok && (inv.data.data ?? []).length === 0) {
    console.log(
      "Terminal is ABSENT from the partner inventory feed → genuine partner-side gap.\n" +
        "The transactions feed and inventory feed disagree; nothing to fix locally except a MANUAL row."
    );
  } else if (uiMatch.length === 0 && inv.ok && (inv.data.data ?? []).length > 0) {
    console.log(
      "Partner HAS the terminal but the local mirror does NOT → sync/reconcile gap or field mismatch.\n" +
        "Re-run sync; if still missing, compare the partner tid vs stored tid formatting above."
    );
  } else if (uiMatch.length > 0) {
    console.log("Terminal IS in the local mirror — the UI should find it. Check search input/filters.");
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n✗ Diagnostic failed:", e);
  process.exit(1);
});
