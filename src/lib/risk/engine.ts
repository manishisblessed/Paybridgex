import type { PayoutMode, ServiceCode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dec, toNumber, type Money } from "@/lib/money";
import { logSecurityEvent } from "@/lib/security/audit";

/**
 * Transaction risk engine — velocity and exposure rules applied BEFORE any
 * money moves. This is the platform's first line of fraud defense:
 *
 *   1. DAILY_AMOUNT_CAP     — rolling-24h rupee volume per user.
 *   2. NIGHT_AMOUNT_CAP     — the daily cap is tightened during 00:00–06:00 IST
 *                             (structuring / account-takeover happens at night).
 *   3. HOURLY_VELOCITY      — rolling-1h count of money movements per user.
 *   4. NEW_BENEFICIARY_CAP  — payouts to a beneficiary first seen within the
 *                             cooling window are amount-capped (mule defense).
 *
 * Design: `evaluateRisk` is a PURE function (unit-testable, no I/O); the
 * `assertTransactionRisk` wrapper gathers the user's live counters from the DB
 * and throws {@link RiskError} on violation. Every block is written to the
 * security audit trail so operators can tune the limits from real data.
 *
 * Limits are env-tunable (RISK_*) with conservative defaults; the whole engine
 * can be disabled with RISK_RULES_ENABLED=false (e.g. in a test environment).
 */

export class RiskError extends Error {
  public statusCode = 403;
  public code = "RISK_LIMIT";
  constructor(public rule: string, message: string) {
    super(message);
    this.name = "RiskError";
  }
}

export type RiskLimits = {
  /** Max rupee volume (amount + fees) a user may move in a rolling 24h. */
  dailyAmountCap: number;
  /** Max count of money movements in a rolling hour. */
  hourlyTxnCap: number;
  /** Fraction of dailyAmountCap allowed during 00:00–06:00 IST (0 < f <= 1). */
  nightFactor: number;
  /** Max single payout to a beneficiary inside the cooling window. */
  newBeneficiaryCap: number;
  /** How long a beneficiary counts as "new" after first being paid (hours). */
  newBeneficiaryCoolingHours: number;
};

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  dailyAmountCap: 500_000,
  hourlyTxnCap: 40,
  nightFactor: 0.5,
  newBeneficiaryCap: 25_000,
  newBeneficiaryCoolingHours: 24,
};

function envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Resolve the active limits (env-tunable, read at call time for testability). */
export function riskLimitsFromEnv(): RiskLimits {
  const factor = Number(process.env.RISK_NIGHT_FACTOR ?? "");
  return {
    dailyAmountCap: envNum("RISK_DAILY_AMOUNT_CAP", DEFAULT_RISK_LIMITS.dailyAmountCap),
    hourlyTxnCap: envNum("RISK_HOURLY_TXN_CAP", DEFAULT_RISK_LIMITS.hourlyTxnCap),
    nightFactor:
      Number.isFinite(factor) && factor > 0 && factor <= 1
        ? factor
        : DEFAULT_RISK_LIMITS.nightFactor,
    newBeneficiaryCap: envNum(
      "RISK_NEW_BENEFICIARY_CAP",
      DEFAULT_RISK_LIMITS.newBeneficiaryCap
    ),
    newBeneficiaryCoolingHours: envNum(
      "RISK_NEW_BENEFICIARY_COOLING_HOURS",
      DEFAULT_RISK_LIMITS.newBeneficiaryCoolingHours
    ),
  };
}

export function riskRulesEnabled(): boolean {
  return process.env.RISK_RULES_ENABLED !== "false";
}

