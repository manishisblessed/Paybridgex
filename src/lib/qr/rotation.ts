/**
 * Static QR priority-queue rotation with per-QR daily caps.
 *
 * Retailers collect first on the lowest-`priority` **enabled** QR that still has
 * headroom for the current IST day. They also see that QR's remaining rupees
 * (and the next queued QR) so a payment larger than what's left can be split:
 * take the remainder on the live QR, the rest on the overflow QR. When a QR
 * fills its daily cap (gross value of non-rejected claims filed today ≥
 * `dailyLimit`, and/or claim count ≥ `dailyLimitCount`) it is auto-paused and
 * the overflow QR is promoted to live.
 *
 * Because the QR rail has no provider webhook, "collected today" can only be
 * measured from claims retailers FILE (see `./claims`). It therefore lags the
 * real bank credit and can overshoot before the switch fires — set each
 * `dailyLimit` a little below the true hard ceiling as a safety margin.
 *
 * Daily reset is implicit: `autoPausedOn` stores the instant a QR filled up; a
 * request on a later IST day clears it (the day's claims no longer count), so
 * the QR automatically rejoins the queue at its priority. Concurrency is handled
 * exactly like the rest of the QR code — `updateMany` guards inside a
 * transaction keep the "at most one active QR" invariant race-safe.
 */
import type { StaticQr } from "@prisma/client";
import { prisma } from "../db";
import { startOfTodayIst } from "../settlement/engine";

export type QrUsage = { amount: number; count: number };

/** Gross value + count of the QR's non-rejected claims filed in the current IST day. */
export async function collectedToday(qrId: string): Promise<QrUsage> {
  const dayStart = startOfTodayIst();
  const agg = await prisma.qrClaim.aggregate({
    _sum: { amount: true },
    _count: { _all: true },
    where: { qrId, createdAt: { gte: dayStart }, status: { not: "REJECTED" } },
  });
  return { amount: Number(agg._sum.amount ?? 0), count: agg._count._all };
}

/** Same as `collectedToday` but for many QRs at once (one grouped query). */
export async function collectedTodayMap(qrIds: string[]): Promise<Map<string, QrUsage>> {
  const map = new Map<string, QrUsage>();
  if (qrIds.length === 0) return map;
  const dayStart = startOfTodayIst();
  const rows = await prisma.qrClaim.groupBy({
    by: ["qrId"],
    where: { qrId: { in: qrIds }, createdAt: { gte: dayStart }, status: { not: "REJECTED" } },
    _sum: { amount: true },
    _count: { _all: true },
  });
  for (const id of qrIds) map.set(id, { amount: 0, count: 0 });
  for (const r of rows) map.set(r.qrId, { amount: Number(r._sum.amount ?? 0), count: r._count._all });
  return map;
}

/** Has this QR reached (or passed) either of its daily caps? Null caps never bind. */
export function isOverDailyLimit(qr: Pick<StaticQr, "dailyLimit" | "dailyLimitCount">, used: QrUsage): boolean {
  const overAmount = qr.dailyLimit != null && used.amount >= Number(qr.dailyLimit);
  const overCount = qr.dailyLimitCount != null && used.count >= qr.dailyLimitCount;
  return overAmount || overCount;
}

/**
 * Is this QR within `ratio` of either daily cap? Highlights the remaining-amount
 * meter when a switch (or a split onto the overflow QR) is likely.
 */
export function isNearDailyLimit(
  qr: Pick<StaticQr, "dailyLimit" | "dailyLimitCount">,
  used: QrUsage,
  ratio = 0.8
): boolean {
  const nearAmount = qr.dailyLimit != null && Number(qr.dailyLimit) > 0 && used.amount >= ratio * Number(qr.dailyLimit);
  const nearCount = qr.dailyLimitCount != null && qr.dailyLimitCount > 0 && used.count >= ratio * qr.dailyLimitCount;
  return nearAmount || nearCount;
}

export type QrHeadroom = {
  collected: number;
  collectedCount: number;
  dailyLimit: number | null;
  dailyLimitCount: number | null;
  /** Rupees still collectable today; null = no amount cap on this QR. */
  remainingAmount: number | null;
  /** Claims still collectable today; null = no count cap on this QR. */
  remainingCount: number | null;
};

/** Remaining daily capacity on a QR (shared across every retailer collecting on it). */
export function qrHeadroom(
  qr: Pick<StaticQr, "dailyLimit" | "dailyLimitCount">,
  used: QrUsage
): QrHeadroom {
  const dailyLimit = qr.dailyLimit != null ? Number(qr.dailyLimit) : null;
  const dailyLimitCount = qr.dailyLimitCount ?? null;
  return {
    collected: used.amount,
    collectedCount: used.count,
    dailyLimit,
    dailyLimitCount,
    remainingAmount: dailyLimit != null ? Math.max(0, Math.round((dailyLimit - used.amount) * 100) / 100) : null,
    remainingCount: dailyLimitCount != null ? Math.max(0, dailyLimitCount - used.count) : null,
  };
}

