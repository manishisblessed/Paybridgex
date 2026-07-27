import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * Chain commission engine tests — the revenue-wallet-funded model:
 *   company MDR margin (service − vendor) is credited to the Revenue Wallet,
 *   then DT/MD/SD commissions are paid OUT of it net of 2% TDS, with TDS
 *   routed to the TDS liability ledger. The transacting retailer earns none.
 */

const d = (v: number | string) => new Prisma.Decimal(v);

const state = vi.hoisted(() => ({
  users: new Map<string, Record<string, unknown>>(),
  slabs: [] as Record<string, unknown>[],
  commissionCredits: [] as Record<string, unknown>[],
  tdsEntries: [] as Record<string, unknown>[],
  walletCredits: [] as Record<string, unknown>[],
  walletDebits: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.users.get(where.id) ?? null,
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        // getRevenueAccountId: oldest MASTER_ADMIN
        if (where.role === "MASTER_ADMIN") return { id: "revacct" };
        return null;
      },
    },
    scheme: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        where.id === "s1" ? { id: "s1", name: "POS Plan" } : null,
    },
    // Platform settings store — the MDR resolver reads pos.card_classification.
    // Returning null makes getSetting() fall back to its schema default.
    platformSetting: {
      findUnique: async () => null,
    },
    mdrSlab: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        state.slabs.filter(
          (s) => s.schemeId === where.schemeId && s.serviceKind === where.serviceKind
        ),
    },
    commissionCredit: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        state.commissionCredits.find(
          (c) =>
            c.transactionId === where.transactionId &&
            c.userId === where.userId &&
            c.tier === where.tier
        ) ?? null,
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
    return { id: `wc_${state.walletCredits.length}` };
  },
  debitWallet: async (input: Record<string, unknown>) => {
    state.walletDebits.push(input);
    return { id: `wd_${state.walletDebits.length}` };
  },
}));

import { distributeMdrCommission } from "@/lib/commission/distribute";

function mdrSlab(overrides: Record<string, unknown> = {}) {
  return {
    id: "slab1",
    schemeId: "s1",
    serviceKind: "POS",
    paymentMode: "*",
    company: null,
    cardType: null,
    brandType: null,
    classification: null,
    minAmount: d(0),
    maxAmount: d(1000000),
    mdrType: "PERCENT",
    mdrValue: d(0.02), // 2% service charge
    mdrValueT0: d(0),
    vendorCharge: d(0.013), // 1.3% acquirer cost
    vendorChargeT0: d(0),
    commissionType: "PERCENT",
    commissionRetailer: d(0),
    commissionDistributor: d(0.002), // 0.2%
    commissionMaster: d(0.001), // 0.1%
    commissionSuperDistributor: d(0.0005), // 0.05%
    active: true,
    ...overrides,
  };
}

beforeEach(() => {
  // Hierarchy: SD -> MD -> DT -> RT (retailer transacts).
  state.users = new Map<string, Record<string, unknown>>([
    ["rt", { id: "rt", schemeId: "s1", parentId: "dt" }],
    ["dt", { id: "dt", schemeId: null, parentId: "md" }],
    ["md", { id: "md", schemeId: null, parentId: "sd" }],
    ["sd", { id: "sd", schemeId: null, parentId: null }],
    ["revacct", { id: "revacct", schemeId: null, parentId: null }],
  ]);
  state.slabs = [mdrSlab()];
  state.commissionCredits = [];
  state.tdsEntries = [];
  state.walletCredits = [];
  state.walletDebits = [];
});

describe("distributeMdrCommission (chain, revenue-wallet funded)", () => {
  it("credits the MDR margin to the revenue wallet and pays DT/MD/SD net of TDS", async () => {
    const credits = await distributeMdrCommission("txn1", "rt", "POS", 10000, "UPI_COLLECT" as never);

    // Three upline payouts: DT, MD, SD.
    expect(credits).toHaveLength(3);
    const byTier = Object.fromEntries(credits.map((c) => [c.tier, c]));

    // ₹10,000 @ 0.2% / 0.1% / 0.05% gross, 2% TDS.
    expect(byTier.DISTRIBUTOR.userId).toBe("dt");
    expect(byTier.DISTRIBUTOR.gross).toBeCloseTo(20);
    expect(byTier.DISTRIBUTOR.tds).toBeCloseTo(0.4);
    expect(byTier.DISTRIBUTOR.amount).toBeCloseTo(19.6);

    expect(byTier.MASTER.userId).toBe("md");
    expect(byTier.MASTER.amount).toBeCloseTo(9.8);

    expect(byTier.SUPER.userId).toBe("sd");
    expect(byTier.SUPER.amount).toBeCloseTo(4.9);
  });

  it("credits the revenue wallet with the margin (service − vendor)", async () => {
    await distributeMdrCommission("txn2", "rt", "POS", 10000, "UPI_COLLECT" as never);
    const margin = state.walletCredits.find((w) => w.reason === "MDR_MARGIN");
    expect(margin).toBeTruthy();
    // 2% − 1.3% = 0.7% of ₹10,000 = ₹70.
    expect(Number(margin!.amount)).toBeCloseTo(70);
    expect(margin!.walletType).toBe("REVENUE");
    expect(margin!.userId).toBe("revacct");
  });

  it("debits the revenue wallet to fund each commission", async () => {
    await distributeMdrCommission("txn3", "rt", "POS", 10000, "UPI_COLLECT" as never);
    const debits = state.walletDebits.filter((w) => w.reason === "COMMISSION_PAYOUT");
    expect(debits).toHaveLength(3);
    for (const debit of debits) {
      expect(debit.userId).toBe("revacct");
      expect(debit.walletType).toBe("REVENUE");
    }
    const totalDebited = debits.reduce((sum, w) => sum + Number(w.amount), 0);
    expect(totalDebited).toBeCloseTo(35); // 20 + 10 + 5 gross
  });

  it("records a TDS liability entry per payout", async () => {
    await distributeMdrCommission("txn4", "rt", "POS", 10000, "UPI_COLLECT" as never);
    expect(state.tdsEntries).toHaveLength(3);
    const totalTds = state.tdsEntries.reduce((sum, t) => sum + Number(t.tdsAmount), 0);
    expect(totalTds).toBeCloseTo(0.7); // 0.4 + 0.2 + 0.1
  });

  it("does not pay the transacting retailer any commission", async () => {
    const credits = await distributeMdrCommission("txn5", "rt", "POS", 10000, "UPI_COLLECT" as never);
    expect(credits.find((c) => c.userId === "rt")).toBeUndefined();
    const rtCredit = state.walletCredits.find((w) => w.userId === "rt");
    expect(rtCredit).toBeUndefined();
  });

  it("skips missing upline tiers gracefully", async () => {
    // Retailer directly under SD (no DT/MD) — only one ancestor.
    state.users.set("rt", { id: "rt", schemeId: "s1", parentId: "sd" });
    const credits = await distributeMdrCommission("txn6", "rt", "POS", 10000, "UPI_COLLECT" as never);
    // Only the level-1 ancestor (sd) receives the DISTRIBUTOR share.
    expect(credits).toHaveLength(1);
    expect(credits[0].tier).toBe("DISTRIBUTOR");
    expect(credits[0].userId).toBe("sd");
  });
});
