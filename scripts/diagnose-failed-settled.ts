/**
 * READ-ONLY: find POS settlement entries whose underlying mirror txn is NOT
 * CAPTURED (i.e. FAILED/VOIDED/REFUNDED/AUTHORIZED) — a settlement paid on a
 * non-captured transaction. Also dumps all mirror rows for a TID+date so we can
 * see failed-attempt vs successful-retry.
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
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
const TID = (process.env.POS_TID ?? "43136393").trim();
const inr = (n: any) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "—");

async function main() {
  const { prisma } = await import("../src/lib/db");

  // ── 1. THE SMOKING GUN: settlement entries on non-CAPTURED mirror rows ──
  const entries = await prisma.posSettlementEntry.findMany({
    select: { transactionRef: true, status: true, grossAmount: true, mdrAmount: true, settledAt: true, settledVia: true, walletTxnId: true, capturedAt: true },
  });
  const refs = entries.map((e) => e.transactionRef);
  const mirrors = await prisma.posTransactionMirror.findMany({
    where: { transactionRef: { in: refs } },
    select: { transactionRef: true, status: true, customerName: true, rrn: true, cardNumber: true, reversedAt: true, reversalReason: true },
  });
  const mByRef = new Map(mirrors.map((m) => [m.transactionRef, m]));

  // A REVERSED entry on a non-captured mirror is the CORRECT resolved state —
  // only money-active entries (SETTLED / PENDING) on a non-captured txn are a
  // financial risk (paid / about-to-pay on a failed/voided/refunded swipe).
  const bad = entries.filter((e) => {
    const m = mByRef.get(e.transactionRef);
    return m && String(m.status).toUpperCase() !== "CAPTURED" && String(e.status).toUpperCase() !== "REVERSED";
  });
  console.log(`\n=== MONEY-ACTIVE entries (SETTLED/PENDING) on a NON-CAPTURED txn: ${bad.length} ===`);
  for (const e of bad) {
    const m = mByRef.get(e.transactionRef)!;
    const net = Number(e.grossAmount) - Number(e.mdrAmount);
    console.log(`  ${e.transactionRef}`);
    console.log(`     mirror.status=${m.status}  customer=${m.customerName}  rrn=${m.rrn}  card=${m.cardNumber}  reversedAt=${iso(m.reversedAt)} reason=${m.reversalReason ?? "—"}`);
    console.log(`     entry.status=${e.status}  net=${inr(net)}  settledAt=${iso(e.settledAt)}  via=${e.settledVia ?? "—"}  wtx=${e.walletTxnId ? "yes" : "NO"}`);
  }

  // ── 2. Also: entries with NO mirror row at all (mirror deleted/mismatch) ──
  const orphan = entries.filter((e) => !mByRef.has(e.transactionRef));
  console.log(`\n=== Settlement entries with NO matching mirror row: ${orphan.length} ===`);
  for (const e of orphan.slice(0, 20)) console.log(`  ${e.transactionRef}  status=${e.status}`);

  // ── 3. Full mirror dump for the TID (all statuses) recent window ──
  const rows = await prisma.posTransactionMirror.findMany({
    where: { terminalId: TID },
    orderBy: { txnTime: "desc" },
    take: 40,
    select: { transactionRef: true, status: true, amount: true, txnTime: true, customerName: true, rrn: true, cardNumber: true, source: true, reversedAt: true },
  });
  const rowRefs = rows.map((r) => r.transactionRef);
  const haveEntry = new Set((await prisma.posSettlementEntry.findMany({ where: { transactionRef: { in: rowRefs } }, select: { transactionRef: true, status: true } })).map((e) => `${e.transactionRef}|${e.status}`));
  const entryStatus = new Map<string, string>();
  for (const key of haveEntry) { const [r, s] = key.split("|"); entryStatus.set(r, s); }
  console.log(`\n=== Last 40 mirror rows for TID ${TID} ===`);
  for (const r of rows) {
    const es = entryStatus.get(r.transactionRef);
    console.log(`  ${iso(r.txnTime)}  ${String(r.status).padEnd(10)} ${inr(r.amount).padStart(13)}  cust=${(r.customerName ?? "—").padEnd(18)} rrn=${(r.rrn ?? "—").padEnd(14)} card=${r.cardNumber ?? "—"} src=${r.source}  entry=${es ?? "none"}  ref=${r.transactionRef}`);
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
