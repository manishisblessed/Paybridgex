import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dec, toNumber } from "@/lib/money";
import { getSetting } from "@/lib/settings";
import { DEFAULT_RISK_LIMITS, riskLimitsFromEnv } from "./engine";

/**
 * Effective-limits resolver — turns a user's KYC state, role, assigned tier
 * ({@link LimitProfile}) and per-user overrides ({@link UserLimit}) into the
 * concrete ceilings the risk engine enforces.
 *
 * Precedence (highest first):
 *   1. UserLimit override        — admin-set absolute cap for this one user.
 *   2. User.limitProfile (pin)   — admin pinned this user to a specific tier.
 *   3. tier from limits.tier_policy — auto-derived from KYC status (+ role).
 *   4. isDefault LimitProfile    — the platform fallback tier.
 *   5. risk-engine defaults      — env-tunable RISK_* (no tier at all).
 *
 * Per-service caps come only from the resolved tier's `serviceCaps` matrix; the
 * overall cap can additionally be tightened by a UserLimit override.
 */

/** Per-service rolling-24h ceilings (₹), keyed by ServiceCode or "PAYOUT". */
export type ServiceCapMap = Record<string, number>;

export type EffectiveLimits = {
  /** Overall rolling-24h ceiling across all rails (₹). */
  dailyAmountCap: number;
  /** Overall rolling-24h movement count, or null when uncapped. */
  dailyCountCap: number | null;
  /** Night-window factor (0 < f <= 1) applied 00:00–06:00 IST. */
  nightFactor: number;
  /** Per-service ceilings (₹). Absent service = only the overall cap applies. */
  serviceCaps: ServiceCapMap;
  /** Resolved tier key (null when only platform defaults apply). For UI/audit. */
  profileKey: string | null;
};

/** Parse a stored serviceCaps JSON blob into a clean, validated number map. */
export function parseServiceCaps(raw: unknown): ServiceCapMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ServiceCapMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    // Accept only real numbers or non-empty numeric strings — never coerce
    // null / booleans / "" (Number(null) === 0 would silently disable a rail).
    const n =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim() !== ""
          ? Number(value)
          : NaN;
    if (Number.isFinite(n) && n >= 0) out[key] = n;
  }
  return out;
}

type ProfileRow = {
  key: string;
  dailyAmountCap: Prisma.Decimal | null;
  dailyCountCap: number | null;
  nightFactor: number | null;
  serviceCaps: Prisma.JsonValue;
};

/**
 * Resolve the tier that applies to a user. Returns null when neither a pin, a
 * policy match, nor an isDefault tier exists (caller then uses platform
 * defaults).
 */
async function resolveProfile(input: {
  pinnedProfileId: string | null;
  kycApproved: boolean;
  role: string;
}): Promise<ProfileRow | null> {
  const select = {
    key: true,
    dailyAmountCap: true,
    dailyCountCap: true,
    nightFactor: true,
    serviceCaps: true,
  } as const;

  // 2. Explicit pin wins (even if inactive — an admin chose it deliberately).
  if (input.pinnedProfileId) {
    const pinned = await prisma.limitProfile.findUnique({
      where: { id: input.pinnedProfileId },
      select,
    });
    if (pinned) return pinned;
  }

  // 3. Derive the tier key from the KYC/role policy.
  const policy = await getSetting("limits.tier_policy");
  const wantKey = input.kycApproved
    ? policy.roleOverrides[input.role] ?? policy.kycApprovedProfile
    : policy.kycPendingProfile;

  const byKey = await prisma.limitProfile.findFirst({
    where: { key: wantKey, active: true },
    select,
  });
  if (byKey) return byKey;

  // 4. Fall back to whichever tier is marked default.
  const fallback = await prisma.limitProfile.findFirst({
    where: { isDefault: true, active: true },
    select,
  });
  return fallback;
}

/**
 * Compute the effective ceilings for a user. One-shot DB reads; safe to call on
 * the transaction hot path (the caller already awaits several counters).
 */
export async function resolveEffectiveLimits(userId: string): Promise<EffectiveLimits> {
  const envLimits = riskLimitsFromEnv();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      limitProfileId: true,
      kyc: { select: { status: true } },
      userLimit: { select: { dailyTxnAmountCap: true, dailyTxnCountCap: true } },
    },
  });

  const profile = user
    ? await resolveProfile({
        pinnedProfileId: user.limitProfileId,
        kycApproved: user.kyc?.status === "APPROVED",
        role: user.role,
      })
    : null;

  // Overall cap: UserLimit override > tier cap > env default.
  const overrideAmount =
    user?.userLimit?.dailyTxnAmountCap != null
      ? toNumber(dec(user.userLimit.dailyTxnAmountCap))
      : null;
  const tierAmount =
    profile?.dailyAmountCap != null ? toNumber(dec(profile.dailyAmountCap)) : null;
  const dailyAmountCap =
    overrideAmount && overrideAmount > 0
      ? overrideAmount
      : tierAmount && tierAmount > 0
        ? tierAmount
        : envLimits.dailyAmountCap;

  // Count cap: UserLimit override > tier cap > none.
  const dailyCountCap =
    user?.userLimit?.dailyTxnCountCap ?? profile?.dailyCountCap ?? null;

  const nightFactor =
    profile?.nightFactor != null && profile.nightFactor > 0 && profile.nightFactor <= 1
      ? profile.nightFactor
      : envLimits.nightFactor;

  return {
    dailyAmountCap,
    dailyCountCap,
    nightFactor,
    serviceCaps: profile ? parseServiceCaps(profile.serviceCaps) : {},
    profileKey: profile?.key ?? null,
  };
}
