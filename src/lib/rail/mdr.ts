import type { RailMdrRate, MdrServiceKind, RateType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dec, gte, lte, mul, round, type Money } from "@/lib/money";
import { canonicalCardLevel, canonicalNetwork } from "@/lib/pos/binLookup";
import { isCardClassificationEnabled } from "@/lib/settings";

/**
 * Rail MDR engine — the PG/QR analogue of the POS brand MDR engine
 * (src/lib/brand/mdr.ts). Resolves the acquirer (vendor) cost for a PG or QR
 * rail against a provider's own rate card (RailMdrRate), keyed by the powering
 * ServiceRoute provider (scopeKey, e.g. "BULKPE").
 *
 * Rates are keyed by (provider, paymentMode, card dims, amount band). "*" (or
 * null) is a wildcard; an exact dimension match beats a wildcard. mdrValue is
 * the T+1 rate; mdrValueT0 applies to instant (T+0) settlement and falls back
 * to mdrValue when unset. PERCENT is stored as a fraction (0.0100 = 1%).
 */

export type RailRateDims = {
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
  return round(mul(amount, value));
}

function rateValue(rate: RailMdrRate, settlementType: "T0" | "T1"): Money {
  if (settlementType === "T0" && Number(rate.mdrValueT0) > 0) return dec(rate.mdrValueT0);
  return dec(rate.mdrValue);
}

/**
 * Score a rate against the txn dimensions. -1 when ineligible (a pinned rate
 * dimension mismatches); otherwise the count of exact matches (higher = more
 * specific). Wildcard rate dimensions are eligible but score 0.
 */
function rateScore(
  rate: RailMdrRate,
  dims: RailRateDims,
  useClassification: boolean,
  relaxWildcard = false
): number {
  let score = 0;
  const pairs: Array<[
    string | null,
    string | null | undefined,
    (v: string | null | undefined) => string
  ]> = [
    [rate.provider, dims.provider, norm],
    [rate.paymentMode, dims.paymentMode, norm],
    [rate.cardType, dims.cardType, norm],
    [rate.brandType, dims.brandType, canonicalNetwork],
  ];
  if (useClassification) {
    pairs.push([rate.classification, dims.classification, canonicalCardLevel]);
  }
  for (const [rateVal, txnVal, cmp] of pairs) {
    if (isWildcard(rateVal)) continue;
    // A wildcard ("Any") txn/slab dimension against a pinned rate dimension is
    // ineligible for a LIVE capture (the capture must match the rate exactly),
    // but at CONFIG time (relaxWildcard) an "Any" scheme slab legitimately
    // inherits the provider's pinned rate — e.g. a QR slab left as "Any"
    // instrument locking onto the single UPI rail rate. It scores 0 so an
    // exactly-pinned rate still wins when both are present.
    if (isWildcard(txnVal)) {
      if (relaxWildcard) continue;
      return -1;
    }
    if (cmp(rateVal) !== cmp(txnVal)) return -1;
    score++;
  }
  return score;
}

/** Pick the most specific eligible rate whose band contains `amount`. */
function pickRate(
  rates: RailMdrRate[],
  amount: Money,
  dims: RailRateDims,
  useClassification: boolean,
  relaxWildcard = false,
  relaxBand = false
): RailMdrRate | null {
  const pickBest = (candidates: RailMdrRate[]): RailMdrRate | null => {
    let best: RailMdrRate | null = null;
    let bestScore = -1;
    for (const rate of candidates) {
      const score = rateScore(rate, dims, useClassification, relaxWildcard);
      if (score > bestScore) {
        best = rate;
        bestScore = score;
      }
    }
    return bestScore >= 0 ? best : null;
  };

  const inBand = rates.filter((r) => gte(amount, r.minAmount) && lte(amount, r.maxAmount));
  const best = pickBest(inBand);
  if (best || !relaxBand) return best;

  // Config-time band fallback (relaxBand): a scheme slab's band is independent
  // of the vendor rate card's tiers, so a slab that starts below the lowest tier
  // (e.g. slab from ₹0 vs a vendor rate from ₹100) must still lock onto it rather
  // than be blocked. Mirrors the client's pickBrandRate, which ignores the band.
  // `rates` is ordered by minAmount asc and pickBest keeps the first of equal
  // scores, so this deterministically resolves to the lowest matching tier.
  return pickBest(rates);
}

/**
 * Resolve the effective rail MDR for a capture against a provider's rate card.
 * Returns null when the provider has no active rate matching the dims/band.
 */
export async function resolveRailMdr(input: {
  serviceKind: MdrServiceKind;
  scopeKey: string;
  amount: Money | string | number;
  provider?: string | null;
  paymentMode?: string | null;
  cardType?: string | null;
  brandType?: string | null;
  classification?: string | null;
  settlementType?: "T0" | "T1";
}): Promise<{ rateId: string; mdrType: RateType; mdr: Money } | null> {
  const amt = round(input.amount);
  const rates = await prisma.railMdrRate.findMany({
    where: { serviceKind: input.serviceKind, scopeKey: input.scopeKey, active: true },
    orderBy: { minAmount: "asc" },
  });
  const rate = pickRate(rates, amt, input, await isCardClassificationEnabled());
  if (!rate) return null;
  return {
    rateId: rate.id,
    mdrType: rate.mdrType,
    mdr: applyRate(amt, rate.mdrType, rateValue(rate, input.settlementType ?? "T1")),
  };
}

/**
 * Resolve the provider-approved rail rate for a scheme's PG/QR slab. This is the
 * authoritative "vendor cost": the slab's vendor charge is locked to it and the
 * MDR can never be priced below it. Returns the most specific active rate whose
 * band contains `amount`, or null when the provider has no matching rate.
 */
export async function findApprovedRailRate(
  input: {
    serviceKind: MdrServiceKind;
    scopeKey: string;
    amount: Money | string | number;
  } & RailRateDims
): Promise<RailMdrRate | null> {
  const scopeKey = (input.scopeKey ?? "").trim();
  if (!scopeKey) return null;

  const rates = await prisma.railMdrRate.findMany({
    where: { serviceKind: input.serviceKind, scopeKey, active: true },
    orderBy: { minAmount: "asc" },
  });
  // relaxWildcard = true: this resolves the vendor cost to lock a scheme SLAB to,
  // not a live capture. An "Any" slab may inherit a mode-pinned provider rate.
  // relaxBand = true: the slab band is independent of the rate card's tiers, so a
  // slab starting below the lowest tier still locks onto the provider's rate.
  return pickRate(rates, round(input.amount), input, await isCardClassificationEnabled(), true, true);
}

/**
 * Validate a candidate rate band against existing active rates sharing the SAME
 * full dimension tuple (provider, paymentMode, cardType, brandType,
 * classification) for a provider. Returns an error string or null.
 */
export async function validateRailRate(
  serviceKind: MdrServiceKind,
  scopeKey: string,
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

  const existing = await prisma.railMdrRate.findMany({
    where: {
      serviceKind,
      scopeKey,
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
