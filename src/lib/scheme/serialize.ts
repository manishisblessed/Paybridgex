import type { MdrSlab, Scheme, SchemeSlab } from "@prisma/client";
import { serializeMdrSlab, serializeMdrSlabForRole } from "@/lib/mdr/serialize";

/** JSON-safe shape for a SchemeSlab (Decimals -> numbers). */
export function serializeSlab(s: SchemeSlab) {
  return {
    id: s.id,
    schemeId: s.schemeId,
    service: s.service,
    provider: s.provider,
    minAmount: Number(s.minAmount),
    maxAmount: Number(s.maxAmount),
    chargeType: s.chargeType,
    chargeValue: Number(s.chargeValue),
    chargeGstInclusive: s.chargeGstInclusive,
    // Vendor cost locked from the service rate card (BBPS/Payout); revenue per
    // txn = chargeValue − vendorCharge. 0 for un-carded / acquiring services.
    vendorCharge: Number(s.vendorCharge),
    commissionType: s.commissionType,
    commissionRetailer: Number(s.commissionRetailer),
    commissionDistributor: Number(s.commissionDistributor),
    commissionMaster: Number(s.commissionMaster),
    commissionSuperDistributor: Number(s.commissionSuperDistributor),
    commissionValue: Number(s.commissionValue),
    parentSlabId: s.parentSlabId,
    active: s.active,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

type SchemeWithCounts = Scheme & {
  _count?: { slabs: number; users: number; mdrSlabs?: number };
  slabs?: SchemeSlab[];
  mdrSlabs?: MdrSlab[];
};

/** JSON-safe shape for a Scheme, optionally embedding counts + slabs (service + MDR). */
export function serializeScheme(s: SchemeWithCounts) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    active: s.active,
    isDefault: s.isDefault,
    createdById: s.createdById,
    ownerId: s.ownerId,
    parentSchemeId: s.parentSchemeId,
    slabCount: s._count?.slabs ?? (s.slabs ? s.slabs.length : 0),
    mdrSlabCount: s._count?.mdrSlabs ?? (s.mdrSlabs ? s.mdrSlabs.length : 0),
    userCount: s._count?.users ?? 0,
    slabs: s.slabs ? s.slabs.map(serializeSlab) : undefined,
    mdrSlabs: s.mdrSlabs ? s.mdrSlabs.map(serializeMdrSlab) : undefined,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/**
 * Self-scoped SchemeSlab for user-facing views (`/api/me/scheme`). Exposes the
 * caller's charges + their own commission (`commissionValue`) only, and drops
 * the per-tier commission columns (`commissionRetailer/Distributor/Master/
 * SuperDistributor`) so a child never sees any parent tier's commission.
 */
export function serializeSlabForSelf(s: SchemeSlab) {
  return {
    id: s.id,
    schemeId: s.schemeId,
    service: s.service,
    provider: s.provider,
    minAmount: Number(s.minAmount),
    maxAmount: Number(s.maxAmount),
    chargeType: s.chargeType,
    chargeValue: Number(s.chargeValue),
    chargeGstInclusive: s.chargeGstInclusive,
    commissionType: s.commissionType,
    commissionValue: Number(s.commissionValue),
    active: s.active,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/**
 * Role-scoped Scheme for a user-facing "My Scheme" view — either the caller's
 * own scheme, or a direct child's scheme viewed by a parent. `role` is the role
 * of the user the scheme belongs to (the viewed user), so MDR commission is
 * shown for that tier only. Embeds only the redacted slabs (service + MDR) and
 * omits platform-internal fields. Never leaks another tier's MDR% or commission.
 */
export function serializeSchemeForRole(s: SchemeWithCounts, role: string) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    active: s.active,
    isDefault: s.isDefault,
    slabCount: s._count?.slabs ?? (s.slabs ? s.slabs.length : 0),
    mdrSlabCount: s._count?.mdrSlabs ?? (s.mdrSlabs ? s.mdrSlabs.length : 0),
    slabs: s.slabs ? s.slabs.map(serializeSlabForSelf) : undefined,
    mdrSlabs: s.mdrSlabs ? s.mdrSlabs.map((m) => serializeMdrSlabForRole(m, role)) : undefined,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export type SerializedScheme = ReturnType<typeof serializeScheme>;
export type SerializedSlab = ReturnType<typeof serializeSlab>;
export type SerializedSchemeForRole = ReturnType<typeof serializeSchemeForRole>;
