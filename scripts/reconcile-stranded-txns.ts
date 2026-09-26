/**
 * One-off, IDEMPOTENT backfill: resolve service transactions stranded in
 * PROCESSING — including the pre-fix rows whose `partnerTxnId` is blank but
 * whose poll reference survives in the stored `request` JSON (Pay2New's
 * bill_fetch_ref). Safe to run repeatedly.
 *
 * MUST run on the IP-whitelisted host (the worker/EC2 box) — the provider status
 * APIs reject non-whitelisted IPs. It reuses the SAME shared, idempotent
 * finalizer as the live sweeps (status-claim + keyed ledger), so:
 *   • a SUCCESS row is never refunded,
 *   • a FAILED reserve is refunded at most once,
 *   • a still-PENDING row is left untouched (only the provider's terminal
 *     answer moves money).
 *
 * Usage (whole backlog):   ./node_modules/.bin/tsx scripts/reconcile-stranded-txns.ts
 * Usage (single ref):      REF=TXNL9SQOBIL_D ./node_modules/.bin/tsx scripts/reconcile-stranded-txns.ts
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

const REF = (process.env.REF ?? "").trim();
const RK_PARTNER = "SAMEDAY_RECHARGEKIT";
const BBPS_SERVICES = [
  "BILL_ELECTRICITY", "BILL_WATER", "BILL_GAS",
  "BILL_CREDIT_CARD", "BILL_EDUCATION", "BILL_INSURANCE",
  "RECHARGE_BROADBAND",
];
const ageStr = (ms: number) => `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;

async function listNonTerminal(prisma: typeof import("../src/lib/db").prisma) {
  return prisma.transaction.findMany({
    where: {
      status: { in: ["INITIATED", "PROCESSING"] },
      OR: [{ partner: RK_PARTNER }, { service: { in: BBPS_SERVICES as never[] } }],
    },
    orderBy: { createdAt: "asc" },
    select: { refId: true, service: true, partner: true, status: true, partnerTxnId: true, amount: true, createdAt: true },
  });
}

async function main() {
  const { prisma } = await import("../src/lib/db");

  // ── Single-ref mode: targeted, authoritative re-poll + finalize. ──────────
  if (REF) {
    const { reconcileOneTransaction } = await import("../src/lib/recon/reconcileOne");
    console.log(`\n=== Targeted reconcile for refId=${REF} ===`);
    const r = await reconcileOneTransaction(REF, { source: "backfill_script" });
    console.log(JSON.stringify(r, null, 2));
    await prisma.$disconnect();
    return;
  }

  // ── Backlog mode: report → run the (fixed) sweeps → report. ───────────────
  const before = await listNonTerminal(prisma);
  console.log(`\n=== Stranded non-terminal service txns BEFORE: ${before.length} ===`);
  for (const t of before) {
    const rail = t.partner === RK_PARTNER ? "RK" : "BBPS";
    console.log(
      `${t.refId}  ${rail}  ${t.service}  ${t.status}  ₹${Number(t.amount)}  ` +
        `partnerTxnId=${t.partnerTxnId ?? "(blank)"}  age=${ageStr(Date.now() - t.createdAt.getTime())}`
    );
  }

  console.log(`\n--- Running BBPS reconciliation (idempotent) ---`);
  const { runBbpsReconciliation } = await import("../src/lib/recon/bbps");
  const b = await runBbpsReconciliation();
  console.log(JSON.stringify(b, null, 2));

  console.log(`\n--- Running RechargeKit reconciliation (idempotent) ---`);
  const { runRechargekitReconciliation } = await import("../src/lib/recon/rechargekit");
  const rk = await runRechargekitReconciliation();
  console.log(JSON.stringify(rk, null, 2));

  const after = await listNonTerminal(prisma);
  console.log(`\n=== Stranded non-terminal service txns AFTER: ${after.length} ===`);
  const resolved = before.length - after.length;
  console.log(`Resolved this run: ${resolved >= 0 ? resolved : 0}`);
  for (const t of after) {
    const rail = t.partner === RK_PARTNER ? "RK" : "BBPS";
    console.log(
      `STILL PENDING  ${t.refId}  ${rail}  ${t.service}  ₹${Number(t.amount)}  ` +
        `partnerTxnId=${t.partnerTxnId ?? "(blank)"}  age=${ageStr(Date.now() - t.createdAt.getTime())}`
    );
  }
  if (after.length > 0) {
    console.log(
      `\nNote: rows STILL pending returned PENDING at the provider (or had no pollable\n` +
        `ref). Per policy they stay pending until the provider's status API reports a\n` +
        `terminal state — the 5-min sweep will keep polling them automatically.`
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
