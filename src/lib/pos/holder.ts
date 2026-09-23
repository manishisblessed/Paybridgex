import { prisma } from "@/lib/db";

/**
 * POS holder attribution — the SINGLE source of truth for "who owned this
 * terminal when a swipe was captured".
 *
 * A POS capture belongs to whoever HELD the terminal at the moment of the
 * swipe — never merely whoever holds it now. This is money-critical: a machine
 * freshly assigned to a retailer must NOT retroactively settle swipes taken
 * before the assignment (those belong to the previous holder, or to nobody when
 * the terminal was still in stock).
 *
 * Every assignment/unassignment is recorded in `PosAssignmentLog` as a holding
 * window [assignedDate, returnedDate) — non-overlapping, since reassigning
 * closes the previous window. The still-open window (returnedDate = null) is the
 * current holder. We resolve a swipe's owner by finding the window that contains
 * its capture time.
 *
 * This module is consumed by BOTH the settlement engine (money) and
 * enrich.ts / scopePosTerminals (display + visibility), so attribution can never
 * drift between what the dashboard shows and where the money goes.
 */

/** A contiguous period a single user held a terminal. `end = null` = still held. */
export type HoldingPeriod = { userId: string; start: Date; end: Date | null };

/** The resolved rightful owner of a capture, plus the machine pricing context. */
export type ResolvedHolder = {
  userId: string;
  machineId: string;
  brandId: string | null;
  provider: string | null;
  company: string | null;
};

type AssignLogRow = {
  toUserId: string | null;
  assignedDate: Date | null;
  createdAt: Date;
  returnedDate: Date | null;
};

type MachineForPeriods = {
  assignedUserId: string | null;
  assignedAt: Date | null;
  assignmentLogs: AssignLogRow[];
};

/** Prisma nested-relation selector for the assignment log rows we need. */
const assignmentLogsArg = {
  where: { action: "assign", toUserId: { not: null } },
  select: {
    toUserId: true,
    assignedDate: true,
    createdAt: true,
    returnedDate: true,
  },
  orderBy: { createdAt: "asc" },
} as const;

/**
 * Build the non-overlapping holding windows for one machine from its assignment
 * ledger. Falls back to the current open-ended assignment (assignedUserId +
 * assignedAt) when the machine has no log rows (legacy / pre-ledger assignment),
 * so a currently-assigned terminal is always attributable even before its first
 * log entry exists.
 */
export function buildHoldingPeriods(m: MachineForPeriods): HoldingPeriod[] {
  const periods: HoldingPeriod[] = [];
  for (const log of m.assignmentLogs) {
    if (!log.toUserId) continue;
    periods.push({
      userId: log.toUserId,
      start: log.assignedDate ?? log.createdAt,
      end: log.returnedDate,
    });
  }
  if (periods.length === 0 && m.assignedUserId && m.assignedAt) {
    periods.push({ userId: m.assignedUserId, start: m.assignedAt, end: null });
  }
  return periods;
}

/**
 * Resolve which user held the terminal at instant `at`, or null when no window
 * contains it (swipe predates every assignment / terminal was in stock). Scans
 * newest-first so the most recent matching window wins on any boundary overlap.
 */
export function resolveHolderFromPeriods(periods: HoldingPeriod[], at: Date): string | null {
  for (let i = periods.length - 1; i >= 0; i--) {
    const p = periods[i];
    if (at >= p.start && (p.end === null || at <= p.end)) return p.userId;
  }
  return null;
}

/**
 * Load the holding windows for a set of terminal IDs in one query, keyed by
 * `tid`. `PosMachine.tid` is not unique, so windows from every machine sharing a
 * TID are merged — the caller resolves across the union. Used by the settlement
 * sweep to gate thousands of captures without a per-row DB hit.
 */
export async function loadHoldingPeriodsByTid(tids: string[]): Promise<Map<string, HoldingPeriod[]>> {
  const map = new Map<string, HoldingPeriod[]>();
  if (tids.length === 0) return map;

  const machines = await prisma.posMachine.findMany({
    where: { tid: { in: tids } },
    select: {
      tid: true,
      assignedUserId: true,
      assignedAt: true,
      assignmentLogs: assignmentLogsArg,
    },
  });

  for (const m of machines) {
    if (!m.tid) continue;
    const periods = buildHoldingPeriods(m);
    const existing = map.get(m.tid);
    if (existing) existing.push(...periods);
    else map.set(m.tid, periods);
  }
  return map;
}

/**
 * Resolve the rightful holder (+ machine pricing context) for a capture on
 * terminal `tid` at time `at`. Returns null when no assignment window covers the
 * capture — the caller MUST refuse to auto-settle in that case. When multiple
 * machines share a TID, the machine whose window covers `at` wins.
 */
export async function resolvePosHolderAt(tid: string, at: Date): Promise<ResolvedHolder | null> {
  const machines = await prisma.posMachine.findMany({
    where: { tid },
    select: {
      id: true,
      brandId: true,
      provider: true,
      company: true,
      assignedUserId: true,
      assignedAt: true,
      assignmentLogs: assignmentLogsArg,
    },
  });

  for (const m of machines) {
    const userId = resolveHolderFromPeriods(buildHoldingPeriods(m), at);
    if (userId) {
      return { userId, machineId: m.id, brandId: m.brandId, provider: m.provider, company: m.company };
    }
  }
  return null;
}

/**
 * Resolve the rightful holder for a capture bound to an EXACT machine id at time
 * `at`. Preferred over the TID lookup whenever the machine is known (e.g. manual
 * slips), since `PosMachine.tid` is not unique. Returns null when no assignment
 * window covers the capture.
 */
export async function resolvePosHolderForMachine(
  machineId: string,
  at: Date
): Promise<ResolvedHolder | null> {
  const m = await prisma.posMachine.findUnique({
    where: { id: machineId },
    select: {
      id: true,
      brandId: true,
      provider: true,
      company: true,
      assignedUserId: true,
      assignedAt: true,
      assignmentLogs: assignmentLogsArg,
    },
  });
  if (!m) return null;

  const userId = resolveHolderFromPeriods(buildHoldingPeriods(m), at);
  if (!userId) return null;
  return { userId, machineId: m.id, brandId: m.brandId, provider: m.provider, company: m.company };
}
