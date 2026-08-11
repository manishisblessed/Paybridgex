import type { PayoutMode } from "@prisma/client";
import { add, dec, gt, percentOf, round, sub, type Money } from "@/lib/money";
import { getEffectiveRate, PAYOUT_MODE_SERVICE } from "@/lib/scheme/resolver";

/**
 * Payout pricing.
 *
 * Charge model: the service charge is ON TOP. The beneficiary receives the
 * full `amount`; the user is debited:
 *
 *   totalDebit = amount + serviceCharge + GST(serviceCharge)
 *
 * GST is 18% of the service charge (not of the payout amount), rounded at
 * money scale. All math goes through Decimal helpers — never JS floats.
 *
 * Service charge is a flat fee per slab/mode (typical for IMPS/NEFT/RTGS/UPI
 * payouts). Tune SLABS without touching the math.
 */

export const GST_PERCENT = 18;

/**
 * Route family that actually disburses each payout mode, used to resolve the
 * provider-scoped scheme slab (bank rails go via Same Day settlement, UPI via
 * BulkPe). Mirrors resolvePayout() in partners/index.ts. Matched loosely by
 * normalizeProviderTag, so a slab pinned to "SAMEDAY" resolves here.
 */
export const PAYOUT_MODE_PROVIDER: Record<PayoutMode, string> = {
  IMPS: "SAMEDAY",
  NEFT: "SAMEDAY",
  RTGS: "SAMEDAY",
  UPI: "BULKPE",
};

type Slab = { upTo: number | null; charge: number };

// Flat service charge by mode and amount band (₹). `upTo: null` = no upper bound.
const SLABS: Record<PayoutMode, Slab[]> = {
  IMPS: [
    { upTo: 1000, charge: 5 },
    { upTo: 25000, charge: 10 },
    { upTo: null, charge: 15 },
  ],
  UPI: [
    { upTo: 1000, charge: 3 },
    { upTo: 25000, charge: 6 },
    { upTo: null, charge: 10 },
  ],
  NEFT: [
    { upTo: 10000, charge: 5 },
    { upTo: null, charge: 10 },
  ],
  RTGS: [{ upTo: null, charge: 20 }],
};

export type PayoutQuote = {
  amount: Money;
  serviceCharge: Money;
  gst: Money;
  totalDebit: Money;
};

/** Resolve the flat service charge for an amount + mode. */
export function payoutServiceCharge(amount: Money | string | number, mode: PayoutMode): Money {
  const amt = dec(amount);
  const slabs = SLABS[mode] ?? SLABS.IMPS;
  for (const slab of slabs) {
    if (slab.upTo === null || !gt(amt, slab.upTo)) {
      return round(slab.charge);
    }
  }
  return round(slabs[slabs.length - 1].charge);
}

/**
 * Compute the full money breakdown for a payout. This is the single source of
 * truth used by the quote endpoint, the submit route, and the UI preview — the
 * client value is never trusted.
 */
export function quotePayout(amount: Money | string | number, mode: PayoutMode): PayoutQuote {
  const amt = round(amount);
  const serviceCharge = payoutServiceCharge(amt, mode);
  const gst = percentOf(serviceCharge, GST_PERCENT);
  const totalDebit = round(add(add(amt, serviceCharge), gst));
  return { amount: amt, serviceCharge, gst, totalDebit };
}

/**
 * User-aware payout quote. The service charge resolves from the user's
 * assigned Scheme via getEffectiveRate (flat model — no default-scheme
 * fallback; the scheme gate blocks unassigned network users upstream). If the
 * scheme has no slab for this amount/mode, the static SLABS price the charge
 * so staff accounts and unconfigured bands stay functional.
 */
export async function quotePayoutForUser(
  userId: string,
  amount: Money | string | number,
  mode: PayoutMode
): Promise<PayoutQuote & { source: string; vendorCharge: Money }> {
  const amt = round(amount);
  const service = PAYOUT_MODE_SERVICE[mode];

  // serviceCharge is always stored EX-GST; `gst` is broken out separately so
  // company revenue (serviceCharge − vendorCharge) never includes the GST
  // pass-through. Upstream/partner cost is locked from the scheme rate card;
  // 0 for the static-slab fallback (no vendor card → whole charge is revenue).
  let serviceCharge: Money;
  let gst: Money;
  let source = "STATIC_SLABS";
  let vendorCharge: Money = dec(0);
  if (service) {
    const rate = await getEffectiveRate(userId, service, amt, PAYOUT_MODE_PROVIDER[mode]);
    if (rate.source !== "NONE") {
      source = rate.source;
      vendorCharge = round(rate.vendorCharge);
      if (rate.chargeGstInclusive) {
        // Slab charge already bakes in GST → split back into base + GST so the
        // ex-GST base drives revenue while totalDebit stays identical.
        const total = round(rate.charge);
        serviceCharge = round(dec(total).div("1.18"));
        gst = round(sub(total, serviceCharge));
      } else {
        serviceCharge = round(rate.charge);
        gst = percentOf(serviceCharge, GST_PERCENT);
      }
    } else {
      serviceCharge = payoutServiceCharge(amt, mode);
      gst = percentOf(serviceCharge, GST_PERCENT);
    }
  } else {
    serviceCharge = payoutServiceCharge(amt, mode);
    gst = percentOf(serviceCharge, GST_PERCENT);
  }

  const totalDebit = round(add(add(amt, serviceCharge), gst));
  return { amount: amt, serviceCharge, gst, totalDebit, source, vendorCharge };
}
