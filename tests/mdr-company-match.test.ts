import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { toFixedString } from "@/lib/money";
import { canonicalCompany } from "@/lib/pos/classification";

/**
 * Regression guard for the POS settlement stall of Oct-2026: the acquirer feed
 * reformatted its company label ("Sameday-AVIKA-AXIS" → "Sameday-AVIKA - AXIS",
 * "Sameday-Avika POS ( HDFC)" → "Sameday-AVIKA - HDFC"), which no longer matched
 * the MDR slabs' pinned `company`, so every affected capture resolved to NONE
 * (NO_SCHEME) and never settled. The MDR matcher now compares `company` on a
 * canonical token set so the SAME acquirer matches across formats while DISTINCT
 * acquirers (AXIS vs HDFC) stay distinct and keep their own rate.
 */

const state = vi.hoisted(() => ({
  users: new Map<string, Record<string, unknown>>(),
  schemes: [] as Record<string, unknown>[],
  slabs: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.users.get(where.id) ?? null,
    },
    scheme: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        state.schemes.find((s) => {
          if (where.id && s.id !== where.id) return false;
          if (where.active && !s.active) return false;
          return true;
        }) ?? null,
    },
    mdrSlab: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        state.slabs.filter(
          (s) =>
            s.schemeId === where.schemeId &&
            (!where.serviceKind || s.serviceKind === where.serviceKind) &&
            (where.active === undefined || s.active === where.active)
        ),
    },
  },
}));

// Keep card-classification OFF so the test isolates the company dimension.
vi.mock("@/lib/settings", () => ({
  isCardClassificationEnabled: async () => false,
}));

import { getEffectiveMdr } from "@/lib/mdr/resolver";

const d = (v: number | string) => new Prisma.Decimal(v);

function posSlab(overrides: Record<string, unknown>) {
  return {
    id: "slab",
    schemeId: "scheme1",
    serviceKind: "POS",
    active: true,
    minAmount: d(0),
    maxAmount: d(9999999999),
    paymentMode: "CARD",
    company: null,
    cardType: "CREDIT",
    brandType: "VISA",
    classification: null,
    mdrType: "PERCENT",
    mdrValue: d("0.014"),
    mdrValueT0: d("0.018"),
    vendorCharge: d("0.010"),
    vendorChargeT0: d("0.012"),
    mdrGstInclusive: false,
    commissionType: "PERCENT",
    commissionRetailer: d(0),
    commissionDistributor: d(0),
    commissionMaster: d(0),
    commissionSuperDistributor: d(0),
    commissionDistributorT0: d(0),
    commissionMasterT0: d(0),
    commissionSuperDistributorT0: d(0),
    ...overrides,
  };
}

beforeEach(() => {
  state.users = new Map([["u1", { id: "u1", schemeId: "scheme1" }]]);
  state.schemes = [{ id: "scheme1", name: "Platinum", active: true }];
  state.slabs = [
    posSlab({ id: "axis", company: "Sameday-AVIKA-AXIS", mdrValue: d("0.014") }),
    posSlab({ id: "hdfc", company: "Sameday-Avika POS ( HDFC)", mdrValue: d("0.020") }),
  ];
});

describe("canonicalCompany", () => {
  it("collapses punctuation/spacing variants of the same acquirer", () => {
    expect(canonicalCompany("Sameday-AVIKA-AXIS")).toBe(
      canonicalCompany("Sameday-AVIKA - AXIS")
    );
    expect(canonicalCompany("Sameday-Avika POS ( HDFC)")).toBe(
      canonicalCompany("Sameday-AVIKA - HDFC")
    );
  });

  it("keeps distinct acquirers distinct (AXIS ≠ HDFC)", () => {
    expect(canonicalCompany("Sameday-AVIKA - AXIS")).not.toBe(
      canonicalCompany("Sameday-AVIKA - HDFC")
    );
  });

  it("drops noise tokens and is order-independent", () => {
    expect(canonicalCompany("Sameday-AVIKA - AXIS")).toBe("AVIKA AXIS");
    expect(canonicalCompany("AXIS AVIKA POS")).toBe("AVIKA AXIS");
  });

  it("returns empty for null / all-noise labels", () => {
    expect(canonicalCompany(null)).toBe("");
    expect(canonicalCompany("Sameday POS")).toBe("");
  });
});

describe("getEffectiveMdr — acquirer company format tolerance", () => {
  it("matches the AXIS slab for the reformatted 'Sameday-AVIKA - AXIS' label", async () => {
    const mdr = await getEffectiveMdr("u1", "POS" as never, 100000, {
      paymentMode: "CARD",
      company: "Sameday-AVIKA - AXIS",
      cardType: "CREDIT",
      brandType: "VISA",
      settlementType: "T1",
    });
    expect(mdr.source).toBe("USER_SCHEME");
    expect(mdr.slabId).toBe("axis");
    expect(toFixedString(mdr.mdr)).toBe("1400.00"); // 0.014 × 100000
  });

  it("matches the HDFC slab for the reformatted 'Sameday-AVIKA - HDFC' label", async () => {
    const mdr = await getEffectiveMdr("u1", "POS" as never, 100000, {
      paymentMode: "CARD",
      company: "Sameday-AVIKA - HDFC",
      cardType: "CREDIT",
      brandType: "VISA",
      settlementType: "T1",
    });
    expect(mdr.source).toBe("USER_SCHEME");
    expect(mdr.slabId).toBe("hdfc");
    expect(toFixedString(mdr.mdr)).toBe("2000.00"); // 0.020 × 100000 (HDFC rate, not AXIS)
  });

  it("still returns NONE for a genuinely different acquirer", async () => {
    const mdr = await getEffectiveMdr("u1", "POS" as never, 100000, {
      paymentMode: "CARD",
      company: "Sameday-Unknown Bank",
      cardType: "CREDIT",
      brandType: "VISA",
      settlementType: "T1",
    });
    expect(mdr.source).toBe("NONE");
  });

  it("treats an all-noise slab company as a wildcard (does not block the match)", async () => {
    state.slabs = [posSlab({ id: "wild", company: "Sameday POS", mdrValue: d("0.015") })];
    const mdr = await getEffectiveMdr("u1", "POS" as never, 100000, {
      paymentMode: "CARD",
      company: "Sameday-AVIKA - AXIS",
      cardType: "CREDIT",
      brandType: "VISA",
      settlementType: "T1",
    });
    expect(mdr.source).toBe("USER_SCHEME");
    expect(mdr.slabId).toBe("wild");
  });
});
