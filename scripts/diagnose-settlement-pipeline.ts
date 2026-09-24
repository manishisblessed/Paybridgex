/**
 * READ-ONLY: is the POS settlement PIPELINE actually running / when did it last?
 *
 * The 11:00 T+1 cron only SETTLES pre-existing PENDING entries; it never CREATES
 * them. Entries are created by the ingest/mirror-settle sweep. This script shows:
 *   • current settlement config + when it was last changed (pause/enable),
 *   • the most recent PosSettlementEntry created (was the sweep running?),
 *   • the most recent entry settled (was the T+1/instant cron running?),
 *   • recent settlement-related AuditLog actions (manual sweeps, config changes).
 *
 * Run: npx tsx scripts/diagnose-settlement-pipeline.ts   (makes NO writes)
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

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "—");
const ago = (d: Date | null | undefined) => (d ? `${Math.round((Date.now() - d.getTime()) / 60000)} min ago` : "—");

async function main() {
  const { prisma } = await import("../src/lib/db");

  console.log(`\n=== POS settlement pipeline health — now ${new Date().toISOString()} ===\n`);

  // 1) Settings + last change time.
  const keys = ["settlement.pos_ingest", "settlement.pos_t1", "settlement.pos_instant"];
  const settings = await prisma.platformSetting.findMany({ where: { key: { in: keys } } });
  console.log("Config (and when last changed):");
  for (const k of keys) {
    const s = settings.find((x) => x.key === k);
    console.log(`  ${k.padEnd(26)} = ${JSON.stringify(s?.value ?? "(default/unset)")}  | updatedAt ${iso(s?.updatedAt)} (${ago(s?.updatedAt)})`);
  }

  // 2) Sweep health — last entry CREATED (ingest sweep) & last SETTLED (crons).
  const lastCreated = await prisma.posSettlementEntry.findFirst({
    orderBy: { createdAt: "desc" },
    select: { transactionRef: true, createdAt: true, status: true, mode: true },
  });
  const lastSettled = await prisma.posSettlementEntry.findFirst({
    where: { settledAt: { not: null } },
    orderBy: { settledAt: "desc" },
    select: { transactionRef: true, settledAt: true, settledVia: true },
  });
  console.log("\nSweep activity (across ALL terminals):");
  console.log(`  last entry CREATED : ${iso(lastCreated?.createdAt)} (${ago(lastCreated?.createdAt)})  ref=${lastCreated?.transactionRef ?? "—"} ${lastCreated?.status ?? ""}/${lastCreated?.mode ?? ""}`);
  console.log(`  last entry SETTLED : ${iso(lastSettled?.settledAt)} (${ago(lastSettled?.settledAt)})  via=${lastSettled?.settledVia ?? "—"} ref=${lastSettled?.transactionRef ?? "—"}`);

  // 3) How many entries created per day recently (is the sweep producing work?).
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recent = await prisma.posSettlementEntry.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true, status: true },
  });
  const byDay = new Map<string, number>();
  for (const e of recent) {
    const day = new Date(e.createdAt.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  console.log("\nEntries CREATED per IST day (last 7d):");
  for (const [day, n] of [...byDay.entries()].sort()) console.log(`  ${day}: ${n}`);
  if (byDay.size === 0) console.log("  (none created in the last 7 days — sweep is not queuing anything)");

  // 4) Pending backlog that a running T+1 cron SHOULD be draining.
  const pending = await prisma.posSettlementEntry.groupBy({ by: ["status"], _count: true });
  console.log("\nEntry counts by status (all-time):");
  for (const g of pending) console.log(`  ${g.status.padEnd(8)} ${g._count}`);

  // 5) Recent settlement-related admin actions.
  const audits = await prisma.auditLog.findMany({
    where: { action: { startsWith: "pos.settlement" } },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: { createdAt: true, action: true, userId: true, meta: true },
  });
  console.log("\nRecent settlement AuditLog (last 15):");
  if (audits.length === 0) console.log("  (none)");
  for (const a of audits) {
    const paused = (a.meta as { value?: { paused?: boolean; enabled?: boolean } } | null)?.value;
    const flag = paused ? ` paused=${paused.paused ?? "?"} enabled=${paused.enabled ?? "?"}` : "";
    console.log(`  ${iso(a.createdAt)}  ${a.action}${flag}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n✗ Failed:", e);
  process.exit(1);
});
