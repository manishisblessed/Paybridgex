import { NextResponse } from "next/server";
import type { ServiceCode } from "@prisma/client";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { dec, toNumber } from "@/lib/money";
import { istDayBounds } from "@/lib/reports/daily";
import {
  addServiceTotals,
  classifyPayout,
  classifyPg,
  classifyPos,
  classifyQr,
  classifyTxn,
  normalize,
  round2,
  summarize,
  type ServiceToday,
} from "@/lib/dashboard/rails";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * Retailer "Today's Business" — a retailer's OWN transaction activity for the
 * day (they are the leaf that actually transacts), across all rails, so they get
 * the same at-a-glance summary their upline sees for them:
 *   Transaction (isSettlement=false, real user services) → recharge / DMT / AEPS
 *     / BBPS / UPI collect / travel …  grouped per ServiceCode
 *   PosSettlementEntry → POS   PgSettlementEntry → PG   QrClaim → QR
 *   PayoutRequest      → Payout (an OUTFLOW; reported separately)
 *
 * Money follows the app convention: headline volume is COMPLETED business only
 * (success/settled); counts cover every status. "Today" defaults to the current
 * IST business day; a from/to range is supported. Scope is strictly `userId =
 * self`, so this never leaks anyone else's data.
 */

const EXCLUDED_TXN_SERVICES = [
  "PAYOUT",
  "UPI_PAYOUT",
  "WALLET_TOPUP",
  "WALLET_WITHDRAW",
  "POS",
  "QR",
] as unknown as ServiceCode[];

/** Title-case a ServiceCode enum value: RECHARGE_MOBILE → "Recharge Mobile". */
function serviceLabel(service: string): string {
  return service
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

export async function GET(req: Request) {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  // Self-service summary — meant for the transacting leaf (retailer). Other roles
  // have their own platform / network overviews.
  if (user.role !== "RETAILER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const today = istDayBounds();
    const fromYmd = searchParams.get("from") || today.ymd;
    const toYmd = searchParams.get("to") || today.ymd;
    const dayStart = istDayBounds(fromYmd).dayStart;
    const dayEnd = istDayBounds(toYmd).dayEnd;
    const range = { gte: dayStart, lte: dayEnd };
    const capturedRange = {
      OR: [{ capturedAt: range }, { capturedAt: null, createdAt: range }],
    };

    const self = { userId: user.id };

    const [txnByService, posRows, pgRows, qrRows, payoutRows, commissionAgg, pendingSettle] =
      await Promise.all([
        prisma.transaction.groupBy({
          by: ["service", "status"],
          where: {
            ...self,
            isSettlement: false,
            service: { notIn: EXCLUDED_TXN_SERVICES },
            createdAt: range,
          },
          _count: true,
          _sum: { amount: true },
        }),
        prisma.posSettlementEntry.groupBy({
          by: ["status"],
          where: { ...self, ...capturedRange },
          _count: true,
          _sum: { grossAmount: true },
        }),
        prisma.pgSettlementEntry.groupBy({
          by: ["status"],
          where: { ...self, ...capturedRange },
          _count: true,
          _sum: { grossAmount: true },
        }),
        prisma.qrClaim.groupBy({
          by: ["status"],
          where: { ...self, createdAt: range },
          _count: true,
          _sum: { amount: true },
        }),
        prisma.payoutRequest.groupBy({
          by: ["status"],
          where: { ...self, createdAt: range },
          _count: true,
          _sum: { amount: true },
        }),
        prisma.transaction.aggregate({
          where: {
            ...self,
            isSettlement: false,
            service: { notIn: EXCLUDED_TXN_SERVICES },
            status: "SUCCESS",
            createdAt: range,
          },
          _sum: { commission: true },
        }),
        // Net still awaiting settlement into their wallet from today's captures.
        Promise.all([
          prisma.posSettlementEntry.aggregate({
            where: { ...self, status: "PENDING", ...capturedRange },
            _sum: { netAmount: true },
          }),
          prisma.pgSettlementEntry.aggregate({
            where: { ...self, status: "PENDING", ...capturedRange },
            _sum: { netAmount: true },
          }),
          prisma.qrClaim.aggregate({
            where: { ...self, status: "SETTLEABLE", createdAt: range },
            _sum: { amount: true },
          }),
        ]),
      ]);

    // Service-wise breakdown: transaction rail per ServiceCode + POS/PG/QR.
    const serviceRows = new Map<
      string,
      Array<{ status: string; _count: number; _sum: Record<string, unknown> }>
    >();
    for (const r of txnByService as Array<{
      service: string;
      status: string;
      _count: number;
      _sum: Record<string, unknown>;
    }>) {
      const key = String(r.service);
      const arr = serviceRows.get(key) ?? [];
      arr.push({ status: String(r.status), _count: r._count, _sum: r._sum });
      serviceRows.set(key, arr);
    }

    const breakdown: Array<{ service: string; label: string } & ServiceToday> = [];
    for (const [service, rows] of serviceRows) {
      const st = summarize(normalize(rows as never, "amount"), classifyTxn);
      if (st.count > 0) breakdown.push({ service, label: serviceLabel(service), ...st });
    }
    const pos = summarize(normalize(posRows as never, "grossAmount"), classifyPos);
    const pg = summarize(normalize(pgRows as never, "grossAmount"), classifyPg);
    const qr = summarize(normalize(qrRows as never, "amount"), classifyQr);
    if (pos.count > 0) breakdown.push({ service: "POS", label: "POS", ...pos });
    if (pg.count > 0) breakdown.push({ service: "PG", label: "Payment Gateway", ...pg });
    if (qr.count > 0) breakdown.push({ service: "QR", label: "QR Collections", ...qr });
    breakdown.sort((a, b) => b.amount - a.amount || b.count - a.count);

    const total = addServiceTotals(breakdown);
    const payout = summarize(normalize(payoutRows as never, "amount"), classifyPayout);
    const [posP, pgP, qrP] = pendingSettle;
    const pendingSettlement = round2(
      toNumber(dec(posP._sum.netAmount ?? 0)) +
        toNumber(dec(pgP._sum.netAmount ?? 0)) +
        toNumber(dec(qrP._sum.amount ?? 0))
    );

    return NextResponse.json({
      range: { from: fromYmd, to: toYmd },
      total,
      serviceBreakdown: breakdown,
      summary: {
        successCount: total.success,
        pendingCount: total.pending,
        failedCount: total.failed,
        totalVolume: total.amount,
        totalCommission: round2(toNumber(dec(commissionAgg._sum.commission ?? 0))),
        payout,
        pendingSettlement,
      },
    });
  } catch (e) {
    console.error("[dashboard/my-business-overview] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
