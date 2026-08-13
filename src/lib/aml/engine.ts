import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toNumber, dec } from "@/lib/money";
import { logger } from "@/lib/logger";
import { sendOpsAlert } from "@/lib/monitoring/alerts";

/**
 * AML transaction-monitoring engine (Phase 5 — compliance maturity).
 *
 * Complements the PRE-transaction risk engine (src/lib/risk/engine.ts, which
 * blocks) with POST-transaction pattern surveillance (which files alerts for
 * human review — AML review is a compliance decision, never an auto-block).
 *
 * Rules (thresholds env-tunable, PMLA-informed defaults):
 *   HIGH_VALUE       — a single movement ≥ ₹10L (CTR candidate)
 *   AGG_DAILY_VOLUME — aggregate daily volume ≥ ₹10L (CTR candidate)
 *   STRUCTURING      — ≥3 movements each just below the ₹50k reporting line
 *                      (classic smurfing: 49,500 + 49,900 + 49,000 …)
 *   DORMANT_BURST    — an account inactive ≥30 days suddenly moves ≥ ₹2L/day
 *
 * The hourly sweep aggregates the current IST day and upserts one AmlAlert
 * per (user, rule, day) — idempotent by unique key, so re-runs only refresh
 * the evidence. Reports: the CTR/STR CSV exports live in
 * src/app/api/admin/aml/reports.
 */

export type AmlLimits = {
  /** Single-movement / daily-aggregate CTR threshold (₹). */
  ctrThreshold: number;
  /** The reporting line structuring tries to stay under (₹). */
  structuringLine: number;
  /** Movements within this fraction below the line count as "just below". */
  structuringMargin: number;
  /** How many just-below movements in a day trigger the alert. */
  structuringMinCount: number;
  /** Days without activity for an account to count as dormant. */
  dormantDays: number;
  /** Daily volume that makes a dormant account's burst suspicious (₹). */
  dormantBurstAmount: number;
};

export const DEFAULT_AML_LIMITS: AmlLimits = {
  ctrThreshold: 1_000_000,
  structuringLine: 50_000,
  structuringMargin: 0.1,
  structuringMinCount: 3,
  dormantDays: 30,
  dormantBurstAmount: 200_000,
};

