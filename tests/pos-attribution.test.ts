import { describe, expect, it } from "vitest";
import { buildHoldingPeriods, resolveHolderFromPeriods } from "@/lib/pos/holder";
import { applyAssignment, AssignmentError } from "@/lib/pos/assignments";

/**
 * Locks in the money-critical POS attribution rule: a capture belongs to
 * whoever HELD the terminal at swipe time — never merely the current assignee.
 * This is the core of the pre-assignment settlement-leak fix.
 */

const d = (iso: string) => new Date(iso);

describe("POS holder attribution (capture-time windows)", () => {
  it("does NOT attribute pre-assignment swipes to a freshly-assigned holder", () => {
    // Terminal came from stock; assigned to RT-A on 23 Sep 00:03.
    const periods = buildHoldingPeriods({
      assignedUserId: "rtA",
      assignedAt: d("2026-09-23T00:03:48Z"),
      assignmentLogs: [
        { toUserId: "rtA", assignedDate: d("2026-09-23T00:03:48Z"), createdAt: d("2026-09-23T00:03:48Z"), returnedDate: null },
      ],
    });

    // A swipe the previous day (stock era) → belongs to NOBODY.
    expect(resolveHolderFromPeriods(periods, d("2026-09-22T14:00:00Z"))).toBeNull();
    // A swipe a minute before assignment → still NOBODY.
    expect(resolveHolderFromPeriods(periods, d("2026-09-23T00:02:00Z"))).toBeNull();
    // A swipe after assignment → RT-A.
    expect(resolveHolderFromPeriods(periods, d("2026-09-23T11:00:00Z"))).toBe("rtA");
  });

  it("attributes each swipe to the holder of its window across a reassignment", () => {
    const periods = buildHoldingPeriods({
      assignedUserId: "rtB",
      assignedAt: d("2026-09-10T00:00:00Z"),
      assignmentLogs: [
        // RT-A held it 1–10 Sep, then it moved to RT-B (open window).
        { toUserId: "rtA", assignedDate: d("2026-09-01T00:00:00Z"), createdAt: d("2026-09-01T00:00:00Z"), returnedDate: d("2026-09-10T00:00:00Z") },
        { toUserId: "rtB", assignedDate: d("2026-09-10T00:00:00Z"), createdAt: d("2026-09-10T00:00:00Z"), returnedDate: null },
      ],
    });

    expect(resolveHolderFromPeriods(periods, d("2026-09-05T12:00:00Z"))).toBe("rtA"); // A's era
    expect(resolveHolderFromPeriods(periods, d("2026-09-15T12:00:00Z"))).toBe("rtB"); // B's era
    expect(resolveHolderFromPeriods(periods, d("2025-01-01T00:00:00Z"))).toBeNull(); // before anyone
  });

  it("keeps attributing to a past holder after the machine is unassigned (returned to stock)", () => {
    const periods = buildHoldingPeriods({
      assignedUserId: null, // currently in stock
      assignedAt: null,
      assignmentLogs: [
        { toUserId: "rtA", assignedDate: d("2026-09-01T00:00:00Z"), createdAt: d("2026-09-01T00:00:00Z"), returnedDate: d("2026-09-20T00:00:00Z") },
      ],
    });

    // Swipe during A's window still resolves to A, so their T+1 money is safe.
    expect(resolveHolderFromPeriods(periods, d("2026-09-05T00:00:00Z"))).toBe("rtA");
    // Swipe after A returned it → nobody (stock).
    expect(resolveHolderFromPeriods(periods, d("2026-09-25T00:00:00Z"))).toBeNull();
  });

  it("falls back to the live assignment when no ledger rows exist (legacy)", () => {
    const periods = buildHoldingPeriods({
      assignedUserId: "rtLegacy",
      assignedAt: d("2026-09-01T00:00:00Z"),
      assignmentLogs: [],
    });
    expect(resolveHolderFromPeriods(periods, d("2026-09-02T00:00:00Z"))).toBe("rtLegacy");
    expect(resolveHolderFromPeriods(periods, d("2026-08-31T00:00:00Z"))).toBeNull();
  });

  it("treats window boundaries inclusively (swipe exactly at assignment time)", () => {
    const periods = buildHoldingPeriods({
      assignedUserId: "rtA",
      assignedAt: d("2026-09-23T00:03:48Z"),
      assignmentLogs: [
        { toUserId: "rtA", assignedDate: d("2026-09-23T00:03:48Z"), createdAt: d("2026-09-23T00:03:48Z"), returnedDate: null },
      ],
    });
    expect(resolveHolderFromPeriods(periods, d("2026-09-23T00:03:48Z"))).toBe("rtA");
  });
});

/**
 * Mock Prisma transaction client that captures the assignment-log create payload
 * and serves a fixed set of prior "returned" windows to the backdate validator.
 */
function mockTx(priorReturned: Array<{ returnedDate: Date }>) {
  const created: Record<string, unknown>[] = [];
  const tx = {
    posMachine: { update: async (_args: unknown) => ({ id: "m1" }) },
    posAssignmentLog: {
      findMany: async (_args: unknown) => priorReturned,
      updateMany: async (_args: unknown) => ({ count: 0 }),
      create: async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return args.data;
      },
    },
  } as never;
  return { tx, created };
}

describe("applyAssignment — audited effective-from backdate guardrails", () => {
  const base = { machineId: "m1", byUserId: "admin1", toUserId: "rtNew" as string | null };

  it("stamps the backdated window start when assigning from stock into the stock gap", async () => {
    // Terminal last returned to stock on 20 Sep; backdate the new window to 21 Sep.
    const { tx, created } = mockTx([{ returnedDate: d("2026-09-20T00:00:00Z") }]);
    await applyAssignment(tx, {
      ...base,
      fromUserId: null, // from stock
      effectiveFrom: d("2026-09-21T08:00:00Z"),
    });
    const assign = created.find((c) => c.action === "assign")!;
    expect((assign.assignedDate as Date).toISOString()).toBe("2026-09-21T08:00:00.000Z");
  });

  it("refuses a backdate that reaches into a previous holder's period", async () => {
    const { tx } = mockTx([{ returnedDate: d("2026-09-20T00:00:00Z") }]);
    await expect(
      applyAssignment(tx, {
        ...base,
        fromUserId: null,
        effectiveFrom: d("2026-09-19T00:00:00Z"), // before the last return → overlap
      })
    ).rejects.toBeInstanceOf(AssignmentError);
  });

  it("refuses to backdate a live reassignment (terminal currently held)", async () => {
    const { tx } = mockTx([]);
    await expect(
      applyAssignment(tx, {
        ...base,
        fromUserId: "rtOld", // currently held → would overlap the current holder
        effectiveFrom: d("2026-09-01T00:00:00Z"),
      })
    ).rejects.toBeInstanceOf(AssignmentError);
  });

  it("refuses a future effective-from", async () => {
    const { tx } = mockTx([]);
    await expect(
      applyAssignment(tx, {
        ...base,
        fromUserId: null,
        effectiveFrom: new Date(Date.now() + 3 * 60 * 60 * 1000), // 3h ahead
      })
    ).rejects.toBeInstanceOf(AssignmentError);
  });

  it("defaults the window start to ~now when no effective-from is given", async () => {
    const { tx, created } = mockTx([]);
    const before = Date.now();
    await applyAssignment(tx, { ...base, fromUserId: null });
    const assign = created.find((c) => c.action === "assign")!;
    const stamped = (assign.assignedDate as Date).getTime();
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);
  });
});
