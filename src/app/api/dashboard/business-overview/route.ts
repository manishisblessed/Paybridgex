import { NextResponse } from "next/server";
import type { ServiceCode } from "@prisma/client";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { dec, toNumber } from "@/lib/money";
import { istDayBounds } from "@/lib/reports/daily";
import { BILL_SERVICE_CODES } from "@/lib/reports/registry";
import { getRevenueReport } from "@/lib/reports/revenue";
import { BUSINESS_OVERVIEW_TAB } from "@/lib/roles";
import {
  addServiceTotals,
  classifyPayout,
  classifyPg,
  classifyPos,
  classifyQr,
  classifyTxn,
  normalize,
  summarize,
} from "@/lib/dashboard/rails";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * Master-admin "Today's Business Overview" — platform-wide business done today
 * across the five headline rails (QR / POS / BBPS / PG / Payout), plus a compact
 * settlement / pending / revenue / growth summary.
 *
 * Additive, read-only aggregation. Each rail is read from its OWN source of
 * truth so the combined total never double-counts:
 *   QR     → QrClaim               (amount)
 *   POS    → PosSettlementEntry    (grossAmount)
 *   PG     → PgSettlementEntry     (grossAmount)
 *   BBPS   → Transaction (BILL_*)  (amount)
 *   Payout → PayoutRequest         (amount)
 * "Today" is the current IST business day (istDayBounds), matching the app's
 * existing reporting convention. For POS/PG the day is measured by the actual
 * transaction time (capturedAt, falling back to createdAt) so a capture that is
 * pull-ingested late still lands on its real business day.
 *
 * Statuses use each model's real status values, mapped to user-friendly
 * Success / Pending / Failed buckets. The headline rupee AMOUNT reflects
 * COMPLETED business only (successful / settled rows) so pending captures
 * awaiting settlement and failed/reversed rows never inflate the figure — the
 * transaction COUNT still reflects all activity, broken out by status.
 *
 * Access: master-admin always; ADMIN / SUPPORT (sub-admin) only when granted the
 * "business-overview" tab (User.allowedTabs) — the same permission mechanism the
 * rest of the admin workspace uses.
 */

function canView(user: { role: string; allowedTabs?: string[] | null }): boolean {
  if (user.role === "MASTER_ADMIN") return true;
  if (user.role === "ADMIN" || user.role === "SUPPORT") {
    return (user.allowedTabs ?? []).includes(BUSINESS_OVERVIEW_TAB);
  }
  return false;
}

type Window = { dayStart: Date; dayEnd: Date };

/** Per-rail business done within a window. */
async function aggregateServices(w: Window) {
  const range = { gte: w.dayStart, lte: w.dayEnd };
  // POS/PG record the real transaction time on capturedAt; bucket by it so a
  // late pull-ingested capture lands on its true business day (legacy rows with
  // no capturedAt fall back to createdAt). Mirrors the settlement crons.
  const capturedRange = {
    OR: [{ capturedAt: range }, { capturedAt: null, createdAt: range }],
  };

  const [qrRows, posRows, pgRows, bbpsRows, payoutRows] = await Promise.all([
    prisma.qrClaim.groupBy({
      by: ["status"],
      where: { createdAt: range },
      _count: true,
      _sum: { amount: true },
    }),
    prisma.posSettlementEntry.groupBy({
      by: ["status"],
      where: capturedRange,
      _count: true,
      _sum: { grossAmount: true },
    }),
    prisma.pgSettlementEntry.groupBy({
      by: ["status"],
      where: capturedRange,
      _count: true,
      _sum: { grossAmount: true },
    }),
    prisma.transaction.groupBy({
      by: ["status"],
      where: {
        service: { in: BILL_SERVICE_CODES as unknown as ServiceCode[] },
        createdAt: range,
      },
      _count: true,
      _sum: { amount: true },
    }),
    prisma.payoutRequest.groupBy({
      by: ["status"],
      where: { createdAt: range },
      _count: true,
      _sum: { amount: true },
    }),
  ]);

  const qr = summarize(normalize(qrRows as never, "amount"), classifyQr);
  const pos = summarize(normalize(posRows as never, "grossAmount"), classifyPos);
  const pg = summarize(normalize(pgRows as never, "grossAmount"), classifyPg);
  const bbps = summarize(normalize(bbpsRows as never, "amount"), classifyTxn);
  const payout = summarize(normalize(payoutRows as never, "amount"), classifyPayout);
  const total = addServiceTotals([qr, pos, bbps, pg, payout]);

  return { qr, pos, bbps, pg, payout, total };
}

