/**
 * READ-ONLY diagnostic: quantify the "provider succeeded but we recorded FAILED
 * + refunded" exposure on the service rails (BBPS/Pay2New + RechargeKit CC-2).
 *
 * Background: a pay whose HTTP response was lost/ambiguous (NETWORK timeout,
 * 5xx/408/429, or an uncaught exception) is finalized by runTransaction as a
 * TERMINAL `FAILED` and the reserve (amount + fee) is REVERSAL-credited back to
 * the retailer. If the provider actually processed the payment, that refund is a
 * direct, silent financial loss — and no sweep re-checks a terminal FAILED row.
 *
 * This script ONLY reads:
 *   • DB   — counts FAILED rows with an INDETERMINATE errorCode in the window,
 *            confirms a REVERSAL credit was issued, and sums the rupee exposure.
 *   • (opt) provider status API — with POLL=1, re-polls each candidate's
 *            authoritative status to split MAX exposure into CONFIRMED loss
 *            (provider = SUCCESS) vs correctly-failed vs still-pending.
 *
 * It NEVER writes to the DB, never finalizes, never moves money.
 *
 * Usage:
 *   # Fast DB-only scan (no provider calls) — safe anywhere with DB access:
 *   ./node_modules/.bin/tsx scripts/diag-indeterminate-failures.ts
 *
 *   # Confirmed-loss scan (polls the provider) — MUST run on the IP-whitelisted
 *   # worker/EC2 box, else every status poll is rejected:
 *   POLL=1 ./node_modules/.bin/tsx scripts/diag-indeterminate-failures.ts
 *
 * Env knobs:
 *   DAYS=30      lookback window in days (default 30)
 *   POLL=1       additionally re-poll the provider for the authoritative status
 *   POLL_ALL=1   in POLL mode, poll EVERY recent FAILED row (not just the
 *                indeterminate ones) to also catch HTTP-200/success:false edges
 */
import "./_load-env";
import { prisma } from "../src/lib/db";
import { deriveTxnRefs } from "../src/lib/recon/refs";
import { recoverRefsFromApiLog } from "../src/lib/recon/recover";

const DAYS = Number(process.env.DAYS ?? "30") || 30;
const POLL = process.env.POLL === "1" || process.env.POLL === "true";
const POLL_ALL = process.env.POLL_ALL === "1" || process.env.POLL_ALL === "true";

const RK_PARTNER = "SAMEDAY_RECHARGEKIT";
const BBPS_SERVICES = [
  "BILL_ELECTRICITY", "BILL_WATER", "BILL_GAS",
  "BILL_CREDIT_CARD", "BILL_EDUCATION", "BILL_INSURANCE",
  "RECHARGE_BROADBAND",
] as const;

/**
 * An errorCode is INDETERMINATE when it means "we never got a definitive answer"
 * (transport/gateway/exception) rather than an explicit business decline. These
 * are the rows where the provider may have actually succeeded.
 */
function isIndeterminate(code: string | null | undefined): boolean {
  const c = (code ?? "").toUpperCase();
  if (c === "NETWORK" || c === "EXCEPTION" || c === "TIMEOUT") return true;
  // HTTP 5xx, 408 (request timeout), 429 (rate limited) = retryable/ambiguous.
  const m = c.match(/^HTTP_(\d{3})$/);
  if (m) {
    const s = Number(m[1]);
    return s >= 500 || s === 408 || s === 429;
  }
  return false;
}

const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ageStr = (ms: number) =>
  `${Math.floor(ms / 86_400_000)}d ${Math.floor((ms % 86_400_000) / 3_600_000)}h`;
const num = (d: { toNumber(): number } | number | null | undefined) =>
  d == null ? 0 : typeof d === "number" ? d : d.toNumber();

type Row = {
  id: string;
  refId: string;
  service: string;
  partner: string | null;
  status: string;
  errorCode: string | null;
  partnerTxnId: string | null;
  amount: { toNumber(): number };
  fee: { toNumber(): number };
  request: unknown;
  response: unknown;
  createdAt: Date;
};

