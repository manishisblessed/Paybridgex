import type { ServiceCode } from "@prisma/client";
import { familyOf, isChargeDrivenService } from "@/lib/scheme/constants";
import { normalizeProviderTag } from "@/lib/scheme/resolver";
import { isBbpsPriceScope, priceScopeFamily } from "@/lib/services/priceScope";
import { findApprovedRailRate } from "@/lib/rail/mdr";

/**
 * Service-rail (BBPS / Payout) vendor + minimum enforcement.
 *
 * These services price a flat ₹/txn customer charge on a SchemeSlab. When the
 * slab is pinned to a provider that has an approved service rate card
 * (RailMdrRate, serviceKind BBPS|PAYOUT — managed in "MDR & minimum charges"),
 * this resolves that card to:
 *   - LOCK the vendor cost onto the slab (SchemeSlab.vendorCharge), so company
 *     revenue per txn = chargeValue − vendorCharge is auditable, and
 *   - ENFORCE that the customer charge is never below the rate's Minimum charge.
 *
 * When there is no matching card (no provider pinned, none configured, or a
 * non-FLAT rate that can't be compared to a flat charge) it returns
 * enforced:false with vendorCharge 0 so existing un-carded slabs keep working.
 */
export type ServiceVendorLock =
  | { ok: true; enforced: boolean; vendorCharge: number; minCharge: number }
  | { ok: false; error: string };

const PASS_THROUGH: ServiceVendorLock = { ok: true, enforced: false, vendorCharge: 0, minCharge: 0 };

export async function resolveServiceVendorLock(input: {
  service: ServiceCode;
  provider: string | null | undefined;
  chargeType: "FLAT" | "PERCENT";
  chargeValue: number;
  minAmount: number;
}): Promise<ServiceVendorLock> {
  // Only BBPS bill codes + Payout are charge-driven service rails.
  if (!isChargeDrivenService(input.service)) return PASS_THROUGH;

  const family = familyOf(input.service).key;
  if (family !== "BBPS" && family !== "PAYOUT") return PASS_THROUGH;

  // A slab must be pinned to a provider/product to inherit its rate card.
  // Candidate scope keys in priority order: an exact per-product BBPS scope
  // (rail rate card keyed by the ServiceRoute key, e.g. "bbps_credit_card"),
  // then the backing partner family ("SAMEDAY"/"BULKPE") as a fallback.
  const raw = (input.provider ?? "").trim();
  const candidates: string[] = [];
  if (isBbpsPriceScope(raw)) {
    candidates.push(raw);
    const fam = priceScopeFamily(raw);
    if (fam) candidates.push(fam);
  } else {
    const norm = normalizeProviderTag(input.provider);
    if (norm) candidates.push(norm);
  }
  if (candidates.length === 0) return PASS_THROUGH;

  let approved: Awaited<ReturnType<typeof findApprovedRailRate>> = null;
  let scopeKey = candidates[0];
  for (const candidate of candidates) {
    approved = await findApprovedRailRate({
      serviceKind: family,
      scopeKey: candidate,
      amount: Math.max(input.minAmount, 1),
      // Service rails carry no card dimensions — match the provider's flat rate.
      provider: "*",
      paymentMode: "*",
      cardType: null,
      brandType: null,
      classification: null,
    });
    if (approved) {
      scopeKey = candidate;
      break;
    }
  }
  if (!approved) return PASS_THROUGH;

  // Service rails price a flat ₹/txn. A percentage rate card (or slab) can't be
  // compared to a flat charge, so skip enforcement but still surface the vendor.
  if (approved.mdrType !== "FLAT" || input.chargeType !== "FLAT") {
    return { ok: true, enforced: false, vendorCharge: Number(approved.mdrValue), minCharge: 0 };
  }

  const vendorCharge = Number(approved.mdrValue);
  // Minimum charge defaults to the vendor cost when the card leaves it at 0.
  const minCharge = Number(approved.minMdrValue) > 0 ? Number(approved.minMdrValue) : vendorCharge;

  const EPS = 1e-6;
  if (input.chargeValue + EPS < minCharge) {
    return {
      ok: false,
      error: `Charge ₹${input.chargeValue} is below the ${family} minimum of ₹${minCharge} for ${scopeKey}. Raise the charge to at least ₹${minCharge}, or update the rate in MDR & minimum charges.`,
    };
  }

  return { ok: true, enforced: true, vendorCharge, minCharge };
}