/** Net actually settled into wallets today (settledAt in window) across rails. */
async function aggregateSettlementToday(w: Window): Promise<number> {
  const range = { gte: w.dayStart, lte: w.dayEnd };
  const [pos, pg, qr] = await Promise.all([
    prisma.posSettlementEntry.aggregate({
      where: { status: "SETTLED", settledAt: range },
      _sum: { netAmount: true },
    }),
    prisma.pgSettlementEntry.aggregate({
      where: { status: "SETTLED", settledAt: range },
      _sum: { netAmount: true },
    }),
    prisma.qrClaim.aggregate({
      where: { status: "SETTLED", settledAt: range },
      _sum: { netAmount: true },
    }),
  ]);
  return (
    toNumber(dec(pos._sum.netAmount ?? 0)) +
    toNumber(dec(pg._sum.netAmount ?? 0)) +
    toNumber(dec(qr._sum.netAmount ?? 0))
  );
}

/**
 * Net still owed from TODAY's business — the portion of today's captures that has
 * not yet settled into wallets. Time-boxed to the same IST day as the rest of the
 * overview so every figure on the panel answers "today".
 */
async function aggregatePendingToday(w: Window): Promise<number> {
  const range = { gte: w.dayStart, lte: w.dayEnd };
  const capturedRange = {
    OR: [{ capturedAt: range }, { capturedAt: null, createdAt: range }],
  };
  const [pos, pg, qr] = await Promise.all([
    prisma.posSettlementEntry.aggregate({
      where: { status: "PENDING", ...capturedRange },
      _sum: { netAmount: true },
    }),
    prisma.pgSettlementEntry.aggregate({
      where: { status: "PENDING", ...capturedRange },
      _sum: { netAmount: true },
    }),
    prisma.qrClaim.aggregate({
      where: { status: "SETTLEABLE", createdAt: range },
      _sum: { amount: true },
    }),
  ]);
  return (
    toNumber(dec(pos._sum.netAmount ?? 0)) +
    toNumber(dec(pg._sum.netAmount ?? 0)) +
    toNumber(dec(qr._sum.amount ?? 0))
  );
}

type GrowthState = "new" | "flat" | "up" | "down";

function computeGrowth(today: number, yesterday: number): { pct: number | null; state: GrowthState } {
  if (yesterday <= 0) {
    return today > 0 ? { pct: null, state: "new" } : { pct: 0, state: "flat" };
  }
  const raw = ((today - yesterday) / yesterday) * 100;
  const pct = Math.round(raw * 10) / 10;
  return { pct, state: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}

export async function GET() {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  if (!canView(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const today = istDayBounds();
    const yesterday = istDayBounds(new Date(Date.now() - 24 * 60 * 60 * 1000));

    const [todayAgg, yAgg, settlementToday, pendingAmount, commissionRevenue] = await Promise.all([
      aggregateServices(today),
      aggregateServices(yesterday),
      aggregateSettlementToday(today),
      aggregatePendingToday(today),
      getRevenueReport({ from: today.ymd, to: today.ymd })
        .then((r) => r.totals.platformRevenue)
        .catch(() => 0),
    ]);

    const growth = computeGrowth(todayAgg.total.amount, yAgg.total.amount);

    return NextResponse.json({
      date: today.ymd,
      total: todayAgg.total,
      qr: todayAgg.qr,
      pos: todayAgg.pos,
      bbps: todayAgg.bbps,
      pg: todayAgg.pg,
      payout: todayAgg.payout,
      summary: {
        settlementToday: Math.round(settlementToday * 100) / 100,
        pendingAmount: Math.round(pendingAmount * 100) / 100,
        commissionRevenue: Math.round(commissionRevenue * 100) / 100,
        yesterdayTotal: yAgg.total.amount,
        growthPct: growth.pct,
        growthState: growth.state,
      },
    });
  } catch (e) {
    console.error("[dashboard/business-overview] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
