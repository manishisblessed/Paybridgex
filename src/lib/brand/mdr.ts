import type { BrandMdrRate, RateType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dec, gte, lte, mul, round, type Money } from "@/lib/money";
import { canonicalCardLevel, canonicalNetwork } from "@/lib/pos/binLookup";
import { isCardClassificationEnabled } from "@/lib/settings";

/**
 * Brand MDR engine — resolves the merchant discount rate for a POS capture
 * against a brand's own rate card (teachway / lagoon / avika, …).
 *
 * A brand's rates are keyed by (provider, paymentMode, amount band). "*" (or
 * null) is a wildcard; an exact dimension match beats a wildcard, so a brand
 * can price Razorpay differently from Paytm/PineLab and still keep a catch-all.
 *
 * mdrValue is the T+1 (standard) rate; mdrValueT0 applies to instant (T+0)
 * settlement and falls back to mdrValue when unset. Rates are stored as a
 * fraction for PERCENT (0.0100 = 1%) or an absolute ₹ for FLAT.
 */

export type BrandMdrResult = {
  rateId: string;
  mdrType: RateType;
  /** Absolute MDR (₹) charged for `amount` under the chosen settlement type. */
  mdr: Money;
  provider: string;
  paymentMode: string;
  cardType: string | null;
  brandType: string | null;
  classification: string | null;
};

/** Transaction-side card dimensions used to pick the most specific brand rate. */
export type BrandRateDims = {
  provider?: string | null;
  paymentMode?: string | null;
  cardType?: string | null;
  brandType?: string | null;
  classification?: string | null;
};

const norm = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();
const isWildcard = (v: string | null | undefined) => {
  const n = norm(v);
  return n === "" || n === "*";
};

function applyRate(amount: Money, type: RateType, value: Money | string | number): Money {
  if (type === "FLAT") return round(value);
  return round(mul(amount, value)); // PERCENT stored as a fraction
}

/** Effective rate value for a settlement type (T0 falls back to T1). */
function rateValue(rate: BrandMdrRate, settlementType: "T0" | "T1"): Money {
  if (settlementType === "T0" && Number(rate.mdrValueT0) > 0) return dec(rate.mdrValueT0);
  return dec(rate.mdrValue);
}

/**
 * Score a rate against the capture dimensions. Returns -1 when ineligible
 * (a pinned dimension mismatches), otherwise the count of exact matches
 * (higher = more specific). Wildcard rate dimensions are eligible but score 0.
 *
 * brandType is matched on its canonical network token (so "MASTER_CARD" ==
 * "MASTERCARD") and classification on its canonical card tier ("VISA PLATINUM"
 * == "PLATINUM"); other dimensions compare after case/space normalization.
 */
function rateScore(
  rate: BrandMdrRate,
  dims: BrandRateDims,
  useClassification: boolean,
  opts?: { ignoreProvider?: boolean; relaxWildcard?: boolean }
): number {
  let score = 0;
  const pairs: Array<[
    string | null,
    string | null | undefined,
    (v: string | null | undefined) => string
  ]> = [
    [rate.paymentMode, dims.paymentMode, norm],
    [rate.cardType, dims.cardType, norm],
    [rate.brandType, dims.brandType, canonicalNetwork],
  ];
  // Provider gates matching for a live capture (which carries a provider), but
  // NOT when resolving the company-approved vendor cost for a scheme POS slab —
  // a slab is provider-agnostic, so a provider-specific brand rate must still
  // resolve (mirrors the client's pickBrandRate, which ignores provider).
  if (!opts?.ignoreProvider) {
    pairs.unshift([rate.provider, dims.provider, norm]);
  }
  // Tier dimension is dropped when card classification is disabled platform-wide
  // (pricing falls to Card Category); tier-pinned rates then match as wildcards.
  if (useClassification) {
    pairs.push([rate.classification, dims.classification, canonicalCardLevel]);
  }
  for (const [rateVal, txnVal, cmp] of pairs) {
    if (isWildcard(rateVal)) continue;
    // A wildcard ("Any") slab dimension against a pinned rate is ineligible for
    // a LIVE capture, but at CONFIG time (relaxWildcard) an "Any" scheme slab
    // legitimately inherits a mode-pinned brand rate. It scores 0 so an
    // exactly-pinned rate still wins when both are present.
    if (isWildcard(txnVal)) {
      if (opts?.relaxWildcard) continue;
      return -1;
    }
    if (cmp(rateVal) !== cmp(txnVal)) return -1;
    score++;
  }
  return score;
}

/** Pick the most specific eligible rate whose band contains `amount`. */
function pickRate(
  rates: BrandMdrRate[],
  amount: Money,
  dims: BrandRateDims,
  useClassification: boolean,
  opts?: { ignoreProvider?: boolean; relaxWildcard?: boolean; relaxBand?: boolean }
): BrandMdrRate | null {
  const pickBest = (candidates: BrandMdrRate[]): BrandMdrRate | null => {
    let best: BrandMdrRate | null = null;
    let bestScore = -1;
    for (const rate of candidates) {
      const score = rateScore(rate, dims, useClassification, opts);
      if (score > bestScore) {
        best = rate;
        bestScore = score;
      }
    }
    return bestScore >= 0 ? best : null;
  };

  const inBand = rates.filter((r) => gte(amount, r.minAmount) && lte(amount, r.maxAmount));
  const best = pickBest(inBand);
  if (best || !opts?.relaxBand) return best;

  // Config-time band fallback (relaxBand): a scheme slab's band is independent
  // of the brand rate card's tiers, so a slab that starts below the lowest tier
  // (e.g. slab from ₹0 vs a brand rate from ₹100) must still lock onto it rather
  // than be blocked. Mirrors the client's pickBrandRate, which ignores the band.
  // `rates` is ordered by minAmount asc and pickBest keeps the first of equal
  // scores, so this deterministically resolves to the lowest matching tier.
  return pickBest(rates);
}

