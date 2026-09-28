import { describe, expect, it } from "vitest";
import { buildHoldingPeriods, resolveHolderFromPeriods } from "@/lib/pos/holder";
import { applyAssignment, AssignmentError } from "@/lib/pos/assignments";
import { classifyT1Due } from "@/lib/settlement/pos";
import { classifyMirrorReversal } from "@/lib/pos/mirror";
import { classifyPosSettlementFinding } from "@/lib/recon/posSettlement";

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

describe("classifyT1Due — cron settles only what's due for this run", () => {
  // Classic T+1: brand has no cutoff, so dueBoundary = start of today IST.
  const todayStart = d("2026-09-24T18:30:00Z"); // 25 Sep 00:00 IST — a run boundary
  const DAY = 24 * 60 * 60 * 1000;
  const yesterday = new Date(todayStart.getTime() - DAY / 2); // ~mid previous day
  const dayBefore = new Date(todayStart.getTime() - 1.5 * DAY); // ~mid day-before-yesterday
  const today = new Date(todayStart.getTime() + DAY / 4); // after the boundary

  it("settles the PREVIOUS day's captures (strict, catchUpDays=0)", () => {
    expect(classifyT1Due(yesterday, todayStart, 0)).toBe("DUE");
  });

  it("does NOT settle day-before-yesterday captures (strict) — leaves them STALE", () => {
    expect(classifyT1Due(dayBefore, todayStart, 0)).toBe("STALE");
  });

  it("holds captures not yet due (at/after the boundary)", () => {
    expect(classifyT1Due(today, todayStart, 0)).toBe("HELD");
  });

  it("absorbs one extra day of backlog when catchUpDays=1", () => {
    expect(classifyT1Due(dayBefore, todayStart, 1)).toBe("DUE");
    // Three days old is still stale even with a 1-day catch-up.
    const threeDaysOld = new Date(todayStart.getTime() - 2.5 * DAY);
    expect(classifyT1Due(threeDaysOld, todayStart, 1)).toBe("STALE");
  });

  it("respects a brand T+2 cutoff: after-cutoff captures settle on their T+2 day", () => {
    // Brand cutoff 18:00 IST → dueBoundary = todayStart - 6h.
    const dueBoundary = new Date(todayStart.getTime() - 6 * 60 * 60 * 1000);
    // A capture from day-before-yesterday, AFTER cutoff, is due on THIS (T+2) run.
    const t2 = new Date(dueBoundary.getTime() - DAY + 60 * 60 * 1000); // just inside the window
    expect(classifyT1Due(t2, dueBoundary, 0)).toBe("DUE");
    // A yesterday capture AFTER cutoff is not yet due — held for its T+2 run.
    const heldAfterCutoff = new Date(dueBoundary.getTime() + 60 * 60 * 1000);
    expect(classifyT1Due(heldAfterCutoff, dueBoundary, 0)).toBe("HELD");
  });
});

/**
 * Locks in the failed-swipe payout guard: a capture that briefly read CAPTURED
 * (so it queued a T+1 entry) but was then DECLINED must be reconciled, or the
 * cron pays the retailer for a failed transaction. Regression for the 28-Sep
 * ROHIT SONI ₹1,19,989 overpayment.
 */
describe("classifyMirrorReversal — failed-swipe payout guard", () => {
  it("reconciles a CAPTURED→FAILED downgrade (the bug)", () => {
    expect(classifyMirrorReversal("FAILED", "CAPTURED")).toBe("FAILED");
  });

  it("ignores a swipe that was FAILED from first sight (no entry ever queued)", () => {
    // No prior mirror row, or a prior non-captured state → nothing to cancel.
    expect(classifyMirrorReversal("FAILED", undefined)).toBeNull();
    expect(classifyMirrorReversal("FAILED", "AUTHORIZED")).toBeNull();
    expect(classifyMirrorReversal("FAILED", "FAILED")).toBeNull(); // re-sweep, already flipped
  });

  it("reconciles VOIDED/REFUNDED on any change into that state (incl. first sight)", () => {
    expect(classifyMirrorReversal("VOIDED", "CAPTURED")).toBe("VOIDED");
    expect(classifyMirrorReversal("REFUNDED", "CAPTURED")).toBe("REFUNDED");
    expect(classifyMirrorReversal("VOIDED", undefined)).toBe("VOIDED");
  });

  it("is idempotent — a re-sweep of an already-reversed row is a no-op", () => {
    expect(classifyMirrorReversal("VOIDED", "VOIDED")).toBeNull();
    expect(classifyMirrorReversal("REFUNDED", "REFUNDED")).toBeNull();
  });

  it("never treats a normal capture (or re-capture) as a reversal", () => {
    expect(classifyMirrorReversal("CAPTURED", undefined)).toBeNull();
    expect(classifyMirrorReversal("CAPTURED", "CAPTURED")).toBeNull();
    expect(classifyMirrorReversal("CAPTURED", "AUTHORIZED")).toBeNull();
  });

  it("is case-insensitive / whitespace tolerant on partner status strings", () => {
    expect(classifyMirrorReversal(" failed ", " captured ")).toBe("FAILED");
    expect(classifyMirrorReversal("refunded", "captured")).toBe("REFUNDED");
  });
});

/**
 * Locks in the nightly POS settlement tripwire: no money-active entry
 * (SETTLED/PENDING) may sit on a non-captured or missing mirror row.
 */
describe("classifyPosSettlementFinding — nightly settlement tripwire", () => {
  it("flags a money-active entry on a non-captured mirror", () => {
    expect(classifyPosSettlementFinding("SETTLED", "FAILED")).toBe("NON_CAPTURED");
    expect(classifyPosSettlementFinding("PENDING", "VOIDED")).toBe("NON_CAPTURED");
    expect(classifyPosSettlementFinding("SETTLED", "REFUNDED")).toBe("NON_CAPTURED");
    expect(classifyPosSettlementFinding("PENDING", "AUTHORIZED")).toBe("NON_CAPTURED");
  });

  it("flags a money-active entry with no mirror row as an ORPHAN", () => {
    expect(classifyPosSettlementFinding("SETTLED", null)).toBe("ORPHAN");
    expect(classifyPosSettlementFinding("PENDING", "")).toBe("ORPHAN");
    expect(classifyPosSettlementFinding("SETTLED", undefined)).toBe("ORPHAN");
  });

  it("does NOT flag a healthy settled/pending entry on a captured mirror", () => {
    expect(classifyPosSettlementFinding("SETTLED", "CAPTURED")).toBeNull();
    expect(classifyPosSettlementFinding("PENDING", "CAPTURED")).toBeNull();
  });

  it("does NOT flag a REVERSED entry — that is the correct resolved state", () => {
    expect(classifyPosSettlementFinding("REVERSED", "FAILED")).toBeNull();
    expect(classifyPosSettlementFinding("REVERSED", null)).toBeNull();
    expect(classifyPosSettlementFinding("FAILED", "FAILED")).toBeNull();
  });

  it("is case-insensitive / whitespace tolerant", () => {
    expect(classifyPosSettlementFinding(" settled ", " failed ")).toBe("NON_CAPTURED");
    expect(classifyPosSettlementFinding("pending", "captured")).toBeNull();
  });
});
