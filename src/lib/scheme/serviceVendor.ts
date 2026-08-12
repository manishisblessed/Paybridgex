import type { ServiceCode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { familyOf, isChargeDrivenService, SERVICE_FAMILIES } from "@/lib/scheme/constants";
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

/** Vendor cost + minimum resolved from a service rate card (no enforcement). */
export type ServiceVendorInfo = {
  /** Upstream/vendor cost per txn (₹) locked from the card's flat/percent rate. */
  vendorCharge: number;
  /** Minimum customer charge (₹) — the card's Min, defaulting to the vendor cost. */
  minCharge: number;
  /** The scope key the rate card was resolved under (product key or family). */
  scopeKey: string;
  /** Rate type of the resolved card (FLAT enables charge-floor enforcement). */
  mdrType: "FLAT" | "PERCENT";
};

/**
 * Resolve the vendor cost + minimum for a BBPS/Payout slab from its rate card,
 * WITHOUT enforcing the slab's charge against the minimum. This is the shared
 * lookup used by the live slab table, the modal preview, the vendor lock, and
 * the relock backfill. Candidate scope order: exact per-product BBPS scope
 * (rate card keyed by the ServiceRoute key, e.g. "bbps_credit_card"), then the
 * backing partner family ("SAMEDAY"/"BULKPE"). Returns null when the service is
 * not a charge-driven rail, no provider/product is pinned, or no card matches.
 */
export async function resolveServiceVendorInfo(input: {
  service: ServiceCode;
  provider: string | null | undefined;
  amount: number;
}): Promise<ServiceVendorInfo | null> {
  if (!isChargeDrivenService(input.service)) return null;

  const family = familyOf(input.service).key;
  if (family !== "BBPS" && family !== "PAYOUT") return null;

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
  if (candidates.length === 0) return null;

  for (const scopeKey of candidates) {
    const approved = await findApprovedRailRate({
      serviceKind: family,
      scopeKey,
      amount: Math.max(input.amount, 1),
      // Service rails carry no card dimensions — match the provider's flat rate.
      provider: "*",
      paymentMode: "*",
      cardType: null,
      brandType: null,
      classification: null,
    });
    if (approved) {
      const vendorCharge = Number(approved.mdrValue);
      // Minimum charge defaults to the vendor cost when the card leaves it at 0.
      const minCharge = Number(approved.minMdrValue) > 0 ? Number(approved.minMdrValue) : vendorCharge;
      return { vendorCharge, minCharge, scopeKey, mdrType: approved.mdrType };
    }
  }
  return null;
}

export async function resolveServiceVendorLock(input: {
  service: ServiceCode;
  provider: string | null | undefined;
  chargeType: "FLAT" | "PERCENT";
  chargeValue: number;
  minAmount: number;
}): Promise<ServiceVendorLock> {
  const info = await resolveServiceVendorInfo({
    service: input.service,
    provider: input.provider,
    amount: input.minAmount,
  });
  if (!info) return PASS_THROUGH;

  // Service rails price a flat ₹/txn. A percentage rate card (or slab) can't be
  // compared to a flat charge, so skip enforcement but still surface the vendor.
  if (info.mdrType !== "FLAT" || input.chargeType !== "FLAT") {
    return { ok: true, enforced: false, vendorCharge: info.vendorCharge, minCharge: 0 };
  }

  const EPS = 1e-6;
  if (input.chargeValue + EPS < info.minCharge) {
    const family = familyOf(input.service).key;
    return {
      ok: false,
      error: `Charge ₹${input.chargeValue} is below the ${family} minimum of ₹${info.minCharge} for ${info.scopeKey}. Raise the charge to at least ₹${info.minCharge}, or update the rate in MDR & minimum charges.`,
    };
  }

  return { ok: true, enforced: true, vendorCharge: info.vendorCharge, minCharge: info.minCharge };
}

/**
 * Re-lock the stored `vendorCharge` snapshot on every charge-driven scheme slab
 * in a rail's family (BBPS/Payout) from the CURRENT rate cards. Called after an
 * admin adds/edits/deletes a rate card, because transaction-time revenue reads
 * the slab snapshot — this keeps it in sync so a card change propagates without
 * manually re-saving each slab. Best-effort; returns the number of slabs changed.
 */
export async function relockServiceSlabsForRail(rail: "BBPS" | "PAYOUT"): Promise<number> {
  const fam = SERVICE_FAMILIES.find((f) => f.key === rail);
  const services = (fam?.services ?? []) as unknown as ServiceCode[];
  if (services.length === 0) return 0;

  const slabs = await prisma.schemeSlab.findMany({
    where: { service: { in: services } },
    select: { id: true, service: true, provider: true, minAmount: true, vendorCharge: true },
  });

  let updated = 0;
  for (const s of slabs) {
    const info = await resolveServiceVendorInfo({
      service: s.service,
      provider: s.provider,
      amount: Number(s.minAmount),
    });
    const nextVendor = info ? info.vendorCharge : 0;
    if (Number(s.vendorCharge) !== nextVendor) {
      await prisma.schemeSlab.update({ where: { id: s.id }, data: { vendorCharge: nextVendor } });
      updated++;
    }
  }
  return updated;
}
