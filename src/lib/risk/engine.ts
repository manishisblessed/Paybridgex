import type { PayoutMode, ServiceCode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dec, toNumber, type Money } from "@/lib/money";
import { logSecurityEvent } from "@/lib/security/audit";
import { resolveEffectiveLimits } from "./limits";

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
  /** Rupee volume already committed in the trailing 24h for THIS service only. */
  serviceAmount24h?: number;
  /**
   * Per-service rolling-24h ceiling (₹) for {@link RiskInput.service}. Comes
   * from the user's resolved tier. `undefined`/`null` = no per-service cap;
   * `0` = the rail is disabled for this tier.
   */
  serviceCap?: number | null;
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

  // Per-service (per-rail) cap from the user's tier. `0` disables the rail; any
  // positive cap is a rolling-24h ceiling for that service alone, tightened by
  // the night factor like the overall cap.
  if (input.serviceCap != null) {
    if (input.serviceCap === 0) {
      violations.push({
        rule: "SERVICE_DISABLED",
        message:
          "This service isn't enabled for your account tier. Please contact support to upgrade your limits.",
      });
    } else {
      const effectiveServiceCap = night
        ? input.serviceCap * input.limits.nightFactor
        : input.serviceCap;
      if ((input.serviceAmount24h ?? 0) + input.amount > effectiveServiceCap) {
        violations.push({
          rule: night ? "NIGHT_SERVICE_CAP" : "SERVICE_DAILY_CAP",
          message: night
            ? `Night-hour limit reached for this service: capped at ₹${effectiveServiceCap.toLocaleString("en-IN")} per 24 hours between 12 AM and 6 AM. Please retry after 6 AM.`
            : `Daily limit reached for this service: you can move up to ₹${effectiveServiceCap.toLocaleString("en-IN")} per 24 hours on this service. Please retry later or contact support to raise your limit.`,
        });
      }
    }
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

  const envLimits = riskLimitsFromEnv();
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 3_600_000);
  const since1h = new Date(now.getTime() - 3_600_000);

  // Resolve the user's effective tier ceilings (override > pin > KYC/role
  // policy > default tier > env defaults). Drives both the overall cap and the
  // per-service matrix.
  const effective = await resolveEffectiveLimits(opts.userId);
  const serviceCap = effective.serviceCaps[opts.service];

  const [txnAgg, txnCount1h, payoutAgg, payoutCount1h, txnCount24h, payoutCount24h, serviceTxnAgg] =
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
      prisma.transaction.count({
        where: { userId: opts.userId, createdAt: { gte: since24h }, isSettlement: false },
      }),
      prisma.payoutRequest.count({
        where: { userId: opts.userId, createdAt: { gte: since24h } },
      }),
      // Per-service 24h volume — only queried when the tier caps this service
      // (and never for PAYOUT, whose exposure comes from payoutAgg below).
      serviceCap != null && opts.service !== "PAYOUT"
        ? prisma.transaction.aggregate({
            where: {
              userId: opts.userId,
              createdAt: { gte: since24h },
              status: { in: ["INITIATED", "PROCESSING", "SUCCESS"] },
              isSettlement: false,
              service: opts.service as ServiceCode,
            },
            _sum: { amount: true, fee: true },
          })
        : Promise.resolve(null),
    ]);

  const amount24h =
    toNumber(dec(txnAgg._sum.amount ?? 0)) +
    toNumber(dec(txnAgg._sum.fee ?? 0)) +
    toNumber(dec(payoutAgg._sum.totalDebit ?? 0));

  // Rolling-24h volume for the specific service being attempted.
  const serviceAmount24h =
    serviceCap == null
      ? 0
      : opts.service === "PAYOUT"
        ? toNumber(dec(payoutAgg._sum.totalDebit ?? 0))
        : toNumber(dec(serviceTxnAgg?._sum.amount ?? 0)) +
          toNumber(dec(serviceTxnAgg?._sum.fee ?? 0));

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
    const coolingMs = envLimits.newBeneficiaryCoolingHours * 3_600_000;
    isNewBeneficiary =
      !earliest || now.getTime() - earliest.createdAt.getTime() < coolingMs;
  }

  const violations = evaluateRisk({
    amount: toNumber(dec(opts.amount)),
    service: opts.service,
    now,
    amount24h,
    serviceAmount24h,
    serviceCap,
    txnCount1h: txnCount1h + payoutCount1h,
    txnCount24h: txnCount24h + payoutCount24h,
    isNewBeneficiary,
    // The tier-resolved overall cap + night factor; velocity/new-beneficiary
    // rules stay env-driven. The overall cap already folds in any UserLimit
    // override, so no separate dailyTxnAmountCap override is passed here.
    limits: {
      dailyAmountCap: effective.dailyAmountCap,
      hourlyTxnCap: envLimits.hourlyTxnCap,
      nightFactor: effective.nightFactor,
      newBeneficiaryCap: envLimits.newBeneficiaryCap,
      newBeneficiaryCoolingHours: envLimits.newBeneficiaryCoolingHours,
    },
    userOverrides:
      effective.dailyCountCap != null
        ? { dailyTxnCountCap: effective.dailyCountCap }
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
      serviceAmount24h,
      serviceCap: serviceCap ?? null,
      tier: effective.profileKey,
      dailyAmountCap: effective.dailyAmountCap,
      txnCount1h: txnCount1h + payoutCount1h,
      rules: violations.map((v) => v.rule),
    },
  });

  const first = violations[0];
  throw new RiskError(first.rule, first.message);
}
