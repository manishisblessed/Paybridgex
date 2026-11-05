import { add, dec, gt, percentOf, round, sub, type Money } from "@/lib/money";
import { getEffectiveRate, PricingUnavailableError } from "@/lib/scheme/resolver";

/**
 * Bank Transfer (Knteer) pricing.
 *
 * Identical charge model to the Settlement-based payout: the service charge is
 * ON TOP of the transfer amount, GST is 18% of the service charge, and the
 * retailer's wallet is debited:
 *
 *   totalDebit = amount + serviceCharge + GST(serviceCharge)
 *
 * The ONLY difference from `quotePayoutForUser` is the ServiceCode: Bank
 * Transfer prices from its OWN scheme slabs (`service: KNTEER_PAYOUT`), so the
 * admin configures it independently of the existing Bank Payouts product.
 *
 * FAILS CLOSED: when `requireScheme` is set (every money-moving route), a
 * (user, amount) with no matching KNTEER_PAYOUT slab throws
 * {@link PricingUnavailableError} — an unpriced transfer can never settle.
 */

export const GST_PERCENT = 18;

/**
 * Provider tag the Knteer scheme slabs + vendor rate card are resolved against.
 * Distinct from plain "SAMEDAY" so Bank Transfer has its OWN vendor/minimum
 * card under Services → Payout (scopeKey "SAMEDAY_KNTEER") and its own slab
 * pin, independent of the settlement-based Payout product.
 */
export const KNTEER_PROVIDER = "SAMEDAY_KNTEER";

export type KnteerQuote = {
  amount: Money;
  serviceCharge: Money;
  gst: Money;
  gstRate: number;
  totalDebit: Money;
  vendorCharge: Money;
  source: string;
};

export async function quoteKnteerForUser(
  userId: string,
  amount: Money | string | number,
  opts: { requireScheme?: boolean } = {}
): Promise<KnteerQuote> {
  const amt = round(amount);

  const rate = await getEffectiveRate(userId, "KNTEER_PAYOUT", amt, KNTEER_PROVIDER);

  let serviceCharge: Money;
  let gst: Money;
  let vendorCharge: Money = dec(0);
  let source = "NONE";

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
    // No slab covers this (user, amount). Money routes MUST fail closed.
    if (opts.requireScheme) throw new PricingUnavailableError();
    serviceCharge = dec(0);
    gst = dec(0);
  }

  const totalDebit = round(add(add(amt, serviceCharge), gst));
  return {
    amount: amt,
    serviceCharge,
    gst,
    gstRate: gt(gst, 0) ? GST_PERCENT : 0,
    totalDebit,
    vendorCharge,
    source,
  };
}
