/**
 * READ-ONLY: will tomorrow's POS T+1 auto-settlement + commission fire?
 * Reads the live settlement configs and the pg-boss schedule/job state for the
 * T+1 queue. Safe to run from anywhere.
 *
 *   npx tsx scripts/diag-t1-settlement.ts
 */
export {};

try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.();
} catch {
  /* env provided by the shell */
}

function istHourNow(): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(new Date())
  );
}

async function main() {
  const { prisma } = await import("@/lib/db");
  const { getSetting } = await import("@/lib/settings");

  console.log("\n=== POS T+1 settlement readiness ===\n");

  const t1 = await getSetting("settlement.pos_t1");
  const instant = await getSetting("settlement.pos_instant");
  const button = await getSetting("settlement.instant_button");
  console.log("settlement.pos_t1        :", JSON.stringify(t1));
  console.log("settlement.pos_instant   :", JSON.stringify(instant));
  console.log("settlement.instant_button:", JSON.stringify(button));
  console.log(`\nCurrent IST hour: ${istHourNow()}  (T+1 sweep fires when IST hour === pos_t1.hour)`);

  // Pending T1 entries waiting to be swept.
  const pending = await prisma.posSettlementEntry.groupBy({
    by: ["mode", "status"],
    _count: { _all: true },
    _sum: { netAmount: true },
  });
  console.log("\nSettlement entries by mode/status:");
  for (const p of pending)
    console.log(`  ${p.mode}/${p.status}: n=${p._count._all} net=₹${p._sum.netAmount ?? 0}`);

  // pg-boss schedule + recent job runs for the T+1 queue (proves the worker
  // scheduled it and is draining it hourly).
  try {
    const sched = await prisma.$queryRawUnsafe<any[]>(
      `select name, cron, timezone, created_on, updated_on from pgboss.schedule where name = 'pos.settlement.t1'`
    );
    console.log("\npg-boss schedule for pos.settlement.t1:");
    if (sched.length === 0) console.log("  ⚠ NO SCHEDULE ROW — the worker hasn't registered this cron (worker not started since deploy?).");
    for (const s of sched) console.log(`  cron='${s.cron}' tz='${s.timezone}' updated=${s.updated_on?.toISOString?.() ?? s.updated_on}`);

    const jobs = await prisma.$queryRawUnsafe<any[]>(
      `select state, count(*)::int as n, max(created_on) as last_created, max(completed_on) as last_completed
       from pgboss.job where name = 'pos.settlement.t1' group by state order by state`
    );
    console.log("\npg-boss job states for pos.settlement.t1:");
    if (jobs.length === 0) console.log("  (no jobs yet — expected until the next hourly tick creates one)");
    for (const j of jobs)
      console.log(`  [${j.state}] n=${j.n} lastCreated=${j.last_created?.toISOString?.() ?? j.last_created} lastCompleted=${j.last_completed?.toISOString?.() ?? j.last_completed}`);
  } catch (e) {
    console.log("\n(pg-boss tables not queryable:", (e as Error).message, ")");
  }

  console.log("\n=== Verdict ===");
  const enabled = (t1 as { enabled?: boolean }).enabled;
  const paused = (t1 as { paused?: boolean }).paused;
  const hour = (t1 as { hour?: number }).hour;
  const minAmount = (t1 as { minAmount?: number }).minAmount;
  console.log(`enabled=${enabled} paused=${paused} hour=${hour} minAmount=₹${minAmount}`);
  if (!enabled || paused) console.log("→ ⚠ T+1 sweep is DISABLED/PAUSED — it will NOT auto-credit. Enable it on Admin → POS Settlements.");
  else console.log(`→ T+1 sweep will fire at ${hour}:00 IST for captures from a previous IST day, net ≥ ₹${minAmount}, and distribute commission at settlement.`);

  await prisma.$disconnect();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
