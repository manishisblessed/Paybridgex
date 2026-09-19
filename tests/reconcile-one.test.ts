import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * reconcileOneTransaction — the safe, targeted "resolve one stuck payment"
 * helper behind the admin/retailer "Reconcile / Check status" actions.
 *
 * These tests lock the ROUTING + OUTCOME-MAPPING contract by mocking the direct
 * collaborators (DB lookup, the RechargeKit webhook reconciler, the BBPS partner
 * status call, and the shared finalizer):
 *   - not found                    → { found: false }
 *   - already terminal             → noop, no provider call
 *   - RechargeKit in-flight        → delegates to the RK reconciler + passes all refs
 *   - BBPS in-flight SUCCESS       → finalize(SUCCESS) → "settled"
 *   - BBPS in-flight FAILED        → finalize(FAILED)  → "refunded"
 *   - BBPS in-flight PENDING       → "pending", never finalizes
 *   - owner scoping                → findFirst is scoped to userId
 *   - unsupported rail             → noop
 */

const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  finalize: vi.fn(),
  reconcileRK: vi.fn(),
  bbpsStatus: vi.fn(),
  bbpsHasStatus: true,
}));

vi.mock("@/lib/db", () => ({
  prisma: { transaction: { findFirst: (...a: unknown[]) => h.findFirst(...a) } },
}));

vi.mock("@/lib/services/finalize", () => ({
  FINALIZABLE_TXN_SELECT: {},
  finalizeServiceTransaction: (...a: unknown[]) => h.finalize(...a),
}));

vi.mock("@/lib/recon/rechargekit", () => ({
  reconcileRechargekitFromWebhook: (...a: unknown[]) => h.reconcileRK(...a),
  // Faithful re-impl of the real ref extractor so the RK ref-passing assertion
  // exercises the same behavior the production helper relies on.
  refsFromResponse: (response: unknown) => {
    if (!response || typeof response !== "object") return [];
    const r = response as Record<string, unknown>;
    const out: string[] = [];
    for (const k of ["txn_id", "txnId", "request_id", "requestId"]) {
      const v = r[k];
      if (typeof v === "string" && v.trim().length > 0) out.push(v.trim());
    }
    return out;
  },
}));

vi.mock("@/lib/partners", () => ({
  getPartner: () => ({
    name: "bbps",
    status: h.bbpsHasStatus ? (...a: unknown[]) => h.bbpsStatus(...a) : undefined,
  }),
}));

import { reconcileOneTransaction } from "@/lib/recon/reconcileOne";

const RK_PARTNER = "SAMEDAY_RECHARGEKIT";

function txnRow(over: Record<string, unknown> = {}) {
  return {
    id: "id1",
    refId: "TXN1",
    userId: "u1",
    amount: 50000,
    fee: 25,
    gst: 4.5,
    vendorCharge: 0,
    service: "BILL_CREDIT_CARD",
    status: "PROCESSING",
    partner: RK_PARTNER,
    partnerTxnId: "PTX1",
    response: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.bbpsHasStatus = true;
});

describe("reconcileOneTransaction — lookup", () => {
  it("returns not-found when no row matches", async () => {
    h.findFirst.mockResolvedValue(null);
    const r = await reconcileOneTransaction("NOPE");
    expect(r).toEqual({ found: false });
    expect(h.reconcileRK).not.toHaveBeenCalled();
    expect(h.finalize).not.toHaveBeenCalled();
  });

  it("no-ops on an already-terminal row without hitting any provider", async () => {
    h.findFirst.mockResolvedValue(txnRow({ status: "SUCCESS" }));
    const r = await reconcileOneTransaction("TXN1");
    expect(r).toMatchObject({ found: true, alreadyTerminal: true, status: "SUCCESS", outcome: "noop" });
    expect(h.reconcileRK).not.toHaveBeenCalled();
    expect(h.finalize).not.toHaveBeenCalled();
    expect(h.bbpsStatus).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the owner when ownerUserId is given", async () => {
    h.findFirst.mockResolvedValue(null);
    await reconcileOneTransaction("TXN1", { ownerUserId: "u9" });
    const arg = h.findFirst.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where.userId).toBe("u9");
  });

  it("does NOT scope by user for admin/ops use", async () => {
    h.findFirst.mockResolvedValue(null);
    await reconcileOneTransaction("TXN1");
    const arg = h.findFirst.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where.userId).toBeUndefined();
  });
});

