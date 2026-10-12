import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Payout lifecycle state-machine contract.
 *
 * Locks the double-spend-safe invariants of the shared payout logic by mocking
 * the direct collaborators (in-memory PayoutRequest store, the ledger, and the
 * payout rail):
 *
 *   - APPROVED + provider PAID        → PROCESSING claim → SUCCESS, captureHold once
 *   - APPROVED + INDETERMINATE error  → NEEDS_REVIEW, hold RETAINED (no release)
 *   - APPROVED + DEFINITIVE decline   → FAILED, releaseHold once
 *   - PROCESSING row (not APPROVED)   → NEVER re-sends; reconciles instead (idempotency)
 *   - row already has providerTxnId   → NEVER re-sends; reconciles instead
 *   - finalizeSuccess on terminal row → idempotent no-op
 *   - resolveOnePayout force_*        → only acts on NEEDS_REVIEW; captures/releases
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => {
  const store = new Map<string, Row>();
  const provider = {
    name: "sameday_payout",
    payout: vi.fn(),
    status: vi.fn(),
    listRecent: vi.fn(),
  };
  const ledger = {
    captureHold: vi.fn(async (..._a: unknown[]) => {}),
    releaseHold: vi.fn(async (..._a: unknown[]) => {}),
    creditWallet: vi.fn(async (..._a: unknown[]) => {}),
  };
  return { store, provider, ledger };
});

function statusMatch(rowStatus: unknown, cond: unknown): boolean {
  if (cond === undefined) return true;
  if (typeof cond === "string") return rowStatus === cond;
  if (cond && typeof cond === "object" && "in" in (cond as object)) {
    return (cond as { in: string[] }).in.includes(rowStatus as string);
  }
  return true;
}

vi.mock("@/lib/db", () => {
  const payoutRequest = {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const r = h.store.get(where.id);
      return r ? { ...r } : null;
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const r = h.store.get(where.id);
      if (!r) throw new Error(`payout ${where.id} not found`);
      Object.assign(r, data);
      return { ...r };
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { id?: string; status?: unknown; providerTxnId?: unknown };
      data: Row;
    }) => {
      let count = 0;
      for (const r of h.store.values()) {
        if (where.id !== undefined && r.id !== where.id) continue;
        if (!statusMatch(r.status, where.status)) continue;
        if (where.providerTxnId !== undefined && r.providerTxnId !== where.providerTxnId) continue;
        Object.assign(r, data);
        count++;
      }
      return { count };
    },
    findFirst: async () => null, // no competing claim on a recovered reference
    findMany: async () => [] as Row[],
  };
  return {
    prisma: {
      payoutRequest,
      user: {
        findUnique: async () => ({ userCode: "RT1", phone: "9876543210" }),
      },
      auditLog: { create: async () => ({}) },
      $transaction: async <T>(fn: (tx: unknown) => Promise<T>) =>
        fn({ payoutRequest, auditLog: { create: async () => ({}) } }),
    },
  };
});

vi.mock("@/lib/ledger", () => ({
  captureHold: (...a: unknown[]) => h.ledger.captureHold(...a),
  releaseHold: (...a: unknown[]) => h.ledger.releaseHold(...a),
  creditWallet: (...a: unknown[]) => h.ledger.creditWallet(...a),
  LedgerError: class LedgerError extends Error {},
}));

vi.mock("@/lib/partners", () => ({
  getPartner: () => h.provider,
  assertRealMoneyProvider: () => {},
}));

vi.mock("@/lib/crypto/fieldEncryption", () => ({
  decryptField: (v: string) => v,
}));

vi.mock("@/lib/commission/revenue", () => ({
  creditServiceMargin: async () => {},
  reverseServiceMargin: async () => {},
}));

vi.mock("@/lib/partners/friendlyError", () => ({
  friendlyPartnerError: (_c: string, m: string) => m,
  isSensitivePartnerCode: () => false,
}));

vi.mock("@/lib/monitoring/alerts", () => ({ sendOpsAlert: async () => {} }));
vi.mock("@/lib/platform/webhooks", () => ({ emitWebhookEvent: async () => {} }));
vi.mock("@/lib/queue", () => ({ enqueue: async () => {}, QUEUES: { PAYOUT_INITIATE: "payout.initiate" } }));
vi.mock("@/lib/logger", () => ({
  logger: { warn: () => {}, info: () => {}, error: () => {}, child: () => ({ warn: () => {}, info: () => {}, error: () => {} }) },
}));

import {
  processPayoutInitiate,
  finalizePayoutSuccess,
  resolveOnePayout,
} from "@/lib/payout/service";

function seed(over: Row = {}): string {
  const id = (over.id as string) ?? "po_1";
  h.store.set(id, {
    id,
    userId: "u1",
    status: "APPROVED",
    mode: "IMPS",
    amount: 48000,
    totalDebit: 48000,
    serviceCharge: 10,
    vendorCharge: 4,
    beneficiaryName: "Ramesh",
    accountNumber: "enc-acct",
    accountLast4: "1234",
    ifsc: "enc-ifsc",
    providerReferenceId: "PO-REF-1",
    providerTxnId: null,
    utr: null,
    response: null,
    processedAt: null,
    createdAt: new Date(),
    ...over,
  });
  return id;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.store.clear();
  h.provider.status.mockResolvedValue({ ok: true, data: { status: "PROCESSING" } });
  h.provider.listRecent.mockResolvedValue({ ok: false });
});