export type RiskInput = {
  /** Rupee value of the attempted movement (amount + fees). */
  amount: number;
  service: string;
  now: Date;
  /** Rupee volume already committed in the trailing 24h (successful + in-flight). */
  amount24h: number;
  /** Count of money movements in the trailing hour. */
  txnCount1h: number;
  /** Count of money movements in the trailing 24h (only needed when a per-user count cap is set). */
  txnCount24h?: number;
  /** Payouts only: beneficiary first seen inside the cooling window. */
  isNewBeneficiary?: boolean;
  limits: RiskLimits;
  /** Admin-assigned per-user overrides (UserLimit row). */
  userOverrides?: {
    dailyTxnAmountCap?: number | null;
    dailyTxnCountCap?: number | null;
  };
};

export type RiskViolation = { rule: string; message: string };

/** True when `now` falls in the 00:00–05:59 IST window. */
export function isNightWindowIST(now: Date): boolean {
  const istHour = new Date(now.getTime() + 5.5 * 3_600_000).getUTCHours();
  return istHour < 6;
}

/**
 * Pure rule evaluation — returns every violated rule (empty array = allowed).
 * No I/O; all counters are supplied by the caller.
 */
export function evaluateRisk(input: RiskInput): RiskViolation[] {
  const violations: RiskViolation[] = [];
  const night = isNightWindowIST(input.now);
  // Per-user cap (admin-assigned) overrides the platform default; the night
  // factor still applies on top of whichever cap is active.
  const baseDailyCap =
    input.userOverrides?.dailyTxnAmountCap != null && input.userOverrides.dailyTxnAmountCap > 0
      ? input.userOverrides.dailyTxnAmountCap
      : input.limits.dailyAmountCap;
  const effectiveDailyCap = night ? baseDailyCap * input.limits.nightFactor : baseDailyCap;

  const countCap = input.userOverrides?.dailyTxnCountCap;
  if (countCap != null && countCap > 0 && (input.txnCount24h ?? 0) + 1 > countCap) {
    violations.push({
      rule: "USER_DAILY_COUNT_CAP",
      message: `Daily transaction count limit reached (${countCap} per 24 hours for this account). Please retry tomorrow or contact support.`,
    });
  }

  if (input.amount24h + input.amount > effectiveDailyCap) {
    violations.push({
      rule: night ? "NIGHT_AMOUNT_CAP" : "DAILY_AMOUNT_CAP",
      message: night
        ? `Night-hour limit reached: transactions between 12 AM and 6 AM are capped at ₹${effectiveDailyCap.toLocaleString("en-IN")} per 24 hours. Please retry after 6 AM.`
        : `Daily limit reached: you can move up to ₹${effectiveDailyCap.toLocaleString("en-IN")} per 24 hours. Please retry later or contact support to raise your limit.`,
    });
  }

  if (input.txnCount1h + 1 > input.limits.hourlyTxnCap) {
    violations.push({
      rule: "HOURLY_VELOCITY",
      message: `Too many transactions in the last hour (limit ${input.limits.hourlyTxnCap}). Please wait a while before trying again.`,
    });
  }

  if (input.isNewBeneficiary && input.amount > input.limits.newBeneficiaryCap) {
    violations.push({
      rule: "NEW_BENEFICIARY_CAP",
      message: `First payouts to a new beneficiary are capped at ₹${input.limits.newBeneficiaryCap.toLocaleString("en-IN")} for ${input.limits.newBeneficiaryCoolingHours} hours. Send a smaller amount or retry after the cooling period.`,
    });
  }

  return violations;
}

/** Payout states that count toward exposure (money reserved or settled). */
const EXPOSED_PAYOUT_STATUSES = [
  "PENDING_APPROVAL",
  "APPROVED",
  "PROCESSING",
  "SUCCESS",
] as const;

