/**
 * READ-ONLY pre-deploy check: will TODAY's captures settle TOMORROW morning
 * under the NEW code? For a TID, it simulates tomorrow's T+1 run against every
 * unsettled post-assignment capture and prints the exact decision + priced net.
 *
 * Run: $env:POS_TID="43136393"; npx tsx scripts/verify-tomorrow-settlement.ts
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

const TID = (process.env.POS_TID ?? "43136393").trim();
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "—");
const inr = (n: number | string) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Start of the IST calendar day containing `now`, as a UTC Date (matches the cron). */
function startOfIstDay(now: Date): Date {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const startIstMs = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return new Date(startIstMs - 5.5 * 60 * 60 * 1000);
}

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { classifyT1Due, priceMdr } = await import("../src/lib/settlement/pos");
  const { resolvePosHolderForMachine } = await import("../src/lib/pos/holder");
  const { getSetting } = await import("../src/lib/settings");
  const { toNumber, sub, round, dec, gte } = await import("../src/lib/money");

  const machine = await prisma.posMachine.findFirst({
    where: { tid: TID },
    select: { id: true, brandId: true, company: true, provider: true, assignedUserId: true,
      assignedUser: { select: { name: true, schemeId: true } } },
  });
  if (!machine) { console.log("no machine"); await prisma.$disconnect(); return; }

  const cfg = await getSetting("settlement.pos_t1");
  const catchUpDays = (cfg as { catchUpDays?: number }).catchUpDays ?? 0;

  // Simulate the NEXT scheduled T+1 run (today at cfg.hour if we haven't passed
  // it yet, otherwise tomorrow at cfg.hour). The sweep uses startOfTodayIst() at
  // run time, so dueBoundary = start of the RUN's IST day.
  const now = new Date();
  const nowIstHour = new Date(now.getTime() + 5.5 * 60 * 60 * 1000).getUTCHours();
  const runDayStart =
    nowIstHour < cfg.hour
      ? startOfIstDay(now) // next run is today
      : startOfIstDay(new Date(now.getTime() + 24 * 60 * 60 * 1000)); // already past → tomorrow
  const todayStartNow = startOfIstDay(now);
  const dueBoundaryTomorrow = runDayStart; // no brand → classic T+1

  console.log(`\n=== Will the DUE captures settle at the NEXT ${cfg.hour}:00 IST run? ===`);
  console.log(`TID filter: ${TID}  (PENDING section below covers ALL terminals)`);
  console.log(`Machine brand=${machine.brandId ?? "NULL (scheme-priced)"} company=${machine.company} provider=${machine.provider}`);
  console.log(`T+1 config: hour=${cfg.hour}:00 IST  enabled=${cfg.enabled}  paused=${cfg.paused}  minAmount=${inr(cfg.minAmount)}  catchUpDays=${catchUpDays}`);
  console.log(`Now (IST hour): ${nowIstHour}  → next run day starts: ${iso(runDayStart)}`);
  console.log(`Next run DUE window: [${iso(new Date(dueBoundaryTomorrow.getTime() - (1 + catchUpDays) * 86400000))} , ${iso(dueBoundaryTomorrow)})\n`);

  // Every CAPTURED mirror row on this TID with NO settlement entry yet.
  const rows = await prisma.posTransactionMirror.findMany({
    where: { terminalId: TID, status: "CAPTURED", source: { not: "MANUAL" } },
    orderBy: { txnTime: "asc" },
    select: { transactionRef: true, amount: true, txnTime: true, paymentMode: true, cardType: true, cardBrand: true, cardClassification: true },
  });
  const refs = rows.map((r) => r.transactionRef).filter(Boolean) as string[];
  const withEntry = new Set((await prisma.posSettlementEntry.findMany({ where: { transactionRef: { in: refs } }, select: { transactionRef: true } })).map((e) => e.transactionRef));
  const noEntry = rows.filter((r) => r.transactionRef && !withEntry.has(r.transactionRef));

  // Focus: TODAY's captures (what the user cares about).
  const todays = noEntry.filter((r) => r.txnTime >= todayStartNow);
  console.log(`Captures with no entry: ${noEntry.length}  |  of which TODAY's: ${todays.length}\n`);

  let willSettle = 0, willSettleNet = 0;
  for (const t of noEntry) {
    const gross = Number(t.amount);
    const holder = await resolvePosHolderForMachine(machine.id, t.txnTime);
    const passesGate = holder?.userId === machine.assignedUserId;
    const p = await priceMdr({
      userId: machine.assignedUserId!, brandId: machine.brandId, provider: machine.provider,
      paymentMode: t.paymentMode ?? "CARD", grossAmount: gross, settlementType: "T1",
      dims: { company: machine.company, cardType: t.cardType, brandType: t.cardBrand, classification: t.cardClassification },
    });
    const net = p ? toNumber(round(sub(dec(gross), p.mdrAmount))) : null;
    const cls = classifyT1Due(t.txnTime, dueBoundaryTomorrow, catchUpDays);
    const aboveMin = net !== null && gte(dec(net), cfg.minAmount);
    const settlesTomorrow = passesGate && p !== null && cls === "DUE" && aboveMin;
    const isToday = t.txnTime >= todayStartNow;
    if (settlesTomorrow && isToday) { willSettle++; willSettleNet += net!; }

    // Only print today's + anything that would surprisingly settle.
    if (isToday || settlesTomorrow) {
      console.log(
        `  ${t.transactionRef!.padEnd(30)} swipe=${iso(t.txnTime)} gross=${inr(gross).padStart(12)} ` +
          `holder=${passesGate ? "OK" : "PRE-ASSIGN"} priced=${p ? inr(net!) : "NO"} ` +
          `class=${cls} min=${aboveMin ? "ok" : "below"} → ${settlesTomorrow ? "SETTLES TOMORROW ✓" : "no"}`
      );
    }
  }

  console.log(`\nRESULT (captures→entries): ${willSettle} of TODAY's captures will queue+settle tomorrow, net ${inr(willSettleNet)}.`);

  // ---- The REAL check: existing PENDING T1 entries the worker already created ----
  // This mirrors runPosT1SettlementSweep's decision exactly for tomorrow's run.
  console.log(`\n=== Existing PENDING T1 entries → tomorrow's T+1 sweep decision ===`);
  const pend = await prisma.posSettlementEntry.findMany({
    where: { status: "PENDING", mode: "T1" },
    orderBy: { createdAt: "asc" },
    select: { transactionRef: true, userId: true, machineId: true, brandId: true, netAmount: true, capturedAt: true, createdAt: true },
    take: 500,
  });
  console.log(`PENDING T1 entries system-wide: ${pend.length}`);
  let due = 0, dueNet = 0, heldC = 0, staleC = 0, belowMin = 0, badHolder = 0;
  for (const e of pend) {
    const captured = e.capturedAt ?? e.createdAt;
    // No brand on the entry (scheme-priced) → dueBoundary = start of run's IST day.
    const cls = classifyT1Due(captured, dueBoundaryTomorrow, catchUpDays);
    const aboveMin = gte(dec(e.netAmount as never), cfg.minAmount);
    let holderOk = true;
    if (e.capturedAt && e.machineId) {
      const h = await resolvePosHolderForMachine(e.machineId, e.capturedAt);
      holderOk = !!h && h.userId === e.userId;
    }
    const willPay = cls === "DUE" && aboveMin && holderOk;
    if (cls === "HELD") heldC++;
    if (cls === "STALE") staleC++;
    if (cls === "DUE" && !aboveMin) belowMin++;
    if (cls === "DUE" && !holderOk) badHolder++;
    if (willPay) { due++; dueNet += toNumber(e.netAmount); }
    console.log(
      `  ${e.transactionRef.padEnd(30)} brand=${e.brandId ?? "null"} swipe=${iso(captured)} ` +
        `net=${inr(e.netAmount as never).padStart(13)} ${cls} holder=${holderOk ? "OK" : "MISMATCH"} ` +
        `min=${aboveMin ? "ok" : "below"} → ${willPay ? "SETTLES ✓" : "no"}`
    );
  }
  console.log(`\nTOMORROW at ${cfg.hour}:00 IST the T+1 sweep will settle: ${due} entries, net ${inr(dueNet)}.`);
  if (heldC || staleC || belowMin || badHolder)
    console.log(`  (held=${heldC} stale=${staleC} belowMin=${belowMin} holderMismatch=${badHolder} — left PENDING)`);
  if (!cfg.enabled || cfg.paused) console.log(`⚠ T+1 is ${cfg.paused ? "PAUSED" : "DISABLED"} — enable it or nothing settles.`);
  console.log(`Reminder: this requires the WORKER process to be running at ${cfg.hour}:00 IST.`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