describe("reconcileOneTransaction — RechargeKit rail", () => {
  it("delegates to the RK reconciler and maps its outcome", async () => {
    h.findFirst.mockResolvedValue(
      txnRow({ partnerTxnId: "PTX1", response: { request_id: "REQ9" } })
    );
    h.reconcileRK.mockResolvedValue({ matched: true, outcome: "settled", refId: "TXN1" });

    const r = await reconcileOneTransaction("TXN1");
    expect(r).toMatchObject({ found: true, rail: "rechargekit", outcome: "settled" });
    expect(h.finalize).not.toHaveBeenCalled();

    // Every candidate ref is forwarded: stored partnerTxnId, our refId, and the
    // request_id recovered from the pay response (the blank-partnerTxnId rescue).
    const refs = h.reconcileRK.mock.calls[0][0] as string[];
    expect(refs).toEqual(expect.arrayContaining(["PTX1", "TXN1", "REQ9"]));
  });

  it("maps an undefined/unknown RK outcome to noop", async () => {
    h.findFirst.mockResolvedValue(txnRow());
    h.reconcileRK.mockResolvedValue({ matched: true });
    const r = await reconcileOneTransaction("TXN1");
    expect(r).toMatchObject({ rail: "rechargekit", outcome: "noop" });
  });
});

describe("reconcileOneTransaction — BBPS rail", () => {
  const bbpsRow = (over: Record<string, unknown> = {}) =>
    txnRow({ partner: "SAMEDAY_BBPS", service: "BILL_ELECTRICITY", partnerTxnId: "ORD1", ...over });

  it("settles when the provider reports SUCCESS", async () => {
    h.findFirst.mockResolvedValue(bbpsRow());
    h.bbpsStatus.mockResolvedValue({ ok: true, data: { status: "SUCCESS" }, raw: { x: 1 } });
    h.finalize.mockResolvedValue({ finalized: true, outcome: "settled" });

    const r = await reconcileOneTransaction("TXN1");
    expect(r).toMatchObject({ rail: "bbps", outcome: "settled" });
    expect(h.finalize).toHaveBeenCalledTimes(1);
    expect(h.finalize.mock.calls[0][0]).toMatchObject({ status: "SUCCESS", source: "admin_recon" });
  });

  it("refunds when the provider reports FAILED", async () => {
    h.findFirst.mockResolvedValue(bbpsRow());
    h.bbpsStatus.mockResolvedValue({ ok: true, data: { status: "FAILED" }, raw: {} });
    h.finalize.mockResolvedValue({ finalized: true, outcome: "refunded" });

    const r = await reconcileOneTransaction("TXN1");
    expect(r).toMatchObject({ rail: "bbps", outcome: "refunded" });
    expect(h.finalize.mock.calls[0][0]).toMatchObject({ status: "FAILED" });
  });

  it("leaves a PENDING provider status untouched (no finalize)", async () => {
    h.findFirst.mockResolvedValue(bbpsRow());
    h.bbpsStatus.mockResolvedValue({ ok: true, data: { status: "PENDING" } });

    const r = await reconcileOneTransaction("TXN1");
    expect(r).toMatchObject({ rail: "bbps", outcome: "pending" });
    expect(h.finalize).not.toHaveBeenCalled();
  });

  it("no-ops when the provider status call fails", async () => {
    h.findFirst.mockResolvedValue(bbpsRow());
    h.bbpsStatus.mockResolvedValue({ ok: false, code: "TIMEOUT", message: "upstream" });

    const r = await reconcileOneTransaction("TXN1");
    expect(r).toMatchObject({ rail: "bbps", outcome: "noop" });
    expect(h.finalize).not.toHaveBeenCalled();
  });

  it("no-ops when the row has no provider ref to poll", async () => {
    h.findFirst.mockResolvedValue(bbpsRow({ partnerTxnId: null }));
    const r = await reconcileOneTransaction("TXN1");
    expect(r).toMatchObject({ rail: "bbps", outcome: "noop" });
    expect(h.bbpsStatus).not.toHaveBeenCalled();
  });
});

describe("reconcileOneTransaction — unsupported rail", () => {
  it("no-ops for rails finalized by their own pipelines (PG/POS/QR/payout)", async () => {
    h.findFirst.mockResolvedValue(
      txnRow({ partner: "RAZORPAY", service: "RECHARGE_MOBILE" })
    );
    const r = await reconcileOneTransaction("TXN1");
    expect(r).toMatchObject({ rail: "unsupported", outcome: "noop" });
    expect(h.reconcileRK).not.toHaveBeenCalled();
    expect(h.finalize).not.toHaveBeenCalled();
    expect(h.bbpsStatus).not.toHaveBeenCalled();
  });
});