export type AssertRiskOptions = {
  userId: string;
  service: ServiceCode | "PAYOUT";
  /** Rupee value being moved (amount + fees). */
  amount: Money | number | string;
  /** Payouts only — enables the new-beneficiary rule. */
  beneficiary?: { accountLast4: string; mode: PayoutMode };
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Gather the user's live counters and enforce the risk rules. Throws
 * {@link RiskError} (403, code RISK_LIMIT) with an operator-tunable,
 * user-safe message when a rule is violated. No-op when disabled via env.
 */
export async function assertTransactionRisk(opts: AssertRiskOptions): Promise<void> {
  if (!riskRulesEnabled()) return;

  const limits = riskLimitsFromEnv();
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 3_600_000);
  const since1h = new Date(now.getTime() - 3_600_000);

  const [txnAgg, txnCount1h, payoutAgg, payoutCount1h, userLimit, txnCount24h, payoutCount24h] =
    await Promise.all([
      prisma.transaction.aggregate({
        where: {
          userId: opts.userId,
          createdAt: { gte: since24h },
          status: { in: ["INITIATED", "PROCESSING", "SUCCESS"] },
          // Exclude synthetic acquirer-settlement anchors (POS/PG/QR): those are
          // INBOUND settlement volume, not user-initiated outbound movement.
          isSettlement: false,
        },
        _sum: { amount: true, fee: true },
      }),
      prisma.transaction.count({
        where: { userId: opts.userId, createdAt: { gte: since1h }, isSettlement: false },
      }),
      prisma.payoutRequest.aggregate({
        where: {
          userId: opts.userId,
          createdAt: { gte: since24h },
          status: { in: [...EXPOSED_PAYOUT_STATUSES] },
        },
        _sum: { totalDebit: true },
      }),
      prisma.payoutRequest.count({
        where: { userId: opts.userId, createdAt: { gte: since1h } },
      }),
      prisma.userLimit.findUnique({
        where: { userId: opts.userId },
        select: { dailyTxnAmountCap: true, dailyTxnCountCap: true },
      }),
      prisma.transaction.count({
        where: { userId: opts.userId, createdAt: { gte: since24h }, isSettlement: false },
      }),
      prisma.payoutRequest.count({
        where: { userId: opts.userId, createdAt: { gte: since24h } },
      }),
    ]);

  const amount24h =
    toNumber(dec(txnAgg._sum.amount ?? 0)) +
    toNumber(dec(txnAgg._sum.fee ?? 0)) +
    toNumber(dec(payoutAgg._sum.totalDebit ?? 0));

  let isNewBeneficiary: boolean | undefined;
  if (opts.beneficiary) {
    const earliest = await prisma.payoutRequest.findFirst({
      where: {
        userId: opts.userId,
        accountLast4: opts.beneficiary.accountLast4,
        mode: opts.beneficiary.mode,
        status: { in: [...EXPOSED_PAYOUT_STATUSES] },
      },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    const coolingMs = limits.newBeneficiaryCoolingHours * 3_600_000;
    isNewBeneficiary =
      !earliest || now.getTime() - earliest.createdAt.getTime() < coolingMs;
  }

  const violations = evaluateRisk({
    amount: toNumber(dec(opts.amount)),
    service: opts.service,
    now,
    amount24h,
    txnCount1h: txnCount1h + payoutCount1h,
    txnCount24h: txnCount24h + payoutCount24h,
    isNewBeneficiary,
    limits,
    userOverrides: userLimit
      ? {
          dailyTxnAmountCap: userLimit.dailyTxnAmountCap
            ? toNumber(dec(userLimit.dailyTxnAmountCap))
            : null,
          dailyTxnCountCap: userLimit.dailyTxnCountCap,
        }
      : undefined,
  });

  if (violations.length === 0) return;

  await logSecurityEvent({
    action: "risk.blocked",
    severity: "warn",
    userId: opts.userId,
    entity: "Transaction",
    ip: opts.ip,
    userAgent: opts.userAgent,
    meta: {
      service: opts.service,
      amount: toNumber(dec(opts.amount)),
      amount24h,
      txnCount1h: txnCount1h + payoutCount1h,
      rules: violations.map((v) => v.rule),
    },
  });

  const first = violations[0];
  throw new RiskError(first.rule, first.message);
}
