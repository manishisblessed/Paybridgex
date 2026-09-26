import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * recoverRefsFromApiLog — the crash-proof fallback that recovers a stranded
 * transaction's provider poll key (request_id/order_id/txn_id) from the durable
 * PartnerApiLog when it was lost from the Transaction itself (process died
 * between the pay call and persisting the response).
 *
 * These tests lock the contract by mocking the PartnerApiLog lookup:
 *   - blank refId              → [] and NO DB call
 *   - explicit providerRef     → returned, de-duped
 *   - providerRef null         → mined from the raw response JSON
 *   - newest-first + de-dup    → stable, unique, priority-ordered
 */

const h = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: { partnerApiLog: { findMany: (...a: unknown[]) => h.findMany(...a) } },
}));

import { recoverRefsFromApiLog } from "@/lib/recon/recover";

beforeEach(() => vi.clearAllMocks());

describe("recoverRefsFromApiLog", () => {
  it("returns [] and does not hit the DB for a blank refId", async () => {
    expect(await recoverRefsFromApiLog("")).toEqual([]);
    expect(await recoverRefsFromApiLog(null)).toEqual([]);
    expect(await recoverRefsFromApiLog(undefined)).toEqual([]);
    expect(h.findMany).not.toHaveBeenCalled();
  });

  it("returns the stored providerRef when present", async () => {
    h.findMany.mockResolvedValue([{ providerRef: "SDS123", response: null }]);
    expect(await recoverRefsFromApiLog("TXN1")).toEqual(["SDS123"]);
    // scoped to the transaction, newest first
    const arg = h.findMany.mock.calls[0][0] as { where: Record<string, unknown>; orderBy: unknown };
    expect(arg.where).toMatchObject({ txnRefId: "TXN1" });
  });

  it("mines the reference from the raw response when providerRef is null", async () => {
    h.findMany.mockResolvedValue([
      { providerRef: null, response: { success: true, request_id: "SDS999", order_id: "P2N_PAY_1" } },
    ]);
    const refs = await recoverRefsFromApiLog("TXN1");
    expect(refs).toEqual(expect.arrayContaining(["SDS999", "P2N_PAY_1"]));
  });

  it("de-dupes across rows and keeps unique refs only", async () => {
    h.findMany.mockResolvedValue([
      { providerRef: "SDS999", response: { request_id: "SDS999" } },
      { providerRef: "SDS999", response: { txn_id: "TXNPROV" } },
    ]);
    const refs = await recoverRefsFromApiLog("TXN1");
    expect(refs).toEqual(["SDS999", "TXNPROV"]);
  });

  it("ignores blank/whitespace providerRef values", async () => {
    h.findMany.mockResolvedValue([{ providerRef: "   ", response: null }]);
    expect(await recoverRefsFromApiLog("TXN1")).toEqual([]);
  });
});