function envNum(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function amlLimitsFromEnv(): AmlLimits {
  const margin = Number(process.env.AML_STRUCTURING_MARGIN ?? "");
  return {
    ctrThreshold: envNum("AML_CTR_THRESHOLD", DEFAULT_AML_LIMITS.ctrThreshold),
    structuringLine: envNum("AML_STRUCTURING_LINE", DEFAULT_AML_LIMITS.structuringLine),
    structuringMargin:
      Number.isFinite(margin) && margin > 0 && margin < 1 ? margin : DEFAULT_AML_LIMITS.structuringMargin,
    structuringMinCount: envNum("AML_STRUCTURING_MIN_COUNT", DEFAULT_AML_LIMITS.structuringMinCount),
    dormantDays: envNum("AML_DORMANT_DAYS", DEFAULT_AML_LIMITS.dormantDays),
    dormantBurstAmount: envNum("AML_DORMANT_BURST_AMOUNT", DEFAULT_AML_LIMITS.dormantBurstAmount),
  };
}

export function amlEnabled(): boolean {
  return process.env.AML_ENABLED !== "false";
}

/** A settled/in-flight money movement inside the monitored day. */
export type AmlMovement = {
  /** Rupee value moved. */
  amount: number;
  /** Human-readable reference (txn refId / payout id). */
  ref: string;
  /** TXN | PAYOUT — for the evidence trail. */
  kind: "TXN" | "PAYOUT";
};

export type AmlFinding = {
  rule: "HIGH_VALUE" | "AGG_DAILY_VOLUME" | "STRUCTURING" | "DORMANT_BURST";
  severity: "HIGH" | "MEDIUM";
  details: Record<string, unknown>;
};

/**
 * Pure per-user rule evaluation over one day's movements. No I/O — the sweep
 * supplies the aggregates, tests supply fixtures.
 */
export function evaluateAmlPatterns(input: {
  movements: AmlMovement[];
  /** True when the user had no movement in the trailing dormantDays before today. */
  wasDormant: boolean;
  limits: AmlLimits;
}): AmlFinding[] {
  const { movements, wasDormant, limits } = input;
  const findings: AmlFinding[] = [];
  if (movements.length === 0) return findings;

  const total = movements.reduce((s, m) => s + m.amount, 0);

  const highValue = movements.filter((m) => m.amount >= limits.ctrThreshold);
  if (highValue.length > 0) {
    findings.push({
      rule: "HIGH_VALUE",
      severity: "HIGH",
      details: {
        threshold: limits.ctrThreshold,
        movements: highValue.map((m) => ({ ref: m.ref, kind: m.kind, amount: m.amount })).slice(0, 20),
      },
    });
  }

  if (total >= limits.ctrThreshold) {
    findings.push({
      rule: "AGG_DAILY_VOLUME",
      severity: "HIGH",
      details: { threshold: limits.ctrThreshold, dailyTotal: total, movementCount: movements.length },
    });
  }

  const lowerBound = limits.structuringLine * (1 - limits.structuringMargin);
  const justBelow = movements.filter((m) => m.amount >= lowerBound && m.amount < limits.structuringLine);
  if (justBelow.length >= limits.structuringMinCount) {
    findings.push({
      rule: "STRUCTURING",
      severity: "HIGH",
      details: {
        line: limits.structuringLine,
        band: [lowerBound, limits.structuringLine],
        count: justBelow.length,
        movements: justBelow.map((m) => ({ ref: m.ref, kind: m.kind, amount: m.amount })).slice(0, 20),
      },
    });
  }

  if (wasDormant && total >= limits.dormantBurstAmount) {
    findings.push({
      rule: "DORMANT_BURST",
      severity: "MEDIUM",
      details: { dormantDays: limits.dormantDays, dailyTotal: total, movementCount: movements.length },
    });
  }

  return findings;
}

/** IST calendar date key (YYYY-MM-DD) for a timestamp. */
export function istDateKey(d: Date): string {
  return new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

/** UTC instant at which the given IST date key begins. */
export function istDayStartUtc(dateKey: string): Date {
  return new Date(new Date(`${dateKey}T00:00:00.000Z`).getTime() - 5.5 * 3_600_000);
}

const MONITORED_TXN_STATUSES = ["SUCCESS"] as const;
const MONITORED_PAYOUT_STATUSES = ["APPROVED", "PROCESSING", "SUCCESS"] as const;

/**
 * Hourly worker job: aggregate the current IST day per user, evaluate the
 * rules, and file/refresh alerts. Idempotent via the (userId, rule, dateKey)
 * unique key — repeat runs refresh evidence, never duplicate.
 */
export async function runAmlSweep(now = new Date()): Promise<{ scannedUsers: number; newAlerts: number }> {
  if (!amlEnabled()) return { scannedUsers: 0, newAlerts: 0 };

  const limits = amlLimitsFromEnv();
  const dateKey = istDateKey(now);
  const dayStart = istDayStartUtc(dateKey);

  const [txns, payouts] = await Promise.all([
    prisma.transaction.findMany({
      // Exclude synthetic acquirer-settlement anchors (POS/PG/QR): those are
      // INBOUND settlement volume, not the retailer moving their own money, so
      // they must not inflate structuring / CTR / dormant-burst aggregates. The
      // dormancy prior-activity check below stays inclusive (settlement activity
      // correctly marks an account as non-dormant).
      where: { createdAt: { gte: dayStart }, status: { in: [...MONITORED_TXN_STATUSES] }, isSettlement: false },
      select: { userId: true, amount: true, fee: true, refId: true },
    }),
    prisma.payoutRequest.findMany({
      where: { createdAt: { gte: dayStart }, status: { in: [...MONITORED_PAYOUT_STATUSES] } },
      select: { userId: true, totalDebit: true, id: true },
    }),
  ]);

  const byUser = new Map<string, AmlMovement[]>();
  for (const t of txns) {
    const list = byUser.get(t.userId) ?? [];
    list.push({ amount: toNumber(dec(t.amount)) + toNumber(dec(t.fee)), ref: t.refId, kind: "TXN" });
    byUser.set(t.userId, list);
  }
  for (const p of payouts) {
    const list = byUser.get(p.userId) ?? [];
    list.push({ amount: toNumber(dec(p.totalDebit)), ref: p.id, kind: "PAYOUT" });
    byUser.set(p.userId, list);
  }

  let newAlerts = 0;
  for (const [userId, movements] of byUser) {
    // Dormancy: any movement in the `dormantDays` window before today?
    let wasDormant = false;
    const total = movements.reduce((s, m) => s + m.amount, 0);
    if (total >= limits.dormantBurstAmount) {
      const dormantSince = new Date(dayStart.getTime() - limits.dormantDays * 86_400_000);
      const [priorTxn, priorPayout] = await Promise.all([
        prisma.transaction.findFirst({
          where: { userId, createdAt: { gte: dormantSince, lt: dayStart } },
          select: { id: true },
        }),
        prisma.payoutRequest.findFirst({
          where: { userId, createdAt: { gte: dormantSince, lt: dayStart } },
          select: { id: true },
        }),
      ]);
      wasDormant = !priorTxn && !priorPayout;
    }

    const findings = evaluateAmlPatterns({ movements, wasDormant, limits });
    for (const f of findings) {
      const existing = await prisma.amlAlert.findUnique({
        where: { userId_rule_dateKey: { userId, rule: f.rule, dateKey } },
        select: { id: true },
      });
      if (existing) {
        // Refresh the evidence; review fields are never touched.
        await prisma.amlAlert.update({
          where: { id: existing.id },
          data: { details: f.details as Prisma.InputJsonValue, severity: f.severity },
        });
        continue;
      }
      const created = await prisma.amlAlert.create({
        data: {
          userId,
          rule: f.rule,
          severity: f.severity,
          dateKey,
          details: f.details as Prisma.InputJsonValue,
        },
      });
      newAlerts += 1;
      await prisma.auditLog.create({
        data: {
          userId,
          action: "aml.alert_created",
          entity: "AmlAlert",
          entityId: created.id,
          meta: { rule: f.rule, severity: f.severity, dateKey },
        },
      });
    }
  }

  if (newAlerts > 0) {
    await sendOpsAlert({
      title: `AML sweep filed ${newAlerts} new alert(s)`,
      severity: "warning",
      details: { dateKey, newAlerts, scannedUsers: byUser.size },
    });
  }

  logger.info({ action: "aml.sweep_done", dateKey, scannedUsers: byUser.size, newAlerts });
  return { scannedUsers: byUser.size, newAlerts };
}
