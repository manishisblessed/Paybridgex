import type { MdrSlab } from "@prisma/client";

/** The MDR commission a given role earns on a slab — its OWN tier only. */
export function ownMdrCommission(s: MdrSlab, role: string): number {
  switch (role) {
    case "DISTRIBUTOR":
      return Number(s.commissionDistributor);
    case "MASTER_DISTRIBUTOR":
      return Number(s.commissionMaster);
    case "SUPER_DISTRIBUTOR":
      return Number(s.commissionSuperDistributor);
    default:
      return 0; // RETAILER earns settlement net, no MDR commission
  }
}

/**
 * Role-scoped MDR slab for user-facing views (`/api/me/scheme`, incl. a parent
 * viewing a direct child). Exposes the target's MDR rate + dimensions and ONLY
 * that role's own commission tier — never the platform's vendor cost or the
 * other tiers' commission columns. This enforces "a child must not see any
 * parent's MDR/commission" while still surfacing the viewed user's own numbers.
 */
export function serializeMdrSlabForRole(s: MdrSlab, role: string) {
  return {
    id: s.id,
    schemeId: s.schemeId,
    serviceKind: s.serviceKind,
    paymentMode: s.paymentMode,
    company: s.company,
    cardType: s.cardType,
    brandType: s.brandType,
    classification: s.classification,
    minAmount: Number(s.minAmount),
    maxAmount: Number(s.maxAmount),
    mdrType: s.mdrType,
    mdrValue: Number(s.mdrValue),
    mdrValueT0: Number(s.mdrValueT0),
    commissionType: s.commissionType,
    commission: ownMdrCommission(s, role),
    active: s.active,
  };
}

/** JSON-safe shape for an MdrSlab (Decimals -> numbers). Admin/full view. */
export function serializeMdrSlab(s: MdrSlab) {
  return {
    id: s.id,
    schemeId: s.schemeId,
    serviceKind: s.serviceKind,
    paymentMode: s.paymentMode,
    company: s.company,
    cardType: s.cardType,
    brandType: s.brandType,
    classification: s.classification,
    minAmount: Number(s.minAmount),
    maxAmount: Number(s.maxAmount),
    mdrType: s.mdrType,
    mdrValue: Number(s.mdrValue),
    mdrValueT0: Number(s.mdrValueT0),
    vendorCharge: Number(s.vendorCharge),
    vendorChargeT0: Number(s.vendorChargeT0),
    commissionType: s.commissionType,
    commissionDistributor: Number(s.commissionDistributor),
    commissionMaster: Number(s.commissionMaster),
    commissionSuperDistributor: Number(s.commissionSuperDistributor),
    parentSlabId: s.parentSlabId,
    active: s.active,
  };
}
