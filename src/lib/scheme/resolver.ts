import type { Prisma, RateType, ServiceCode, SchemeSlab } from "@prisma/client";
import { prisma } from "../db";
import { add, dec, gt, gte, lte, mul, round, sub, type Money } from "../money";

/**
 * Scheme resolver — the single source of truth for "what does this user pay
 * (charge) and earn (commission) for a given service + amount?".
 *
 * Flat model (admin-assigned): the user's explicitly-assigned Scheme
 * (User.schemeId, active) resolves directly. There is no hierarchy, no chain
 * walk, and no derived schemes. Admin assigns a scheme to any user; the
 * commission defined in that scheme is exactly what the user earns.
 *
 * Commissions are only distributed for PG/POS/QR transactions — service
 * transactions (BBPS, Payout, AePS, DMT, etc.) do not earn commission.
 *
 * Provider dimension: a slab may target a specific partner route (e.g.
 * "BBPS_1" vs "BBPS_2"). When the caller passes the provider handling the
 * transaction, an exact provider slab beats the null (any-provider) slab for
 * the same band.
 *
 * All money math goes through money.ts Decimal helpers — never JS floats.
 */

export type ResolvedRateSource = "USER_SCHEME" | "NONE";

export type EffectiveRate = {
  source: ResolvedRateSource;
  schemeId: string | null;
  schemeName: string | null;
  slabId: string | null;
  /** Absolute customer-facing charge (₹) for `amount`. Zero when no slab. */
  charge: Money;
  chargeType: RateType | null;
  /** true = charge already includes 18% GST; false = GST should be added. */
  chargeGstInclusive: boolean;
  /** Absolute commission (₹) the user earns on this transaction. */
  commission: Money;
  /**
   * Absolute vendor/upstream cost (₹) the company pays the partner for this txn,
   * locked from the provider's service rate card (BBPS/Payout). Zero when the
   * slab's provider has no rate card.
   */
  vendorCharge: Money;
  /** Company revenue (₹) per txn = charge − vendorCharge (never negative). */
  revenue: Money;
};

/** Map a payout mode to the ServiceCode used for scheme charge lookups. */
export const PAYOUT_MODE_SERVICE: Record<string, ServiceCode> = {
  IMPS: "PAYOUT",
  NEFT: "PAYOUT",
  RTGS: "PAYOUT",
  UPI: "PAYOUT",
};

/** Turn a FLAT/PERCENT slab value into an absolute rupee amount for `amount`. */
export function applyRate(
  amount: Money | string | number,
  type: RateType,
  value: Prisma.Decimal | string | number
): Money {
  if (type === "FLAT") return round(value);
  return round(mul(amount, value));
}

function emptyRate(): EffectiveRate {
  return {
    source: "NONE",
    schemeId: null,
    schemeName: null,
    slabId: null,
    charge: dec(0),
    chargeType: null,
    chargeGstInclusive: false,
    commission: dec(0),
    vendorCharge: dec(0),
    revenue: dec(0),
  };
}

/**
 * Resolve the effective charge + commission for a user's service transaction.
 * ONLY the user's assigned active scheme resolves (no default fallback).
 * Returns a zeroed `NONE` result when the user has no scheme or the scheme has
 * no matching slab — the scheme gate blocks transactions in that state.
 */
export async function getEffectiveRate(
  userId: string,
  service: ServiceCode,
  amount: Money | string | number,
  provider?: string | null
): Promise<EffectiveRate> {
  const amt = round(amount);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { schemeId: true },
  });
  if (!user) return emptyRate();

  if (user.schemeId) {
    const scheme = await prisma.scheme.findFirst({
      where: { id: user.schemeId, active: true },
      select: { id: true, name: true },
    });
    if (scheme) {
      const slab = await findSlab(scheme.id, service, amt, provider);
      if (slab) {
        const charge = applyRate(amt, slab.chargeType, slab.chargeValue);
        const commission = applyRate(amt, slab.commissionType, slab.commissionValue);
        // Vendor cost uses the same rate type as the charge (BBPS/Payout: flat
        // ₹/txn). Revenue is the company margin, floored at zero. Defaults to 0
        // when the slab predates the vendorCharge column (legacy / no rate card).
        const vendorCharge = applyRate(amt, slab.chargeType, slab.vendorCharge ?? 0);
        const revenue = gt(charge, vendorCharge) ? round(sub(charge, vendorCharge)) : dec(0);
        return {
          source: "USER_SCHEME",
          schemeId: scheme.id,
          schemeName: scheme.name,
          slabId: slab.id,
          charge,
          chargeType: slab.chargeType,
          chargeGstInclusive: (slab as any).chargeGstInclusive ?? false,
          commission,
          vendorCharge,
          revenue,
        };
      }
    }
  }

  return emptyRate();
}

