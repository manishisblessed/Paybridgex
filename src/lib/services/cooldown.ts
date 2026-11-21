import type { ServiceCode } from "@prisma/client";
import { prisma } from "../db";
import { logger } from "../logger";

/**
 * Cooldown window for repeat payments on the SAME bank + SAME card.
 * Env-tunable; defaults to 61 seconds (business rule: 61 full seconds must
 * elapse before the same user can pay the same bank's same credit card again).
 */
export const CC_COOLDOWN_SEC = Number(process.env.BBPS_DUP_GUARD_COOLDOWN_SEC ?? 61);

const NON_FAILED_STATUSES = ["PROCESSING", "NEEDS_REVIEW", "SUCCESS"] as const;

export type CooldownInput = {
  userId: string;
  service: ServiceCode;
  /** billerCode (Same Day) or billerName (Chagans) — stored as Transaction.operator */
  operator: string;
  /** Card last 4 digits — stored as Transaction.customer */
  customer: string;
  /** Partner rail for cross-rail isolation (e.g. "SAMEDAY_PAY2NEW") */
  partner?: string;
  /** Override the default cooldown window (seconds) */
  cooldownSec?: number;
};

export type CooldownResult = {
  blocked: boolean;
  retryAfterSec: number;
  retryAfterMs: number;
  /** ISO 8601 timestamp when cooldown expires; null when not blocked */
  cooldownExpiry: string | null;
  /** The blocking transaction's refId; null when not blocked */
  recentRefId: string | null;
};

const ALLOWED: CooldownResult = {
  blocked: false,
  retryAfterSec: 0,
  retryAfterMs: 0,
  cooldownExpiry: null,
  recentRefId: null,
};

async function queryRecentTransaction(
  input: CooldownInput,
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
) {
  const cooldownSec = input.cooldownSec ?? CC_COOLDOWN_SEC;
  const since = new Date(Date.now() - cooldownSec * 1000);
  const db = tx ?? prisma;

  const where: Record<string, unknown> = {
    userId: input.userId,
    service: input.service,
    operator: input.operator,
    customer: input.customer,
    status: { in: [...NON_FAILED_STATUSES] },
    createdAt: { gte: since },
  };
  if (input.partner) where.partner = input.partner;

  return db.transaction.findFirst({
    where,
    orderBy: { createdAt: "desc" as const },
    select: { refId: true, createdAt: true },
  });
}

function buildResult(recent: { refId: string; createdAt: Date }, cooldownSec: number): CooldownResult {
  const elapsedMs = Date.now() - recent.createdAt.getTime();
  const remainingMs = Math.max(0, cooldownSec * 1000 - elapsedMs);
  const remainingSec = Math.ceil(remainingMs / 1000);
  const expiry = new Date(recent.createdAt.getTime() + cooldownSec * 1000);

  return {
    blocked: true,
    retryAfterSec: remainingSec,
    retryAfterMs: remainingMs,
    cooldownExpiry: expiry.toISOString(),
    recentRefId: recent.refId,
  };
}

/**
 * Read-only cooldown check. Use for pre-flight UI queries (check-cooldown API).
 * Does NOT acquire a lock — not safe against concurrent payment submissions.
 */
export async function checkCooldown(input: CooldownInput): Promise<CooldownResult> {
  const cooldownSec = input.cooldownSec ?? CC_COOLDOWN_SEC;
  const recent = await queryRecentTransaction(input);

  if (!recent) {
    logger.debug({ action: "cooldown.passed", userId: input.userId, operator: input.operator, customer: input.customer }, "CC cooldown passed");
    return ALLOWED;
  }

  const result = buildResult(recent, cooldownSec);
  logger.info(
    { action: "cooldown.blocked", userId: input.userId, operator: input.operator, customer: input.customer, retryAfterSec: result.retryAfterSec, recentRefId: result.recentRefId },
    "CC cooldown active",
  );
  return result;
}

/**
 * Atomic cooldown enforcement for pay endpoints. Locks the User row with
 * SELECT … FOR UPDATE (same pattern as ledger.ts lockUser) to serialize
 * concurrent payment attempts by the same user. The lock is released when
 * the short transaction commits — well before the partner call.
 */
export async function enforceCooldownAtomic(input: CooldownInput): Promise<CooldownResult> {
  const cooldownSec = input.cooldownSec ?? CC_COOLDOWN_SEC;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`;

    const recent = await queryRecentTransaction(input, tx);

    if (!recent) {
      logger.debug({ action: "cooldown.passed_atomic", userId: input.userId, operator: input.operator, customer: input.customer }, "CC cooldown passed (atomic)");
      return ALLOWED;
    }

    const result = buildResult(recent, cooldownSec);
    logger.info(
      { action: "cooldown.blocked_atomic", userId: input.userId, operator: input.operator, customer: input.customer, retryAfterSec: result.retryAfterSec, recentRefId: result.recentRefId },
      "CC cooldown blocked (atomic)",
    );
    return result;
  });
}
