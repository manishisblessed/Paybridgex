import type { MdrServiceKind, MdrSlab, RateType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dec, gte, lte, mul, round, type Money } from "@/lib/money";
import { canonicalCardLevel } from "@/lib/pos/binLookup";
import { isCardClassificationEnabled } from "@/lib/settings";

/**
 * MDR engine — resolves the merchant discount rate + commission share for
 * acquiring-style rails (POS / PG / QR / UPI). Flat model: ONLY the user's
 * assigned active Scheme resolves — no platform-default fallback. Admin assigns
 * schemes directly to any user; commission values are credited flat (no chain).
 *
 * Slab matching: (serviceKind, amount band) plus the card/acquirer dimensions
 * paymentMode, company, cardType, brandType, classification. A null/"*"
 * dimension on a slab is a wildcard; a slab pinned to a different value never
 * matches. Among eligible slabs the MOST SPECIFIC wins (most exact dimension
 * matches). mdrValue is the T+1 rate; mdrValueT0 (when set) applies to
 * instant/T+0 settlement.
 */

/** Transaction-side dimensions used to pick the best MDR slab. */
export type MdrDimensions = {
  paymentMode?: string | null;
  company?: string | null;
  cardType?: string | null;
  brandType?: string | null;
  classification?: string | null;
  /** T0 = instant settlement (uses mdrValueT0 when set); T1 = standard. */
  settlementType?: "T0" | "T1";
};

export type EffectiveMdr = {
  source: "USER_SCHEME" | "NONE";
  schemeId: string | null;
  schemeName: string | null;
  slabId: string | null;
  /** Absolute MDR (₹) charged for `amount`. Zero when no slab matched. */
  mdr: Money;
  /** Absolute vendor/acquirer cost (₹) the company pays upstream. */
  vendor: Money;
  /** Absolute company revenue margin (₹) = mdr − vendor (never below zero). */
  margin: Money;
  mdrType: RateType | null;
  commission: {
    retailer: Money;
    distributor: Money;
    master: Money;
    superDistributor: Money;
  };
};

function applyRate(amount: Money | string | number, type: RateType, value: Money | string | number): Money {
  if (type === "FLAT") return round(value);
  return round(mul(amount, value)); // PERCENT stored as a fraction (0.0050 = 0.5%)
}

function emptyMdr(): EffectiveMdr {
  return {
    source: "NONE",
    schemeId: null,
    schemeName: null,
    slabId: null,
    mdr: dec(0),
    vendor: dec(0),
    margin: dec(0),
    mdrType: null,
    commission: {
      retailer: dec(0),
      distributor: dec(0),
      master: dec(0),
      superDistributor: dec(0),
    },
  };
}

const norm = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

/**
 * Score a slab against the transaction dimensions. Returns -1 when the slab
 * is ineligible (pinned to a different value), otherwise the number of exact
 * dimension matches (higher = more specific). A null/"*" slab dimension is a
 * wildcard: eligible, but scores 0 for that dimension.
 */
function slabScore(slab: MdrSlab, dims: MdrDimensions, useClassification: boolean): number {
  let score = 0;
  // [slabValue, txnValue, comparator] — classification is matched on its
  // canonical card tier so a slab pinned to "PLATINUM" matches feed/BIN labels
  // like "VISA PLATINUM" or "PLATINUM MASTERCARD". Other dimensions compare
  // exactly (after case/space normalization). When classification is disabled
  // platform-wide, the tier dimension is dropped entirely — pricing resolves on
  // Card Category (cardType) + network + company, and tier-pinned slabs match as
  // if their tier were a wildcard.
  const pairs: Array<[string | null, string | null | undefined, (v: string | null | undefined) => string]> = [
    [slab.paymentMode === "*" ? null : slab.paymentMode, dims.paymentMode === "*" ? null : dims.paymentMode, norm],
    [slab.company, dims.company, norm],
    [slab.cardType, dims.cardType, norm],
    [slab.brandType, dims.brandType, norm],
  ];
  if (useClassification) {
    pairs.push([slab.classification, dims.classification, canonicalCardLevel]);
  }
  for (const [slabVal, txnVal, cmp] of pairs) {
    if (slabVal == null || slabVal === "") continue; // wildcard slab dimension
    if (!txnVal || cmp(slabVal) !== cmp(txnVal)) return -1; // pinned mismatch
    score++;
  }
  return score;
}

/** Pick the most specific eligible slab whose band contains `amount`. */
function pickSlab(slabs: MdrSlab[], amount: Money, dims: MdrDimensions, useClassification: boolean): MdrSlab | null {
  const inBand = slabs.filter((s) => gte(amount, s.minAmount) && lte(amount, s.maxAmount));
  let best: MdrSlab | null = null;
  let bestScore = -1;
  for (const slab of inBand) {
    const score = slabScore(slab, dims, useClassification);
    if (score > bestScore) {
      best = slab;
      bestScore = score;
    }
  }
  return bestScore >= 0 ? best : null;
}

/** Effective MDR value for a slab under a settlement type (T0 falls back to T1). */
function slabMdrValue(slab: MdrSlab, settlementType?: "T0" | "T1") {
  if (settlementType === "T0" && Number(slab.mdrValueT0) > 0) return slab.mdrValueT0;
  return slab.mdrValue;
}

/** Effective vendor/acquirer cost for a slab (T0 falls back to T1). */
function slabVendorValue(slab: MdrSlab, settlementType?: "T0" | "T1") {
  if (settlementType === "T0" && Number(slab.vendorChargeT0) > 0) return slab.vendorChargeT0;
  return slab.vendorCharge;
}