/**
 * Normalize a provider identifier to its route "family" so pricing lookups are
 * resilient to the two different vocabularies in play:
 *
 *   - Scheme slabs / ServiceRoute store the SHORT catalog name the admin picks
 *     in Commission Master (e.g. "SAMEDAY", "BULKPE" — see services/catalog.ts).
 *   - Runtime callers pass the partner ADAPTER `.name` handling the txn
 *     (e.g. "SAMEDAY_PAY2NEW", "SAMEDAY_SETTLEMENT", "BULKPE_BBPS").
 *
 * Without collapsing both to a family, a slab pinned to "SAMEDAY" would never
 * match a caller passing "SAMEDAY_PAY2NEW", silently resolving the charge to ₹0.
 * Routed wrappers ("*_ROUTED") aren't a single family, so callers should pass
 * the concrete rail instead.
 */
export function normalizeProviderTag(provider?: string | null): string | null {
  if (!provider) return null;
  const p = provider.trim().toUpperCase();
  if (!p) return null;
  if (p.startsWith("SAMEDAY")) return "SAMEDAY";
  if (p.startsWith("BULKPE")) return "BULKPE";
  if (p.startsWith("RAZORPAY")) return "RAZORPAY";
  if (p.startsWith("PAYSPRINT")) return "PAYSPRINT";
  if (p.startsWith("NPCI")) return "NPCI";
  if (p.startsWith("EKYCHUB")) return "EKYCHUB";
  return p;
}

/**
 * Find the active slab in a scheme whose band contains `amount`. When a
 * provider is given, an exact provider slab (matched by route family) wins over
 * the null (any-provider) slab; a slab pinned to a DIFFERENT family never
 * matches.
 */
async function findSlab(
  schemeId: string,
  service: ServiceCode,
  amount: Money,
  provider?: string | null
): Promise<SchemeSlab | null> {
  const slabs = await prisma.schemeSlab.findMany({
    where: { schemeId, service, active: true },
    orderBy: { minAmount: "asc" },
  });
  const inBand = slabs.filter((s) => gte(amount, s.minAmount) && lte(amount, s.maxAmount));
  const wanted = normalizeProviderTag(provider);
  if (wanted) {
    const exact = inBand.find((s) => normalizeProviderTag(s.provider) === wanted);
    if (exact) return exact;
  }
  return inBand.find((s) => s.provider == null) ?? null;
}

/**
 * Return the maximum allowed transaction amount for a user+service based on
 * their scheme slabs. If the user has no scheme or no slabs for the service,
 * returns null (no limit).
 */
export async function getSchemeLimit(
  userId: string,
  service: ServiceCode
): Promise<Money | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { schemeId: true },
  });
  if (!user?.schemeId) return null;

  const scheme = await prisma.scheme.findFirst({
    where: { id: user.schemeId, active: true },
    select: { id: true },
  });
  if (!scheme) return null;

  const topSlab = await prisma.schemeSlab.findFirst({
    where: { schemeId: scheme.id, service, active: true },
    orderBy: { maxAmount: "desc" },
    select: { maxAmount: true },
  });
  return topSlab ? dec(topSlab.maxAmount) : null;
}

export type SlabRange = { minAmount: Money | string | number; maxAmount: Money | string | number };

/**
 * Validate a candidate [min, max] band against the existing active slabs for a
 * scheme+service+provider. Slabs pinned to different providers may share bands
 * (that is the point of the provider dimension), so only slabs with the SAME
 * provider value (or both null) are compared. Returns an error string if the
 * band is invalid (min > max) or overlaps, otherwise null. `excludeSlabId`
 * lets an edit ignore its own row.
 */
export async function validateNonOverlapping(
  schemeId: string,
  service: ServiceCode,
  range: SlabRange,
  excludeSlabId?: string,
  provider?: string | null
): Promise<string | null> {
  const min = dec(range.minAmount);
  const max = dec(range.maxAmount);
  if (gt(min, max)) return "minAmount must be less than or equal to maxAmount";

  const existing = await prisma.schemeSlab.findMany({
    where: {
      schemeId,
      service,
      provider: provider ?? null,
      active: true,
      ...(excludeSlabId ? { id: { not: excludeSlabId } } : {}),
    },
    select: { id: true, minAmount: true, maxAmount: true },
  });

  // Two closed ranges [a,b] and [c,d] overlap iff a <= d AND c <= b.
  for (const s of existing) {
    if (lte(min, s.maxAmount) && lte(dec(s.minAmount), max)) {
      return `Range ₹${min.toString()}–₹${max.toString()} overlaps an existing slab (₹${dec(
        s.minAmount
      ).toString()}–₹${dec(s.maxAmount).toString()})`;
    }
  }
  return null;
}

/** Combined service charge + GST helper, mirroring the payout breakdown shape. */
export function withGst(charge: Money, gstPercent: number): { gst: Money; total: Money } {
  const gst = round(mul(charge, dec(gstPercent).div(100)));
  return { gst, total: round(add(charge, gst)) };
}
