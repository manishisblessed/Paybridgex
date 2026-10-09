/**
 * READ-ONLY: distinguish WHY the eligible-but-unsettled Oct-9 captures have no
 * entry — a worker POS_INGEST outage vs NO_SCHEME pricing failures.
 *
 *  • pos.webhook.capture audits grouped by result status (did the webhook even
 *    reach handlePosCapture, and what did it return?).
 *  • settlement-entry createdAt timeline across Oct 9 (when did entry creation
 *    stop?).
 *  • latest PosTransactionMirror.createdAt (is the pull sweep still feeding it?).
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
function istDayWindow(day: string) {
  const [y, mo, d] = day.split("-").map(Number);
  const fromMs = Date.UTC(y, mo - 1, d) - 5.5 * 3600_000;
  return { from: new Date(fromMs), to: new Date(fromMs + 24 * 3600_000) };
}
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "—");

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { from, to } = istDayWindow(DAY);

  // 1) Did captures arrive via the real-time webhook at all on Oct 9?
  const capAudits = await prisma.auditLog.findMany({
    where: { action: "pos.webhook.capture", createdAt: { gte: from, lt: to } },
    select: { createdAt: true, meta: true },
  });
  const byStatus = new Map<string, number>();
  for (const a of capAudits) {
    const st = String((a.meta as { status?: string } | null)?.status ?? "?");
    byStatus.set(st, (byStatus.get(st) ?? 0) + 1);
  }
  console.log(`\n=== Oct-9 webhook capture audits (pos.webhook.capture) ===`);
  console.log(`total webhook captures logged: ${capAudits.length}`);
  for (const [st, n] of byStatus) console.log(`   result ${st.padEnd(10)} ${n}`);
  if (capAudits.length === 0) console.log("   (NONE — no real-time POS capture webhooks arrived; mirror is fed by the pull sweep only)");

  // 2) Entry-creation timeline on Oct 9 (hour-by-hour, IST).
  const created = await prisma.posSettlementEntry.findMany({
    where: { createdAt: { gte: from, lt: to } },
    select: { createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`\n=== PosSettlementEntry created on Oct 9 (by IST hour) ===`);
  const byHour = new Map<string, number>();
  for (const e of created) {
    const h = new Date(e.createdAt.getTime() + 5.5 * 3600_000).toISOString().slice(11, 13);
    byHour.set(h, (byHour.get(h) ?? 0) + 1);
  }
  for (const [h, n] of [...byHour.entries()].sort()) console.log(`   ${h}:00 IST  ${n}`);
  console.log(`   first created: ${iso(created[0]?.createdAt)}`);
  console.log(`   last  created: ${iso(created[created.length - 1]?.createdAt)}`);

  // 3) Is the mirror still being fed after entry-creation stopped?
  const lastMirror = await prisma.posTransactionMirror.findFirst({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, transactionRef: true, status: true },
  });
  const latestSwipeOct9 = await prisma.posTransactionMirror.findFirst({
    where: { status: "CAPTURED", txnTime: { gte: from, lt: to } },
    orderBy: { txnTime: "desc" },
    select: { txnTime: true, createdAt: true, transactionRef: true },
  });
  console.log(`\n=== Mirror freshness ===`);
  console.log(`   last mirror row CREATED (any day): ${iso(lastMirror?.createdAt)}  ref=${lastMirror?.transactionRef}`);
  console.log(`   latest Oct-9 CAPTURED swipe       : swipe ${iso(latestSwipeOct9?.txnTime)}  mirrored ${iso(latestSwipeOct9?.createdAt)}`);

  // 4) Recent worker heartbeat / sweep markers (did the worker keep running?).
  const workerMarks = await prisma.auditLog.findMany({
    where: { action: { in: ["recon.heartbeat", "recon.connectivity", "pos.settlement.ops"] }, createdAt: { gte: from } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { createdAt: true, action: true },
  });
  console.log(`\n=== Recent worker markers (since Oct 9 00:00 IST) ===`);
  if (workerMarks.length === 0) console.log("   (none)");
  for (const w of workerMarks) console.log(`   ${iso(w.createdAt)}  ${w.action}`);

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("✗", e); process.exit(1); });
