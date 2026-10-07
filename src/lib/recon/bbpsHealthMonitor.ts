/**
 * BBPS rail failure-rate monitor (worker, scheduled every 5 min).
 *
 * WHY: the Oct-2026 incident — a sustained upstream BBPS degradation — was only
 * discovered from retailer screenshots, days in. This closes that blind spot:
 * it reads the authoritative Transaction ledger over a short rolling window and
 * pages ops the moment the credit-card / bill-pay failure rate spikes, so we
 * hear about a Same Day / biller outage before customers tell us.
 *
 * It is DB-based (not the in-process UI health window) so it sees the whole
 * cluster's traffic and the true money outcome of every attempt. Failures that
 * aren't rail-health signals — a retailer's wrong card last-4 (USER_ERROR) or a
 * replay of an already-refunded bill_fetch_ref (STALE_SESSION) — are excluded so
 * the alert reflects real provider health, not noise.
 */
import { prisma } from "../db";
import { sendOpsAlert } from "../monitoring/alerts";
import { classifyBbpsFailure } from "../services/bbpsHealth";
import { flags } from "../env";
import type { ServiceCode } from "@prisma/client";

const BBPS_SERVICES: ServiceCode[] = [
  "BILL_ELECTRICITY", "BILL_WATER", "BILL_GAS",
  "BILL_CREDIT_CARD", "BILL_EDUCATION", "BILL_INSURANCE",
  "RECHARGE_BROADBAND",
];

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const WINDOW_MIN = num(process.env.BBPS_MONITOR_WINDOW_MIN, 15);
const MIN_SAMPLE = num(process.env.BBPS_MONITOR_MIN_SAMPLE, 15);
const WARN_RATE = num(process.env.BBPS_MONITOR_WARN_RATE, 0.5);
const CRIT_RATE = num(process.env.BBPS_MONITOR_CRIT_RATE, 0.7);
const COOLDOWN_MIN = num(process.env.BBPS_MONITOR_COOLDOWN_MIN, 30);

// Single-process worker, so an in-memory cooldown is enough to avoid alert spam
// while an outage persists (one page per cooldown window, plus recovery notice).
let lastAlertAt = 0;
let alerting = false;

export type BbpsMonitorResult = {
  skipped?: boolean;
  sample: number;
  failRate: number;
  apiShare: number;
  alerted: boolean;
};

export async function runBbpsFailureRateMonitor(): Promise<BbpsMonitorResult> {
  if (!flags.bbps) return { skipped: true, sample: 0, failRate: 0, apiShare: 0, alerted: false };

  const since = new Date(Date.now() - WINDOW_MIN * 60_000);
  const rows = await prisma.transaction.findMany({
    where: { service: { in: BBPS_SERVICES }, createdAt: { gte: since } },
    select: { status: true, errorCode: true, errorMessage: true, operator: true },
  });

  let success = 0;
  let apiFail = 0;
  let billerFail = 0;
  const perBiller = new Map<string, { total: number; fail: number }>();

  for (const r of rows) {
    const biller = (r.operator ?? "").trim() || "UNKNOWN";
    const b = perBiller.get(biller) ?? { total: 0, fail: 0 };

    if (r.status === "SUCCESS") {
      success += 1;
      b.total += 1;
      perBiller.set(biller, b);
      continue;
    }
    // FAILED (definitive) or NEEDS_REVIEW (indeterminate held) carry the raw
    // code/message. PROCESSING hasn't resolved yet — ignore it this window.
    if (r.status !== "FAILED" && r.status !== "NEEDS_REVIEW") continue;

    const kind = classifyBbpsFailure(r.errorCode, r.errorMessage);
    if (kind === "USER_ERROR" || kind === "STALE_SESSION") continue; // not a rail signal

    if (kind === "API_DOWN") apiFail += 1;
    else billerFail += 1;
    b.total += 1;
    b.fail += 1;
    perBiller.set(biller, b);
  }

  const totalFail = apiFail + billerFail;
  const sample = success + totalFail;
  const failRate = sample > 0 ? totalFail / sample : 0;
  const apiShare = totalFail > 0 ? apiFail / totalFail : 0;

  // Recovery notice: once healthy again after an alert, tell ops it cleared.
  if (sample >= MIN_SAMPLE && failRate < WARN_RATE && lastAlertAt > 0) {
    lastAlertAt = 0;
    await sendOpsAlert({
      title: "BBPS rail recovered — failure rate back to normal",
      severity: "info",
      details: { windowMin: WINDOW_MIN, sample, failRatePct: Math.round(failRate * 100) },
    }).catch(() => {});
  }

  let alerted = false;
  const cooledDown = Date.now() - lastAlertAt > COOLDOWN_MIN * 60_000;
  if (sample >= MIN_SAMPLE && failRate >= WARN_RATE && cooledDown && !alerting) {
    alerting = true;
    try {
      const topBillers = [...perBiller.entries()]
        .filter(([, s]) => s.fail >= 3)
        .sort((a, b) => b[1].fail - a[1].fail)
        .slice(0, 5)
        .map(([code, s]) => `${code}:${s.fail}/${s.total}`)
        .join(", ");
      const apiDominant = apiShare >= 0.5;
      await sendOpsAlert({
        title: apiDominant
          ? "BBPS pay failures spiking — looks like a Same Day / platform outage"
          : "BBPS pay failures spiking — banks/billers declining upstream",
        severity: failRate >= CRIT_RATE ? "critical" : "warning",
        details: {
          windowMin: WINDOW_MIN,
          sample,
          failRatePct: Math.round(failRate * 100),
          apiSharePct: Math.round(apiShare * 100),
          apiFail,
          billerFail,
          topBillers: topBillers || "n/a",
          hint: apiDominant
            ? "Check Same Day status/float/IP-whitelist and the escalation thread."
            : "Likely specific billers down at the bank's end — usually self-resolves.",
        },
      }).catch(() => {});
      lastAlertAt = Date.now();
      alerted = true;
    } finally {
      alerting = false;
    }
  }

  return {
    sample,
    failRate: Math.round(failRate * 100) / 100,
    apiShare: Math.round(apiShare * 100) / 100,
    alerted,
  };
}