async function reversalIssued(txnId: string): Promise<number> {
  // Did the FAILED path actually refund the reserve? Sum REVERSAL credits tied
  // to this transaction — this is the cash that left the retailer's wallet.
  const rows = await prisma.walletTxn.findMany({
    where: { refType: "Transaction", refId: txnId, reason: "REVERSAL" },
    select: { amount: true },
  });
  return rows.reduce((s, r) => s + num(r.amount), 0);
}

async function pollProviderStatus(
  row: Row
): Promise<"SUCCESS" | "FAILED" | "REFUNDED" | "PENDING" | "UNRESOLVED"> {
  // Candidate poll refs: partnerTxnId + anything mined from request/response
  // (Pay2New's bill_fetch_ref survives in `request`), then the durable
  // PartnerApiLog as a last resort. Read-only: we only call status().
  let refs = deriveTxnRefs({ partnerTxnId: row.partnerTxnId, request: row.request, response: row.response });
  if (refs.length === 0) refs = await recoverRefsFromApiLog(row.refId);
  if (refs.length === 0) return "UNRESOLVED";

  if (row.partner === RK_PARTNER) {
    const { rechargekitStatus } = await import("../src/lib/partners/sameday-rechargekit");
    for (const ref of refs) {
      let r = await rechargekitStatus({ txnId: ref });
      if (!r.ok) r = await rechargekitStatus({ requestId: ref });
      if (r.ok) return r.data.status;
    }
    return "UNRESOLVED";
  }

  // BBPS / Pay2New
  const { getPartner } = await import("../src/lib/partners");
  const bbps = getPartner("bbps");
  if (!bbps.status) return "UNRESOLVED";
  for (const ref of refs) {
    let r = await bbps.status({ orderId: ref });
    if (!r.ok) r = await bbps.status({ requestId: ref });
    if (r.ok) return r.data.status;
  }
  return "UNRESOLVED";
}

