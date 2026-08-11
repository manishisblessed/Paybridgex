import { nanoid } from "nanoid";
import { prisma } from "../db";

/**
 * Fixed-window rate limiter backed by Postgres so the limit is shared across
 * every PM2 process on the EC2 box (no Redis required to start). The atomic
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` makes the counter race-safe.
 *
 * When traffic grows, swap the storage for Redis/Upstash behind this same API.
 */

export type RateLimitOptions = {
  /** Max requests allowed within the window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
};

export type RateLimitResult = {
  allowed: boolean;
  count: number;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSec: number;
};

export class RateLimitError extends Error {
  public statusCode = 429;
  constructor(public result: RateLimitResult) {
    super("Too many requests");
    this.name = "RateLimitError";
  }
}

/** Sensible presets for common surfaces. */
export const RATE_LIMITS = {
  login: { limit: 5, windowSec: 300 }, // 5 / 5 min per identifier AND per ip
  register: { limit: 5, windowSec: 3600 }, // 5 new accounts / hour per ip
  join: { limit: 5, windowSec: 3600 }, // 5 public join-form submissions / hour per ip
  otp: { limit: 5, windowSec: 600 }, // 5 OTP sends / 10 min per target
  otpIp: { limit: 20, windowSec: 600 }, // 20 OTP sends / 10 min per ip (bot fan-out guard)
  twoFactor: { limit: 10, windowSec: 300 }, // 2FA code submissions / 5 min per ip
  payoutCreate: { limit: 10, windowSec: 60 },
  txnCreate: { limit: 30, windowSec: 60 }, // money-moving service txns per user
  fundRequestCreate: { limit: 10, windowSec: 60 }, // fund-request submissions per user
  reportQuery: { limit: 120, windowSec: 60 }, // report reads/exports per user (sensitive data surface)
  rekyc: { limit: 6, windowSec: 600 }, // re-KYC initiate/verify attempts / 10 min (per user AND per ip)
  kycVideo: { limit: 8, windowSec: 600 }, // liveness video initiate/complete attempts / 10 min (per user AND per ip)
  kycVideoAdminView: { limit: 30, windowSec: 600 }, // admin signed-URL views of liveness videos / 10 min
  sensitiveWrite: { limit: 30, windowSec: 60 }, // admin/config mutations per user
  default: { limit: 60, windowSec: 60 },
} as const satisfies Record<string, RateLimitOptions>;

/**
 * Increment and check a counter for `key`. Returns the decision; never throws.
 */
export async function checkRateLimit(
  key: string,
  opts: RateLimitOptions
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = opts.windowSec * 1000;
  const bucket = Math.floor(now / windowMs);
  const bucketKey = `${key}:${bucket}`;
  const windowStart = new Date(bucket * windowMs);
  const resetAt = new Date((bucket + 1) * windowMs);

  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("id", "key", "count", "windowStart", "expiresAt")
    VALUES (${nanoid()}, ${bucketKey}, 1, ${windowStart}, ${resetAt})
    ON CONFLICT ("key") DO UPDATE SET "count" = "RateLimit"."count" + 1
    RETURNING "count"
  `;

  const count = Number(rows[0]?.count ?? 1);
  const allowed = count <= opts.limit;
  return {
    allowed,
    count,
    limit: opts.limit,
    remaining: Math.max(0, opts.limit - count),
    resetAt,
    retryAfterSec: Math.max(0, Math.ceil((resetAt.getTime() - now) / 1000)),
  };
}

/** Like {@link checkRateLimit} but throws {@link RateLimitError} when exceeded. */
export async function enforceRateLimit(
  key: string,
  opts: RateLimitOptions
): Promise<RateLimitResult> {
  const result = await checkRateLimit(key, opts);
  if (!result.allowed) throw new RateLimitError(result);
  return result;
}

/** Best-effort cleanup of expired counters (call from a cron/worker). */
export async function purgeExpiredRateLimits(): Promise<number> {
  const { count } = await prisma.rateLimit.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