export type RetailerQrPayload = {
  id: string;
  label: string;
  upiVpa: string | null;
  imageUrl: string;
  activatedAt: string;
  nearFull: boolean;
  headroom: QrHeadroom;
};

export function toRetailerQrPayload(qr: StaticQr, used: QrUsage): RetailerQrPayload {
  return {
    id: qr.id,
    label: qr.label,
    upiVpa: qr.upiVpa,
    imageUrl: qr.imageUrl,
    activatedAt: qr.createdAt.toISOString(),
    nearFull: isNearDailyLimit(qr, used),
    headroom: qrHeadroom(qr, used),
  };
}

/**
 * Next enabled QR after the live one that still has headroom today — the QR
 * retailers should collect the overflow (amount above the live QR's remaining)
 * on. Does not mutate queue state; call after `resolveLiveQr`.
 */
export async function peekOverflowQr(liveId: string): Promise<StaticQr | null> {
  const candidates = await prisma.staticQr.findMany({
    where: { enabled: true, autoPausedOn: null, id: { not: liveId } },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  for (const qr of candidates) {
    const used = await collectedToday(qr.id);
    if (isOverDailyLimit(qr, used)) continue;
    return qr;
  }
  return null;
}

/**
 * True when `qrId` is the overflow QR currently shown beside the live one, so
 * a retailer can file a claim for the rest of a split payment before rotation
 * promotes it. Does not call `resolveLiveQr` (that has side effects).
 */
export async function isOverflowCollectQr(qrId: string): Promise<boolean> {
  const live = await prisma.staticQr.findFirst({
    where: { active: true, enabled: true },
    select: { id: true },
  });
  if (!live || live.id === qrId) return false;
  const overflow = await peekOverflowQr(live.id);
  return overflow?.id === qrId;
}

export type QrLiveState = "LIVE" | "QUEUED" | "FULL_TODAY" | "DISABLED";

/** Categorize a QR for admin display given its usage today. */
export function qrLiveState(
  qr: Pick<StaticQr, "enabled" | "active" | "autoPausedOn" | "dailyLimit" | "dailyLimitCount">,
  used: QrUsage
): QrLiveState {
  if (!qr.enabled) return "DISABLED";
  if (qr.active) return "LIVE";
  const pausedToday = qr.autoPausedOn != null && qr.autoPausedOn.getTime() >= startOfTodayIst().getTime();
  if (pausedToday || isOverDailyLimit(qr, used)) return "FULL_TODAY";
  return "QUEUED";
}

/**
 * Resolve — and persist — the single QR retailers should collect on right now.
 *
 * Walks enabled QRs by ascending priority, auto-pausing any that have filled
 * their daily cap, and makes the first one with headroom the sole `active` QR.
 * Returns that QR, or null when the whole pool is exhausted for the day (the
 * caller should then tell retailers collections are paused).
 */
export async function resolveLiveQr(): Promise<StaticQr | null> {
  const dayStart = startOfTodayIst();

  // Daily reset: clear auto-pauses set on an earlier IST day so those QRs rejoin
  // the queue. (A QR paused earlier TODAY stays paused for the rest of the day,
  // even if a later rejection freed capacity — conservative by design.)
  await prisma.staticQr.updateMany({
    where: { autoPausedOn: { lt: dayStart } },
    data: { autoPausedOn: null },
  });

  const candidates = await prisma.staticQr.findMany({
    where: { enabled: true, autoPausedOn: null },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });

  for (const qr of candidates) {
    const used = await collectedToday(qr.id);
    if (isOverDailyLimit(qr, used)) {
      // Filled today → auto-pause and fall through to the next-priority QR.
      await prisma.staticQr.updateMany({
        where: { id: qr.id, autoPausedOn: null },
        data: { autoPausedOn: new Date(), active: false, disabledAt: new Date() },
      });
      continue;
    }

    // Winner. Make it the sole live QR (race-safe: guard both writes).
    await prisma.$transaction(async (tx) => {
      await tx.staticQr.updateMany({
        where: { active: true, id: { not: qr.id } },
        data: { active: false, disabledAt: new Date() },
      });
      await tx.staticQr.updateMany({
        where: { id: qr.id, active: false },
        data: { active: true, disabledAt: null, disabledById: null },
      });
    });

    return { ...qr, active: true, disabledAt: null, disabledById: null };
  }

  // Pool exhausted — make sure nothing is left showing as live.
  await prisma.staticQr.updateMany({
    where: { active: true },
    data: { active: false, disabledAt: new Date() },
  });
  return null;
}