/**
 * Effective per-tier commission for a slab under a settlement type. Instant
 * (T0) settlement uses the dedicated *T0 columns; each falls back to its T+1
 * value when zero/unset — mirroring the MDR/vendor T0 fallback.
 */
function slabCommissionValue(
  slab: MdrSlab,
  tier: "distributor" | "master" | "superDistributor",
  settlementType?: "T0" | "T1"
) {
  const t1 = {
    distributor: slab.commissionDistributor,
    master: slab.commissionMaster,
    superDistributor: slab.commissionSuperDistributor,
  }[tier];
  if (settlementType !== "T0") return t1;
  const t0 = {
    distributor: slab.commissionDistributorT0,
    master: slab.commissionMasterT0,
    superDistributor: slab.commissionSuperDistributorT0,
  }[tier];
  return Number(t0) > 0 ? t0 : t1;
}

async function resolveFromScheme(
  schemeId: string,
  serviceKind: MdrServiceKind,
  dims: MdrDimensions,
  amount: Money,
  useClassification: boolean
): Promise<MdrSlab | null> {
  const slabs = await prisma.mdrSlab.findMany({
    where: { schemeId, serviceKind, active: true },
    orderBy: { minAmount: "asc" },
  });
  return pickSlab(slabs, amount, dims, useClassification);
}

export async function getEffectiveMdr(
  userId: string,
  serviceKind: MdrServiceKind,
  amount: Money | string | number,
  dims: MdrDimensions | string = {}
): Promise<EffectiveMdr> {
  // Back-compat: a plain string argument is the payment mode.
  const d: MdrDimensions = typeof dims === "string" ? { paymentMode: dims } : dims;
  const amt = round(amount);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { schemeId: true },
  });
  if (!user) return emptyMdr();

  const build = (
    slab: MdrSlab,
    schemeId: string,
    schemeName: string,
    source: EffectiveMdr["source"]
  ): EffectiveMdr => {
    const mdr = applyRate(amt, slab.mdrType, slabMdrValue(slab, d.settlementType));
    const vendor = applyRate(amt, slab.mdrType, slabVendorValue(slab, d.settlementType));
    const rawMargin = round(dec(mdr).sub(dec(vendor)));
    const margin = rawMargin.gt(0) ? rawMargin : dec(0);
    return {
    source,
    schemeId,
    schemeName,
    slabId: slab.id,
    mdr,
    vendor,
    margin,
    mdrType: slab.mdrType,
    commission: {
      retailer: applyRate(amt, slab.commissionType, slab.commissionRetailer),
      distributor: applyRate(amt, slab.commissionType, slabCommissionValue(slab, "distributor", d.settlementType)),
      master: applyRate(amt, slab.commissionType, slabCommissionValue(slab, "master", d.settlementType)),
      superDistributor: applyRate(amt, slab.commissionType, slabCommissionValue(slab, "superDistributor", d.settlementType)),
    },
    };
  };

  if (user.schemeId) {
    const scheme = await prisma.scheme.findFirst({
      where: { id: user.schemeId, active: true },
      select: { id: true, name: true },
    });
    if (scheme) {
      const useClassification = await isCardClassificationEnabled();
      const slab = await resolveFromScheme(scheme.id, serviceKind, d, amt, useClassification);
      if (slab) return build(slab, scheme.id, scheme.name, "USER_SCHEME");
    }
  }

  return emptyMdr();
}

// ---------------------------------------------------------------------------
// MDR resolver — flat model (no chain walk)
// ---------------------------------------------------------------------------

/**
 * Resolve the effective MDR for a user directly from their assigned scheme.
 * No chain walk, no ancestor margins. Used by the POS settlement engine.
 */
export async function resolveMdrForUser(
  userId: string,
  serviceKind: MdrServiceKind,
  amount: Money | string | number,
  dims: MdrDimensions | string = {}
): Promise<EffectiveMdr> {
  return getEffectiveMdr(userId, serviceKind, amount, dims);
}

/**
 * Validate a candidate slab band against existing active slabs with the SAME
 * dimension tuple (scheme, serviceKind, paymentMode, company, cardType,
 * brandType, classification). Different dimension values may legitimately
 * share bands. Returns an error string or null.
 */
export async function validateMdrSlab(
  schemeId: string,
  serviceKind: MdrServiceKind,
  paymentMode: string,
  range: { minAmount: number; maxAmount: number },
  excludeSlabId?: string,
  dims?: Pick<MdrDimensions, "company" | "cardType" | "brandType" | "classification">
): Promise<string | null> {
  const min = dec(range.minAmount);
  const max = dec(range.maxAmount);
  if (min.gt(max)) return "minAmount must be less than or equal to maxAmount";

  const existing = await prisma.mdrSlab.findMany({
    where: {
      schemeId,
      serviceKind,
      paymentMode,
      company: dims?.company ?? null,
      cardType: dims?.cardType ?? null,
      brandType: dims?.brandType ?? null,
      classification: dims?.classification ?? null,
      active: true,
      ...(excludeSlabId ? { id: { not: excludeSlabId } } : {}),
    },
    select: { minAmount: true, maxAmount: true },
  });
  for (const s of existing) {
    if (lte(min, s.maxAmount) && lte(dec(s.minAmount), max)) {
      return `Range ₹${min}–₹${max} overlaps an existing ${paymentMode} slab (₹${dec(s.minAmount)}–₹${dec(s.maxAmount)})`;
    }
  }
  return null;
}
