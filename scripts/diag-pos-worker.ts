/**
 * READ-ONLY: is the POS mirror sweep paused, or is the worker dead?
 * DB-only (no partner call), safe to run from anywhere.
 *
 *   npx tsx scripts/diag-pos-worker.ts
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

async function main() {
  const { prisma } = await import("../src/lib/db");

  console.log("\n=== POS worker / sweep diagnostic ===\n");

  // 1. mirror_sync platform setting
  const setting = await prisma.platformSetting.findUnique({ where: { key: "pos.mirror_sync" } }).catch(() => null);
  console.log("pos.mirror_sync setting:", setting ? JSON.stringify(setting.value) : "(unset → defaults: enabled)");

  // 2. Mirror freshness per source
  const bySource = await prisma.posTransactionMirror.groupBy({
    by: ["source"],
    _count: { _all: true },
    _max: { txnTime: true, createdAt: true, updatedAt: true },
  });
  console.log("\nMirror rows by source (with latest timestamps):");
  for (const s of bySource) {
    console.log(`  ${s.source}: count=${s._count._all} maxTxnTime=${s._max.txnTime?.toISOString()} maxUpdatedAt=${s._max.updatedAt?.toISOString()}`);
  }

  // 3. Machine mirror freshness (the other worker job)
  const machineMax = await prisma.posMachine.aggregate({ _max: { syncedAt: true, updatedAt: true }, _count: { _all: true } }).catch(() => null);
  if (machineMax) {
    console.log(`\nPosMachine: count=${machineMax._count._all} maxSyncedAt=${machineMax._max.syncedAt?.toISOString()} maxUpdatedAt=${machineMax._max.updatedAt?.toISOString()}`);
  }

  // 4. Recent worker activity via audit logs
  const logs = await prisma.auditLog.findMany({
    where: { action: { in: ["pos.machines.sync", "pos.mirror.sync", "pos.settle.sweep"] } },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { action: true, createdAt: true, meta: true },
  }).catch(() => []);
  console.log(`\nRecent POS worker audit logs (${logs.length}):`);
  for (const l of logs) console.log(`  ${l.createdAt.toISOString()} ${l.action} ${JSON.stringify(l.meta)}`);

  // 5. pg-boss job activity for the mirror queue (is the worker draining jobs?)
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select name, state, count(*)::int as n, max(created_on) as last_created, max(completed_on) as last_completed
       from pgboss.job
       where name in ('pos.mirror.sync','pos.machines.sync')
       group by name, state order by name, state`
    );
    console.log("\npg-boss job states for POS queues:");
    for (const r of rows) console.log(`  ${r.name} [${r.state}] n=${r.n} lastCreated=${r.last_created?.toISOString?.() ?? r.last_created} lastCompleted=${r.last_completed?.toISOString?.() ?? r.last_completed}`);
  } catch (e) {
    console.log("\n(pg-boss job table not queryable:", (e as Error).message, ")");
  }

  const now = Date.now();
  const newest = bySource.map((s) => s._max.updatedAt?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);
  const ageMin = newest ? Math.round((now - newest) / 60000) : Infinity;
  console.log(`\n=== Verdict ===`);
  console.log(`Mirror last updated ${Number.isFinite(ageMin) ? ageMin + " min ago" : "never"}.`);
  if (ageMin > 15) console.log("→ Sweep has NOT written in >15 min: worker down OR sweep failing OR setting paused (see above).");
  else console.log("→ Sweep is fresh; empty feed would be a scope/date-filter issue, not ingestion.");

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error("\n✗ Diagnostic failed:", e); process.exit(1); });
