import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { toFixedString } from "@/lib/money";

/**
 * Flat commission model tests — TDS math, direct commission distribution
 * (no chain), service eligibility guard, and the "no scheme, no transaction"
 * gate. Money regressions here mean wrong payouts to users.
 */

const state = vi.hoisted(() => ({
  users: new Map<string, Record<string, unknown>>(),
  schemes: [] as Record<string, unknown>[],
  slabs: [] as Record<string, unknown>[],
  commissionCredits: [] as Record<string, unknown>[],
  walletCredits: [] as Record<string, unknown>[],
  tdsEntries: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) => {
        // getTdsAccountId resolves the system TDS Payable account by email.
        if (where.email === "tds-payable@system.paybridgex") return { id: "tdsacct" };
        if (where.id) return state.users.get(where.id) ?? null;
        return null;
      },
    },
    scheme: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const found = state.schemes.find((s) => {
          if (where.id && s.id !== where.id) return false;
          if (where.active && !s.active) return false;
          return true;
        });
        return found ?? null;
      },
    },
    schemeSlab: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        state.slabs.filter(
          (s) =>
            s.schemeId === where.schemeId &&
            (!where.service || s.service === where.service) &&
            (where.active === undefined || s.active === where.active)
        ),
    },
    commissionCredit: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.commissionCredits.push(data);
        return { id: `cc_${state.commissionCredits.length}` };
      },
    },
    tdsLedgerEntry: {
      findUnique: async ({ where }: { where: { idempotencyKey: string } }) =>
        state.tdsEntries.find((t) => t.idempotencyKey === where.idempotencyKey) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.tdsEntries.push(data);
        return { id: `tds_${state.tdsEntries.length}` };
      },
    },
  },
}));

vi.mock("@/lib/ledger", () => ({
  creditWallet: async (input: Record<string, unknown>) => {
    state.walletCredits.push(input);
    return { id: `wt_${state.walletCredits.length}` };
  },
}));

vi.mock("@/lib/commission/revenue", () => ({
  creditPlatformRevenue: async () => {},
}));

import { applyTds, distributeCommission, TDS_RATE } from "@/lib/commission/distribute";
import { dec } from "@/lib/money";

const d = (v: number | string) => new Prisma.Decimal(v);

function slab(overrides: Record<string, unknown> = {}) {
  return {
    id: "slab1",
    schemeId: "scheme1",
    service: "PG",
    provider: null,
    minAmount: d(0),
    maxAmount: d(100000),
    chargeType: "FLAT",
    chargeValue: d(10),
    commissionType: "FLAT",
    commissionValue: d(5),
    chargeGstInclusive: false,
    active: true,
    ...overrides,
  };
}

beforeEach(() => {
  state.users = new Map([
    ["u1", { id: "u1", schemeId: "scheme1" }],
  ]);
  state.schemes = [{ id: "scheme1", name: "Gold PG", active: true }];
  state.slabs = [slab({})];
  state.commissionCredits = [];
  state.walletCredits = [];
  state.tdsEntries = [];
});

describe("TDS calculation", () => {
  it("applies 2% TDS on gross commission", () => {
    const { tds, net } = applyTds(dec(100));
    expect(toFixedString(tds)).toBe("2.00");
    expect(toFixedString(net)).toBe("98.00");
  });

  it("rounds TDS to 2 decimal places", () => {
    const { tds, net } = applyTds(dec(33));
    expect(toFixedString(tds)).toBe("0.66");
    expect(toFixedString(net)).toBe("32.34");
  });

  it("TDS_RATE is 0.02", () => {
    expect(TDS_RATE).toBe(0.02);
  });
});

describe("distributeCommission (flat model)", () => {
  it("credits commission for PG transactions", async () => {
    const credits = await distributeCommission("txn1", "u1", "PG" as any, 10000);
    expect(credits).toHaveLength(1);
    expect(credits[0].userId).toBe("u1");
    expect(credits[0].tier).toBe("DIRECT");
    expect(credits[0].gross).toBe(5);
    expect(credits[0].tds).toBeCloseTo(0.10);
    expect(credits[0].amount).toBeCloseTo(4.90);
    // One COMMISSION credit (net to payee) + one TDS_WITHHELD credit (held in
    // the TDS Payable account) — money is conserved (net + TDS = gross).
    const commissionCredit = state.walletCredits.filter((w) => w.reason === "COMMISSION");
    const tdsCredit = state.walletCredits.filter((w) => w.reason === "TDS_WITHHELD");
    expect(commissionCredit).toHaveLength(1);
    expect(tdsCredit).toHaveLength(1);
    expect(tdsCredit[0].userId).toBe("tdsacct");
    expect(Number(tdsCredit[0].amount)).toBeCloseTo(0.10);
    expect(state.commissionCredits).toHaveLength(1);
    expect(state.tdsEntries).toHaveLength(1);
  });

  it("does NOT distribute commission for BBPS service", async () => {
    state.slabs = [slab({ service: "BILL_ELECTRICITY" })];
    const credits = await distributeCommission("txn2", "u1", "BILL_ELECTRICITY" as any, 5000);
    expect(credits).toHaveLength(0);
    expect(state.walletCredits).toHaveLength(0);
  });

  it("does NOT distribute commission for PAYOUT", async () => {
    state.slabs = [slab({ service: "PAYOUT" })];
    const credits = await distributeCommission("txn3", "u1", "PAYOUT" as any, 5000);
    expect(credits).toHaveLength(0);
  });

  it("does NOT distribute commission for AePS", async () => {
    state.slabs = [slab({ service: "AEPS_WITHDRAW" })];
    const credits = await distributeCommission("txn4", "u1", "AEPS_WITHDRAW" as any, 5000);
    expect(credits).toHaveLength(0);
  });

  it("returns empty when user has no scheme", async () => {
    state.users.set("u1", { id: "u1", schemeId: null });
    const credits = await distributeCommission("txn5", "u1", "PG" as any, 10000);
    expect(credits).toHaveLength(0);
  });

  it("returns empty when commission is zero", async () => {
    state.slabs = [slab({ commissionValue: d(0) })];
    const credits = await distributeCommission("txn6", "u1", "PG" as any, 10000);
    expect(credits).toHaveLength(0);
  });

  it("credits commission for QR transactions", async () => {
    state.slabs = [slab({ service: "QR" })];
    const credits = await distributeCommission("txn7", "u1", "QR" as any, 10000);
    expect(credits).toHaveLength(1);
    expect(credits[0].tier).toBe("DIRECT");
  });

  it("credits commission for POS transactions", async () => {
    state.slabs = [slab({ service: "POS" })];
    const credits = await distributeCommission("txn8", "u1", "POS" as any, 10000);
    expect(credits).toHaveLength(1);
    expect(credits[0].tier).toBe("DIRECT");
  });
});