async function main() {
  const since = new Date(Date.now() - DAYS * 86_400_000);
  console.log(`\n=== Indeterminate-FAILED exposure diagnostic (READ-ONLY) ===`);
  console.log(`Window      : last ${DAYS} day(s) (since ${since.toISOString()})`);
  console.log(`Rails       : BBPS/Pay2New (${BBPS_SERVICES.join(", ")}) + RechargeKit CC-2`);
  console.log(`Poll mode   : ${POLL ? (POLL_ALL ? "ON (all FAILED rows)" : "ON (indeterminate only)") : "OFF (DB scan only)"}`);

  const failed = (await prisma.transaction.findMany({
    where: {
      status: "FAILED",
      createdAt: { gte: since },
      OR: [{ partner: RK_PARTNER }, { service: { in: BBPS_SERVICES as unknown as string[] } }],
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, refId: true, service: true, partner: true, status: true,
      errorCode: true, partnerTxnId: true, amount: true, fee: true,
      request: true, response: true, createdAt: true,
    },
  })) as Row[];

  const candidates = failed.filter((r) => isIndeterminate(r.errorCode));

  // ── Breakdown by errorCode ────────────────────────────────────────────────
  const byCode = new Map<string, { count: number; reserve: number }>();
  let maxReserveExposure = 0;
  let realizedRefund = 0;
  const detail: Array<{ row: Row; reserve: number; refunded: number; pollable: boolean }> = [];

  for (const r of candidates) {
    const reserve = num(r.amount) + num(r.fee);
    const refunded = await reversalIssued(r.id);
    const refs = deriveTxnRefs({ partnerTxnId: r.partnerTxnId, request: r.request, response: r.response });
    maxReserveExposure += reserve;
    realizedRefund += refunded;
    const key = (r.errorCode ?? "(null)").toUpperCase();
    const agg = byCode.get(key) ?? { count: 0, reserve: 0 };
    agg.count++; agg.reserve += reserve; byCode.set(key, agg);
    detail.push({ row: r, reserve, refunded, pollable: refs.length > 0 });
  }

  console.log(`\n--- Candidate FAILED rows (indeterminate errorCode) ---`);
  console.log(`Total FAILED (both rails) in window : ${failed.length}`);
  console.log(`  of which INDETERMINATE            : ${candidates.length}`);
  console.log(`  MAX reserve exposure (amount+fee) : ${inr(maxReserveExposure)}`);
  console.log(`  of that, REVERSAL actually issued : ${inr(realizedRefund)}  (cash returned to retailers)`);

  if (byCode.size > 0) {
    console.log(`\n  By errorCode:`);
    for (const [code, a] of [...byCode.entries()].sort((x, y) => y[1].reserve - x[1].reserve)) {
      console.log(`     · ${code.padEnd(12)}  count=${String(a.count).padStart(4)}  reserve=${inr(a.reserve)}`);
    }
  }

  if (candidates.length > 0) {
    console.log(`\n  Rows:`);
    for (const d of detail) {
      const rail = d.row.partner === RK_PARTNER ? "RK  " : "BBPS";
      console.log(
        `     ${d.row.refId}  ${rail}  ${d.row.service.padEnd(18)}  ` +
          `${inr(d.reserve).padStart(14)}  code=${(d.row.errorCode ?? "-").padEnd(10)}  ` +
          `refunded=${d.refunded > 0 ? "yes" : "NO "}  pollable=${d.pollable ? "yes" : "NO "}  ` +
          `age=${ageStr(Date.now() - d.row.createdAt.getTime())}`
      );
    }
  }

  // ── Optional: confirm the real loss by polling the provider ────────────────
  if (POLL) {
    const toPoll = POLL_ALL ? failed : candidates;
    console.log(`\n--- Polling provider authoritative status for ${toPoll.length} row(s) ---`);
    console.log(`(read-only status() calls; must run on the IP-whitelisted host)\n`);

    let confirmedSuccess = 0, confirmedSuccessAmt = 0;
    let providerFailed = 0, providerPending = 0, unresolved = 0;
    const recoverable: Array<{ refId: string; rail: string; service: string; reserve: number; refunded: number }> = [];

    for (const r of toPoll) {
      const reserve = num(r.amount) + num(r.fee);
      let st: Awaited<ReturnType<typeof pollProviderStatus>>;
      try {
        st = await pollProviderStatus(r);
      } catch (e) {
        unresolved++;
        console.log(`   ${r.refId}  POLL_ERROR  ${String(e).slice(0, 80)}`);
        continue;
      }
      const rail = r.partner === RK_PARTNER ? "RK" : "BBPS";
      if (st === "SUCCESS") {
        confirmedSuccess++; confirmedSuccessAmt += reserve;
        const refunded = await reversalIssued(r.id);
        recoverable.push({ refId: r.refId, rail, service: r.service, reserve, refunded });
        console.log(`   ${r.refId}  ${rail}  provider=SUCCESS  reserve=${inr(reserve)}  <-- RECOVERABLE LOSS`);
      } else if (st === "FAILED" || st === "REFUNDED") {
        providerFailed++;
      } else if (st === "PENDING") {
        providerPending++;
      } else {
        unresolved++;
      }
    }

    console.log(`\n=== CONFIRMED RESULTS (polled) ===`);
    console.log(`  provider SUCCESS (real loss) : ${confirmedSuccess}  =  ${inr(confirmedSuccessAmt)}`);
    console.log(`  provider FAILED/REFUNDED     : ${providerFailed}  (correctly failed — no action)`);
    console.log(`  provider PENDING             : ${providerPending}  (still in flight at provider)`);
    console.log(`  UNRESOLVED (no ref/transient): ${unresolved}`);

    if (recoverable.length > 0) {
      const totalRefunded = recoverable.reduce((s, x) => s + x.refunded, 0);
      console.log(`\n  Recoverable (provider=SUCCESS) detail:`);
      for (const x of recoverable) {
        console.log(`     ${x.refId}  ${x.rail.padEnd(4)}  ${x.service.padEnd(18)}  reserve=${inr(x.reserve)}  refunded=${inr(x.refunded)}`);
      }
      console.log(`\n  >>> TOTAL CONFIRMED RECOVERABLE LOSS: ${inr(confirmedSuccessAmt)}`);
      console.log(`  >>> of which already REVERSAL-refunded to retailers: ${inr(totalRefunded)}`);
    } else {
      console.log(`\n  No provider=SUCCESS rows found — nothing to recover in this window.`);
    }
  } else {
    console.log(
      `\nNOTE: run again with POLL=1 on the IP-whitelisted host to split the ` +
        `${inr(maxReserveExposure)} MAX exposure into CONFIRMED loss vs correctly-failed.`
    );
  }

  console.log(`\n=== end ===\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
