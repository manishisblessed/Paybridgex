import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { toFixedString } from "@/lib/money";

/**
 * Scheme resolver tests — flat model.
 *
 * The pricing engine resolves the user's directly-assigned scheme. There is
 * no hierarchy or chain walk. Commission is only relevant for PG/POS/QR
 * transactions (guarded at the distribution layer, not in the resolver).
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
    schemeSlab: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        state.slabs.filter(
          (s) =>
            s.schemeId === where.schemeId &&
            (!where.service || s.service === where.service) &&
            (where.active === undefined || s.active === where.active) &&
            (!where.id ||
              (where.id as { not?: string }).not === undefined ||
              s.id !== (where.id as { not: string }).not)
        ),
    },
  },
}));

import {
  applyRate,
  getEffectiveRate,
  validateNonOverlapping,
  PAYOUT_MODE_SERVICE,
} from "@/lib/scheme/resolver";

const d = (v: number | string) => new Prisma.Decimal(v);

function slab(overrides: Record<string, unknown>) {
  return {
    id: "slab1",
    schemeId: "scheme1",
    service: "DMT_IMPS",
    provider: null,
    minAmount: d(0),
    maxAmount: d(100000),
    chargeType: "FLAT",
    chargeValue: d(10),
    commissionType: "FLAT",
    commissionValue: d(5),
    chargeGstInclusive: false,
    parentSlabId: null,
    active: true,
    ...overrides,
  };
}

beforeEach(() => {
  state.users = new Map([
    ["u1", { id: "u1", schemeId: "scheme1" }],
  ]);
  state.schemes = [
    { id: "scheme1", name: "Gold", active: true },
  ];
  state.slabs = [slab({})];
});

describe("applyRate", () => {
  it("FLAT returns the rupee value regardless of amount", () => {
    expect(toFixedString(applyRate(99999, "FLAT", "12.5"))).toBe("12.50");
  });

  it("PERCENT treats the value as a fraction (0.0050 = 0.5%)", () => {
    expect(toFixedString(applyRate(10000, "PERCENT", "0.0050"))).toBe("50.00");
    expect(toFixedString(applyRate(1234.56, "PERCENT", "0.0050"))).toBe("6.17");
  });
});

describe("getEffectiveRate (flat model)", () => {
  it("resolves the user's assigned scheme directly", async () => {
    const rate = await getEffectiveRate("u1", "DMT_IMPS", 10000);
    expect(rate.source).toBe("USER_SCHEME");
    expect(rate.schemeName).toBe("Gold");
    expect(toFixedString(rate.charge)).toBe("10.00");
    expect(toFixedString(rate.commission)).toBe("5.00");
  });

  it("returns NONE when user has no scheme assigned", async () => {
    state.users.set("u1", { id: "u1", schemeId: null });
    const rate = await getEffectiveRate("u1", "DMT_IMPS", 10000);
    expect(rate.source).toBe("NONE");
    expect(toFixedString(rate.charge)).toBe("0.00");
    expect(toFixedString(rate.commission)).toBe("0.00");
  });

  it("returns NONE when the user does not exist", async () => {
    const rate = await getEffectiveRate("nonexistent", "DMT_IMPS", 10000);
    expect(rate.source).toBe("NONE");
  });

  it("returns NONE when scheme is inactive", async () => {
    state.schemes = [{ id: "scheme1", name: "Gold", active: false }];
    const rate = await getEffectiveRate("u1", "DMT_IMPS", 10000);
    expect(rate.source).toBe("NONE");
  });

  it("skips slabs whose band does not contain the amount", async () => {
    state.slabs = [slab({ minAmount: d(0), maxAmount: d(500) })];
    const rate = await getEffectiveRate("u1", "DMT_IMPS", 10000);
    expect(rate.source).toBe("NONE");
  });

  it("handles PERCENT commission correctly", async () => {
    state.slabs = [slab({ commissionType: "PERCENT", commissionValue: d("0.0100") })];
    const rate = await getEffectiveRate("u1", "DMT_IMPS", 10000);
    expect(rate.source).toBe("USER_SCHEME");
    expect(toFixedString(rate.commission)).toBe("100.00");
  });

  it("prefers provider-specific slab over null-provider slab", async () => {
    state.slabs = [
      slab({ id: "generic", provider: null, chargeValue: d(10), commissionValue: d(5) }),
      slab({ id: "specific", provider: "SAMEDAY", chargeValue: d(7), commissionValue: d(8) }),
    ];
    const rate = await getEffectiveRate("u1", "DMT_IMPS", 10000, "SAMEDAY_PAY2NEW");
    expect(rate.source).toBe("USER_SCHEME");
    expect(rate.slabId).toBe("specific");
    expect(toFixedString(rate.charge)).toBe("7.00");
    expect(toFixedString(rate.commission)).toBe("8.00");
  });
});

describe("per-product BBPS price scope", () => {
  // Two BBPS/CC products can ride the same partner (Same Day serves both
  // Pay2New and RechargeKit CC). Pricing is keyed by the ServiceRoute key so
  // each product resolves to its own slab, with a partner-family fallback.
  it("prefers an exact product-scope slab over the partner-family slab", async () => {
    state.slabs = [
      slab({ id: "family", service: "BILL_CREDIT_CARD", provider: "SAMEDAY", chargeValue: d(9) }),
      slab({ id: "product", service: "BILL_CREDIT_CARD", provider: "bbps_credit_card", chargeValue: d(6) }),
    ];
    const rate = await getEffectiveRate("u1", "BILL_CREDIT_CARD", 5000, "bbps_credit_card");
    expect(rate.slabId).toBe("product");
    expect(toFixedString(rate.charge)).toBe("6.00");
  });

  it("falls back to the partner-family slab when no product slab exists", async () => {
    state.slabs = [
      slab({ id: "family", service: "BILL_CREDIT_CARD", provider: "SAMEDAY", chargeValue: d(9) }),
    ];
    const rate = await getEffectiveRate("u1", "BILL_CREDIT_CARD", 5000, "rechargekit_cc");
    expect(rate.slabId).toBe("family");
    expect(toFixedString(rate.charge)).toBe("9.00");
  });

  it("prices two products on the same partner independently", async () => {
    state.slabs = [
      slab({ id: "pay2new", service: "BILL_CREDIT_CARD", provider: "bbps_credit_card", chargeValue: d(6) }),
      slab({ id: "rechargekit", service: "BILL_CREDIT_CARD", provider: "rechargekit_cc", chargeValue: d(12) }),
    ];
    const a = await getEffectiveRate("u1", "BILL_CREDIT_CARD", 5000, "bbps_credit_card");
    const b = await getEffectiveRate("u1", "BILL_CREDIT_CARD", 5000, "rechargekit_cc");
    expect(a.slabId).toBe("pay2new");
    expect(toFixedString(a.charge)).toBe("6.00");
    expect(b.slabId).toBe("rechargekit");
    expect(toFixedString(b.charge)).toBe("12.00");
  });

  it("does not cross-match a different partner family", async () => {
    // A BulkPe-only slab must never price a Same Day product (no null slab).
    state.slabs = [
      slab({ id: "bulkpe", service: "BILL_ELECTRICITY", provider: "bbps_bulkpe_svc", chargeValue: d(8) }),
    ];
    const rate = await getEffectiveRate("u1", "BILL_ELECTRICITY", 5000, "bbps_sameday");
    expect(rate.source).toBe("NONE");
  });
});

describe("validateNonOverlapping", () => {
  it("rejects min > max", async () => {
    const err = await validateNonOverlapping("scheme1", "DMT_IMPS", {
      minAmount: 100,
      maxAmount: 50,
    });
    expect(err).toMatch(/less than or equal/);
  });

  it("rejects a band overlapping an existing active slab", async () => {
    const err = await validateNonOverlapping("scheme1", "DMT_IMPS", {
      minAmount: 50000,
      maxAmount: 150000,
    });
    expect(err).toMatch(/overlaps/);
  });

  it("accepts a disjoint band", async () => {
    const err = await validateNonOverlapping("scheme1", "DMT_IMPS", {
      minAmount: 100001,
      maxAmount: 200000,
    });
    expect(err).toBeNull();
  });
});

describe("payout mode → service mapping", () => {
  it("maps every payout mode to the unified PAYOUT scheme service code", () => {
    expect(PAYOUT_MODE_SERVICE.IMPS).toBe("PAYOUT");
    expect(PAYOUT_MODE_SERVICE.NEFT).toBe("PAYOUT");
    expect(PAYOUT_MODE_SERVICE.RTGS).toBe("PAYOUT");
    expect(PAYOUT_MODE_SERVICE.UPI).toBe("PAYOUT");
  });
});
