import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * runReconConnectivityMonitor — the mid-operation monitor that catches a
 * provider status API going dark (FORBIDDEN / IP de-whitelisted) WHILE the
 * worker keeps running, the case the boot-only preflight cannot see and where
 * sweeps keep "succeeding" but silently settle nothing.
 *
 * These tests lock the state-machine contract (probe → diff vs. last recorded
 * probe → alert only on change), with a single enabled rail (bbps):
 *   - newly blocked            → CRITICAL alert, recorded
 *   - still blocked            → NO alert (no state change), still recorded
 *   - recovered                → WARNING alert, recorded
 *   - "not found" business err → treated as reachable (healthy), NO alert
 */

const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
  bbpsStatus: vi.fn(),
  sendOpsAlert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    auditLog: {
      findFirst: (...a: unknown[]) => h.findFirst(...a),
      create: (...a: unknown[]) => h.create(...a),
    },
  },
}));
vi.mock("@/lib/env", () => ({ flags: { bbps: true, rechargekit: false, payout: false } }));
vi.mock("@/lib/partners", () => ({
  getPartner: () => ({ status: (...a: unknown[]) => h.bbpsStatus(...a) }),
}));
vi.mock("@/lib/partners/sameday-rechargekit", () => ({
  rechargekitConfigured: () => false,
  rechargekitStatus: vi.fn(),
}));
vi.mock("@/lib/partners/sameday-bbps", () => ({ samedayBbpsConfigured: () => true }));
vi.mock("@/lib/monitoring/alerts", () => ({ sendOpsAlert: (...a: unknown[]) => h.sendOpsAlert(...a) }));
vi.mock("@/lib/logger", () => ({
  logger: { child: () => ({ info() {}, warn() {}, error() {} }) },
}));

import { runReconConnectivityMonitor } from "@/lib/recon/preflight";

beforeEach(() => {
  vi.clearAllMocks();
  h.create.mockResolvedValue({});
});

describe("runReconConnectivityMonitor", () => {
  it("fires ONE critical alert when a rail newly goes unreachable", async () => {
    h.findFirst.mockResolvedValue(null); // no prior probe
    h.bbpsStatus.mockResolvedValue({ ok: false, code: "FORBIDDEN", message: "BBPS-2 not enabled" });

    const r = await runReconConnectivityMonitor();

    expect(r.newlyBlocked).toEqual(["bbps"]);
    expect(r.recovered).toEqual([]);
    expect(h.sendOpsAlert).toHaveBeenCalledTimes(1);
    expect(h.sendOpsAlert.mock.calls[0][0]).toMatchObject({ severity: "critical" });
    // the probe is recorded so the outage window is captured
    const created = h.create.mock.calls[0][0] as { data: { meta: { blocked: string[] } } };
    expect(created.data.meta.blocked).toEqual(["bbps"]);
  });

  it("stays silent when the rail was already blocked (no state change)", async () => {
    h.findFirst.mockResolvedValue({ meta: { blocked: ["bbps"] } });
    h.bbpsStatus.mockResolvedValue({ ok: false, code: "FORBIDDEN", message: "forbidden" });

    const r = await runReconConnectivityMonitor();

    expect(r.newlyBlocked).toEqual([]);
    expect(r.recovered).toEqual([]);
    expect(h.sendOpsAlert).not.toHaveBeenCalled();
    expect(h.create).toHaveBeenCalledTimes(1); // still recorded
  });

  it("fires a recovery warning when a blocked rail comes back", async () => {
    h.findFirst.mockResolvedValue({ meta: { blocked: ["bbps"] } });
    h.bbpsStatus.mockResolvedValue({ ok: true });

    const r = await runReconConnectivityMonitor();

    expect(r.newlyBlocked).toEqual([]);
    expect(r.recovered).toEqual(["bbps"]);
    expect(h.sendOpsAlert).toHaveBeenCalledTimes(1);
    expect(h.sendOpsAlert.mock.calls[0][0]).toMatchObject({ severity: "warning" });
  });

  it("treats an ordinary 'not found' business error as reachable (no alert)", async () => {
    h.findFirst.mockResolvedValue(null);
    h.bbpsStatus.mockResolvedValue({ ok: false, code: "ORDER_NOT_FOUND", message: "order not found" });

    const r = await runReconConnectivityMonitor();

    expect(r.blocked).toEqual([]);
    expect(r.newlyBlocked).toEqual([]);
    expect(h.sendOpsAlert).not.toHaveBeenCalled();
  });
});