/**
 * Resolve the effective brand MDR for a capture. Returns null when the brand
 * has no active rate matching the dimensions/band (caller must NOT settle
 * unpriced money — park it for admin instead).
 */
export async function resolveBrandMdr(input: {
  brandId: string;
  amount: Money | string | number;
  provider?: string | null;
  paymentMode?: string | null;
  cardType?: string | null;
  brandType?: string | null;
  classification?: string | null;
  settlementType?: "T0" | "T1";
}): Promise<BrandMdrResult | null> {
  const amt = round(input.amount);
  const rates = await prisma.brandMdrRate.findMany({
    where: { brandId: input.brandId, active: true },
    orderBy: { minAmount: "asc" },
  });
  const rate = pickRate(rates, amt, input, await isCardClassificationEnabled());
  if (!rate) return null;

  return {
    rateId: rate.id,
    mdrType: rate.mdrType,
    mdr: applyRate(amt, rate.mdrType, rateValue(rate, input.settlementType ?? "T1")),
    provider: rate.provider,
    paymentMode: rate.paymentMode,
    cardType: rate.cardType,
    brandType: rate.brandType,
    classification: rate.classification,
  };
}

/**
 * Resolve the company-approved brand rate for a POS acquiring `company` label
 * (e.g. "Sameday-AXIS"). The company maps to a Brand either through a POS
 * machine that carries it (PosMachine.company -> brandId) or, failing that, by
 * matching the brand name directly. Returns the most specific active rate whose
 * band contains `amount`, or null when the company has no linked brand / rate.
 *
 * This is the authoritative "vendor cost" for a scheme's POS slab: the slab's
 * vendor charge is locked to it and the MDR can never be priced below it.
 */
export async function findApprovedBrandRate(
  input: {
    company: string;
    amount: Money | string | number;
  } & BrandRateDims
): Promise<BrandMdrRate | null> {
  const company = (input.company ?? "").trim();
  if (!company) return null;

  const machine = await prisma.posMachine.findFirst({
    where: { company, brandId: { not: null } },
    select: { brandId: true },
  });
  let brandId = machine?.brandId ?? null;
  if (!brandId) {
    const brand = await prisma.brand.findFirst({
      where: { name: company, active: true },
      select: { id: true },
    });
    brandId = brand?.id ?? null;
  }
  if (!brandId) return null;

  const rates = await prisma.brandMdrRate.findMany({
    where: { brandId, active: true },
    orderBy: { minAmount: "asc" },
  });
  return pickRate(rates, round(input.amount), input, await isCardClassificationEnabled(), {
    ignoreProvider: true,
    // Config-time vendor lock for a scheme slab: an "Any"-mode slab may inherit a
    // mode-pinned brand rate (mirrors the client's pickBrandRate).
    relaxWildcard: true,
    // The slab band is independent of the rate card's tiers, so a slab starting
    // below the lowest tier still locks onto the brand's rate.
    relaxBand: true,
  });
}

/**
 * Validate a candidate rate band against existing active rates sharing the
 * SAME full dimension tuple (provider, paymentMode, cardType, brandType,
 * classification). Different dimension values may legitimately share bands
 * (e.g. Credit/Visa/Platinum vs Credit/Visa/Gold). Returns an error string or
 * null.
 */
export async function validateBrandRate(
  brandId: string,
  dims: {
    provider: string;
    paymentMode: string;
    cardType: string | null;
    brandType: string | null;
    classification: string | null;
  },
  range: { minAmount: number; maxAmount: number },
  excludeRateId?: string
): Promise<string | null> {
  const min = dec(range.minAmount);
  const max = dec(range.maxAmount);
  if (min.gt(max)) return "minAmount must be less than or equal to maxAmount";

  const existing = await prisma.brandMdrRate.findMany({
    where: {
      brandId,
      provider: dims.provider,
      paymentMode: dims.paymentMode,
      cardType: dims.cardType,
      brandType: dims.brandType,
      classification: dims.classification,
      active: true,
      ...(excludeRateId ? { id: { not: excludeRateId } } : {}),
    },
    select: { minAmount: true, maxAmount: true },
  });
  const label = [dims.provider, dims.paymentMode, dims.cardType, dims.brandType, dims.classification]
    .filter((v) => v && v !== "*")
    .join("/");
  for (const r of existing) {
    if (lte(min, r.maxAmount) && lte(dec(r.minAmount), max)) {
      return `Range ₹${min}–₹${max} overlaps an existing ${label || "*"} rate (₹${dec(
        r.minAmount
      )}–₹${dec(r.maxAmount)})`;
    }
  }
  return null;
}
