import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fakeDb";

/**
 * runTransaction tests — the orchestrator that wraps every partner call
 * (AePS, DMT, BBPS, recharge, PAN) in reserve → call → settle/refund.
 * Invariants: money is reserved before the partner is hit, failures refund
 * exactly what was reserved, retries replay instead of double-charging, and
 * risk rules can block before any money moves.
 */

const holder = vi.hoisted(() => ({ db: undefined as unknown as FakeDb }));

vi.mock("@/lib/db", () => ({
  prisma: new Proxy(
    {},
    { get: (_t, prop) => (holder.db as unknown as Record<PropertyKey, unknown>)[prop] }
  ),
}));

import { runTransaction } from "@/lib/services/transaction";
import { RiskError } from "@/lib/risk/engine";
import type { PartnerResult } from "@/lib/partners/types";

function baseInput(overrides: Partial<Parameters<typeof runTransaction>[0]> = {}) {
  return {
    userId: "u1",
    service: "RECHARGE_MOBILE" as const,
    amount: 100,
    fee: 2,
    commission: 3,
    idempotencyKey: "key-1",
    partner: "MOCK",
    request: { number: "9999999999" },
    call: async (): Promise<PartnerResult<{ ref: string }>> => ({
      ok: true,
      data: { ref: "OP123" },
      partnerTxnId: "OP123",
    }),
    ...overrides,
  };
}

beforeEach(() => {
  holder.db = new FakeDb();
  holder.db.addUser("u1", 1000);
  process.env.RISK_RULES_ENABLED = "true";
  delete process.env.RISK_DAILY_AMOUNT_CAP;
  delete process.env.RISK_HOURLY_TXN_CAP;
});

describe("runTransaction — success path", () => {
  it("debits amount+fee and marks SUCCESS; non-acquiring services earn no commission", async () => {
    // Commission is ONLY distributed for the acquiring rails (PG/POS/QR/UPI).
    // Service transactions like recharge earn NO commission even with a scheme.
    holder.db.users.delete("u1");
    holder.db.addUser("u1", 1000, 0, "ACTIVE", 0, { role: "RETAILER", schemeId: "s1" });
    holder.db.addScheme("s1", { service: "RECHARGE_MOBILE", commissionValue: 3 });

    const result = await runTransaction(baseInput());
    expect(result.status).toBe("SUCCESS");
    // 1000 − (100 + 2) = 898.00 (no commission for recharge)
    expect(holder.db.balanceOf("u1")).toBe("898.00");
    const txn = holder.db.transactions[0];
    expect(txn.status).toBe("SUCCESS");
    expect(txn.partnerTxnId).toBe("OP123");
    // Passbook: only the reserve DEBIT — no commission CREDIT.
    expect(holder.db.walletTxns).toHaveLength(1);
    expect(holder.db.commissionCredits).toHaveLength(0);
  });

  it("credits no commission when the user has no scheme (no hardcoded fallback)", async () => {
    await runTransaction(baseInput({ idempotencyKey: "key-zero" }));
    expect(holder.db.balanceOf("u1")).toBe("898.00");
    expect(holder.db.walletTxns).toHaveLength(1);
    expect(holder.db.commissionCredits).toHaveLength(0);
  });
});

describe("runTransaction — failure path", () => {
  it("refunds the full reservation when the partner declines", async () => {
    const result = await runTransaction(
      baseInput({
        idempotencyKey: "key-fail",
        call: async () => ({ ok: false, code: "DECLINED", message: "Operator down" }),
      })
    );
    expect(result.status).toBe("FAILED");
    // User sees a sanitized, friendly message — never the raw partner text.
    expect(result.error).not.toBe("Operator down");
    expect(result.error).toMatch(/try again/i);
    expect(holder.db.balanceOf("u1")).toBe("1000.00"); // fully refunded
    expect(holder.db.transactions[0].status).toBe("FAILED");
    // The RAW partner code is still persisted for support/reconciliation.
    expect(holder.db.transactions[0].errorCode).toBe("DECLINED");
  });

  it("refunds when the partner call throws", async () => {
    const result = await runTransaction(
      baseInput({
        idempotencyKey: "key-throw",
        call: async () => {
          throw new Error("socket hang up");
        },
      })
    );
    expect(result.status).toBe("FAILED");
    expect(holder.db.balanceOf("u1")).toBe("1000.00");
  });

  it("fails fast on insufficient balance without calling the partner", async () => {
    const call = vi.fn();
    const result = await runTransaction(
      baseInput({ amount: 5000, idempotencyKey: "key-poor", call })
    );
    expect(result.status).toBe("FAILED");
    expect(result.error).toMatch(/Insufficient/);
    expect(call).not.toHaveBeenCalled();
    expect(holder.db.balanceOf("u1")).toBe("1000.00");
  });
});

describe("runTransaction — idempotency", () => {
  it("replays the original result instead of charging twice", async () => {
    holder.db.users.delete("u1");
    holder.db.addUser("u1", 1000, 0, "ACTIVE", 0, { role: "RETAILER", schemeId: "s1" });
    holder.db.addScheme("s1", { service: "RECHARGE_MOBILE", commissionValue: 3 });

    const call = vi.fn(async () => ({ ok: true as const, data: { ref: "OP1" } }));
    await runTransaction(baseInput({ idempotencyKey: "key-dup", call }));
    const replay = await runTransaction(baseInput({ idempotencyKey: "key-dup", call }));
    expect(replay.status).toBe("SUCCESS");
    expect(call).toHaveBeenCalledTimes(1);
    // Charged exactly once: 1000 − 102 = 898.00 (recharge earns no commission).
    expect(holder.db.balanceOf("u1")).toBe("898.00");
  });
});

describe("runTransaction — risk rules", () => {
  it("blocks with RiskError before any money moves when a cap is exceeded", async () => {
    process.env.RISK_DAILY_AMOUNT_CAP = "50"; // attempted debit is 102
    const call = vi.fn();
    await expect(runTransaction(baseInput({ idempotencyKey: "key-risk", call }))).rejects.toThrow(
      RiskError
    );
    expect(call).not.toHaveBeenCalled();
    expect(holder.db.balanceOf("u1")).toBe("1000.00");
    expect(holder.db.walletTxns).toHaveLength(0);
  });

  it("does nothing when the engine is disabled", async () => {
    process.env.RISK_RULES_ENABLED = "false";
    process.env.RISK_DAILY_AMOUNT_CAP = "50";
    const result = await runTransaction(baseInput({ idempotencyKey: "key-off" }));
    expect(result.status).toBe("SUCCESS");
  });
});
