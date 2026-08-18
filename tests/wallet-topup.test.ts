import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fakeDb";

/**
 * Wallet top-up lifecycle tests — the invariant under test: a wallet credit
 * happens EXACTLY ONCE per top-up, only after the provider confirms PAID,
 * no matter how many times the webhook / status poll / user retries race.
 */

const holder = vi.hoisted(() => ({
  db: undefined as unknown as FakeDb,
  collectResult: undefined as unknown as Record<string, unknown>,
  statusResult: undefined as unknown as Record<string, unknown>,
}));

vi.mock("@/lib/db", () => ({
  prisma: new Proxy(
    {},
    { get: (_t, prop) => (holder.db as unknown as Record<PropertyKey, unknown>)[prop] }
  ),
}));

vi.mock("@/lib/partners", () => ({
  getPartner: () => ({
    name: "FAKE_PG",
    collect: async () => holder.collectResult,
    status: async () => holder.statusResult,
  }),
  // FAKE_PG is a real (non-mock) provider double, so the money-provider guard
  // is a no-op here; provide it so the mocked module mirrors the real exports.
  assertRealMoneyProvider: () => {},
}));

import { initiateTopup, settleTopup, TopupError } from "@/lib/wallet/topup";

beforeEach(() => {
  holder.db = new FakeDb();
  holder.db.addUser("u1", 500);
  holder.collectResult = {
    ok: true,
    data: { orderId: "BPTR001", paymentUrl: "https://pay.example/x" },
  };
  holder.statusResult = { ok: true, data: { status: "PAID" } };
});

describe("initiateTopup", () => {
  it("creates a PROCESSING transaction and returns the payment handle", async () => {
    const r = await initiateTopup({ userId: "u1", amount: 250, customerPhone: "9999999999" });
    expect(r.refId).toMatch(/^TOPUP/);
    expect(r.paymentUrl).toBe("https://pay.example/x");
    expect(r.provider).toBe("FAKE_PG");
    const txn = holder.db.transactions[0];
    expect(txn.status).toBe("PROCESSING");
    expect(txn.partnerTxnId).toBe("BPTR001");
    // No money moves at initiate time.
    expect(holder.db.balanceOf("u1")).toBe("500.00");
  });

  it("marks the transaction FAILED and throws when the provider declines", async () => {
    holder.collectResult = { ok: false, code: "PG_DOWN", message: "gateway offline" };
    await expect(
      initiateTopup({ userId: "u1", amount: 250, customerPhone: "9999999999" })
    ).rejects.toThrow(TopupError);
    expect(holder.db.transactions[0].status).toBe("FAILED");
    expect(holder.db.balanceOf("u1")).toBe("500.00");
  });
});

describe("settleTopup", () => {
  it("credits the wallet once the provider reports PAID", async () => {
    const { refId } = await initiateTopup({ userId: "u1", amount: 250, customerPhone: "9999999999" });
    const r = await settleTopup(refId);
    expect(r.status).toBe("SUCCESS");
    expect(holder.db.balanceOf("u1")).toBe("750.00");
    expect(holder.db.transactions[0].status).toBe("SUCCESS");
  });

  it("credits exactly once when settled repeatedly (webhook + poll race)", async () => {
    const { refId } = await initiateTopup({ userId: "u1", amount: 250, customerPhone: "9999999999" });
    await settleTopup(refId);
    await settleTopup(refId);
    await settleTopup(refId);
    expect(holder.db.balanceOf("u1")).toBe("750.00");
    expect(holder.db.walletTxns).toHaveLength(1);
  });

  it("does not credit while the provider still reports pending", async () => {
    holder.statusResult = { ok: true, data: { status: "CREATED" } };
    const { refId } = await initiateTopup({ userId: "u1", amount: 250, customerPhone: "9999999999" });
    const r = await settleTopup(refId);
    expect(r.status).toBe("PROCESSING");
    expect(holder.db.balanceOf("u1")).toBe("500.00");
  });

  it("marks FAILED (and never credits) on provider failure/expiry", async () => {
    holder.statusResult = { ok: true, data: { status: "EXPIRED" } };
    const { refId } = await initiateTopup({ userId: "u1", amount: 250, customerPhone: "9999999999" });
    const r = await settleTopup(refId);
    expect(r.status).toBe("FAILED");
    expect(holder.db.balanceOf("u1")).toBe("500.00");
    // Terminal: a later PAID report must not resurrect it via the normal path.
    holder.statusResult = { ok: true, data: { status: "PAID" } };
    const again = await settleTopup(refId);
    expect(again.status).toBe("FAILED");
    expect(holder.db.balanceOf("u1")).toBe("500.00");
  });

  it("404s on unknown references", async () => {
    await expect(settleTopup("TOPUPUNKNOWN")).rejects.toThrow("Top-up not found");
  });
});
