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
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) => {
        // getTdsAccountId resolves the system TDS Payable account by email.
        if (where.email === "tds-payable@system.paybridgex") return { id: "tdsacct" };
        if (where.id) return state.users.get(where.id) ?? null;
        return null;
      },
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

  it("moves the withheld TDS into the TDS Payable account", async () => {
    await distributeMdrCommission("txnTds", "rt", "POS", 10000, "UPI_COLLECT" as never);
    const tdsCredits = state.walletCredits.filter((w) => w.reason === "TDS_WITHHELD");
    expect(tdsCredits).toHaveLength(3);
    for (const c of tdsCredits) expect(c.userId).toBe("tdsacct");
    const totalTdsHeld = tdsCredits.reduce((sum, w) => sum + Number(w.amount), 0);
    expect(totalTdsHeld).toBeCloseTo(0.7); // 0.4 + 0.2 + 0.1
  });

  it("conserves money: revenue debited (gross) == payee net + TDS held", async () => {
    await distributeMdrCommission("txnConserve", "rt", "POS", 10000, "UPI_COLLECT" as never);
    const grossDebited = state.walletDebits
      .filter((w) => w.reason === "COMMISSION_PAYOUT")
      .reduce((s, w) => s + Number(w.amount), 0);
    const payeeNet = state.walletCredits
      .filter((w) => w.reason === "COMMISSION")
      .reduce((s, w) => s + Number(w.amount), 0);
    const tdsHeld = state.walletCredits
      .filter((w) => w.reason === "TDS_WITHHELD")
      .reduce((s, w) => s + Number(w.amount), 0);
    // gross out of the revenue wallet is fully accounted for: net to payees +
    // TDS held in the TDS Payable account. No rupee leaks.
    expect(payeeNet + tdsHeld).toBeCloseTo(grossDebited);
    expect(grossDebited).toBeCloseTo(35); // 20 + 10 + 5
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

describe("distributeMdrCommission — QR provider-scoped slab resolution", () => {
  // Regression: QR (and PG) scheme MDR slabs pin the settlement provider in the
  // slab's `company` dimension. The resolver matches `company` exactly, so the
  // settlement/commission callers MUST pass the active provider scopeKey as the
  // transaction-side `company` or the slab is scored ineligible → NONE → no
  // commission (and, in the settlement pricer, a null quote → nothing settles).
  function qrSlab(overrides: Record<string, unknown> = {}) {
    return mdrSlab({
      id: "qrslab",
      serviceKind: "QR",
      company: "NPCI", // provider scopeKey (as the MDR-slabs API persists it)
      paymentMode: "UPI",
      brandType: "RUPAY",
      ...overrides,
    });
  }

  it("resolves the provider-scoped slab when the provider is passed as company", async () => {
    state.slabs = [qrSlab()];
    const credits = await distributeMdrCommission("qrTxn1", "rt", "QR", 10000, "WALLET_TOPUP" as never, {
      paymentMode: "UPI",
      brandType: "RUPAY",
      company: "NPCI",
    });
    // DT/MD/SD all earn — proving the slab resolved.
    expect(credits).toHaveLength(3);
    const dist = credits.find((c) => c.tier === "DISTRIBUTOR");
    expect(dist!.gross).toBeCloseTo(20); // ₹10,000 @ 0.2%
  });

  it("does NOT resolve a provider-scoped slab when company is omitted (the bug)", async () => {
    state.slabs = [qrSlab()];
    const credits = await distributeMdrCommission("qrTxn2", "rt", "QR", 10000, "WALLET_TOPUP" as never, {
      paymentMode: "UPI",
      brandType: "RUPAY",
      // company intentionally omitted → pinned-company slab is ineligible.
    });
    expect(credits).toHaveLength(0);
  });

  it("a wildcard-company QR slab still resolves regardless of provider", async () => {
    state.slabs = [qrSlab({ company: null })];
    const credits = await distributeMdrCommission("qrTxn3", "rt", "QR", 10000, "WALLET_TOPUP" as never, {
      paymentMode: "UPI",
      brandType: "RUPAY",
      company: "NPCI",
    });
    expect(credits).toHaveLength(3);
  });
});

describe("distributeMdrCommission — instant (T+0) commission leg", () => {
  it("uses the explicit T+0 commission per tier for POS (no fallback to T+1)", async () => {
    // POS commission is priced explicitly per settlement leg (the T+0 pool
    // differs from T+1), so an unset (0) T+0 rate does NOT fall back — that
    // tier simply earns nothing on the instant leg.
    state.slabs = [
      mdrSlab({
        commissionDistributorT0: d(0.003), // 0.3% instant (vs 0.2% T+1)
        commissionMasterT0: d(0),
        commissionSuperDistributorT0: d(0),
      }),
    ];

    const credits = await distributeMdrCommission(
      "txnT0",
      "rt",
      "POS",
      10000,
      "UPI_COLLECT" as never,
      { settlementType: "T0" }
    );
    const byTier = Object.fromEntries(credits.map((c) => [c.tier, c]));

    // DIST uses the T+0 rate: ₹10,000 @ 0.3% = ₹30 gross.
    expect(byTier.DISTRIBUTOR.gross).toBeCloseTo(30);
    // MASTER / SUPER have no T+0 rate → not paid on the instant leg.
    expect(byTier.MASTER).toBeUndefined();
    expect(byTier.SUPER).toBeUndefined();
  });

  it("still uses the T+1 commission when settling T+1 even if a T+0 rate exists", async () => {
    state.slabs = [mdrSlab({ commissionDistributorT0: d(0.003) })];

    const credits = await distributeMdrCommission(
      "txnT1",
      "rt",
      "POS",
      10000,
      "UPI_COLLECT" as never,
      { settlementType: "T1" }
    );
    const dist = credits.find((c) => c.tier === "DISTRIBUTOR");
    // T+1 leg ignores the T+0 rate: 0.2% = ₹20 gross.
    expect(dist!.gross).toBeCloseTo(20);
  });
});