describe("processPayoutInitiate — happy path", () => {
  it("sends once on APPROVED and settles to SUCCESS", async () => {
    const id = seed({ status: "APPROVED" });
    h.provider.payout.mockResolvedValue({
      ok: true,
      data: { status: "PAID", payoutId: "PX1", utr: "UTR1" },
      raw: {},
    });

    await processPayoutInitiate(id);

    expect(h.provider.payout).toHaveBeenCalledTimes(1);
    expect(h.store.get(id)!.status).toBe("SUCCESS");
    expect(h.ledger.captureHold).toHaveBeenCalledTimes(1);
    expect(h.ledger.releaseHold).not.toHaveBeenCalled();
  });
});

describe("processPayoutInitiate — indeterminate outcome", () => {
  it("holds as NEEDS_REVIEW and NEVER releases the hold", async () => {
    const id = seed({ status: "APPROVED" });
    h.provider.payout.mockResolvedValue({
      ok: false,
      indeterminate: true,
      code: "HTTP_503",
      message: "upstream unavailable",
    });

    await processPayoutInitiate(id);

    expect(h.provider.payout).toHaveBeenCalledTimes(1);
    expect(h.store.get(id)!.status).toBe("NEEDS_REVIEW");
    expect(h.ledger.releaseHold).not.toHaveBeenCalled();
    expect(h.ledger.captureHold).not.toHaveBeenCalled();
  });
});

describe("processPayoutInitiate — definitive decline", () => {
  it("fails and releases the hold back to spendable", async () => {
    const id = seed({ status: "APPROVED" });
    h.provider.payout.mockResolvedValue({
      ok: false,
      indeterminate: false,
      code: "HTTP_400",
      message: "account invalid",
    });

    await processPayoutInitiate(id);

    expect(h.store.get(id)!.status).toBe("FAILED");
    expect(h.ledger.releaseHold).toHaveBeenCalledTimes(1);
  });
});

describe("processPayoutInitiate — idempotency (no double send)", () => {
  it("never re-sends a row already in PROCESSING; reconciles instead", async () => {
    const id = seed({ status: "PROCESSING", providerTxnId: null });

    await processPayoutInitiate(id);

    expect(h.provider.payout).not.toHaveBeenCalled();
    // reconcile poll ran and left it (provider still PROCESSING)
    expect(h.provider.status).toHaveBeenCalled();
    expect(h.store.get(id)!.status).toBe("PROCESSING");
    expect(h.ledger.captureHold).not.toHaveBeenCalled();
  });

  it("never re-sends a row that already has a rail reference", async () => {
    const id = seed({ status: "PROCESSING", providerTxnId: "PX-EXISTING" });

    await processPayoutInitiate(id);

    expect(h.provider.payout).not.toHaveBeenCalled();
    expect(h.provider.status).toHaveBeenCalledWith("PX-EXISTING");
  });

  it("never re-sends a NEEDS_REVIEW row", async () => {
    const id = seed({ status: "NEEDS_REVIEW", providerTxnId: null });

    await processPayoutInitiate(id);

    expect(h.provider.payout).not.toHaveBeenCalled();
  });
});

describe("finalizePayoutSuccess — idempotent", () => {
  it("is a no-op on an already-terminal row", async () => {
    const id = seed({ status: "SUCCESS" });
    const r = await finalizePayoutSuccess(id, { utr: "X" });
    expect(r.finalized).toBe(false);
    expect(h.ledger.captureHold).not.toHaveBeenCalled();
  });
});

describe("resolveOnePayout — operator force actions", () => {
  it("force_failed releases the hold and marks FAILED (NEEDS_REVIEW only)", async () => {
    const id = seed({ status: "NEEDS_REVIEW" });
    const r = await resolveOnePayout(id, { actorId: "admin1", action: "force_failed", note: "bank did not pay" });
    expect(r.changed).toBe(true);
    expect(h.store.get(id)!.status).toBe("FAILED");
    expect(h.ledger.releaseHold).toHaveBeenCalledTimes(1);
  });

  it("force_paid captures the hold and marks SUCCESS", async () => {
    const id = seed({ status: "NEEDS_REVIEW" });
    const r = await resolveOnePayout(id, { actorId: "admin1", action: "force_paid", utr: "UTR9" });
    expect(r.changed).toBe(true);
    expect(h.store.get(id)!.status).toBe("SUCCESS");
    expect(h.ledger.captureHold).toHaveBeenCalledTimes(1);
  });

  it("refuses to act on a row that is not NEEDS_REVIEW", async () => {
    const id = seed({ status: "SUCCESS" });
    const r = await resolveOnePayout(id, { actorId: "admin1", action: "force_failed", note: "x" });
    expect(r.changed).toBe(false);
    expect(h.ledger.releaseHold).not.toHaveBeenCalled();
  });
});
