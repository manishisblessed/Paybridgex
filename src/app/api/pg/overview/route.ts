/**
 * GET /api/pg/overview
 *
 * Returns today's PG settlement stats + recent transactions for the logged-in
 * retailer — used by the PG dashboard page.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { prisma } from "@/lib/db";
import { startOfTodayIst } from "@/lib/settlement/engine";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  let user: { id: string };
  try {
    user = await requireAuth();
  } catch (e) {
    return toErrorResponse(e);
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = 20;

  const todayStart = startOfTodayIst();

  const [todayRows, allRows, total] = await Promise.all([
    // Today's settled entries for stats
    prisma.pgSettlementEntry.findMany({
      where: { userId: user.id, status: "SETTLED", createdAt: { gte: todayStart } },
      select: { grossAmount: true, mdrAmount: true, netAmount: true },
    }),
    // Paginated history
    prisma.pgSettlementEntry.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        transactionRef: true,
        grossAmount: true,
        mdrAmount: true,
        netAmount: true,
        status: true,
        mode: true,
        paymentMode: true,
        provider: true,
        createdAt: true,
        settledAt: true,
      },
    }),
    prisma.pgSettlementEntry.count({ where: { userId: user.id } }),
  ]);

  const todayGross  = todayRows.reduce((s, r) => s + Number(r.grossAmount), 0);
  const todayMdr    = todayRows.reduce((s, r) => s + Number(r.mdrAmount),   0);
  const todayNet    = todayRows.reduce((s, r) => s + Number(r.netAmount),   0);
  const todayCount  = todayRows.length;

  return NextResponse.json({
    today: { gross: todayGross, mdr: todayMdr, net: todayNet, count: todayCount },
    transactions: allRows.map((r) => ({
      id: r.id,
      ref: r.transactionRef,
      gross: Number(r.grossAmount),
      mdr: Number(r.mdrAmount),
      net: Number(r.netAmount),
      status: r.status,
      mode: r.mode,
      paymentMode: r.paymentMode ?? "UPI",
      provider: r.provider ?? "CHAGANS_PG",
      createdAt: r.createdAt.toISOString(),
      settledAt: r.settledAt?.toISOString() ?? null,
    })),
    pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
  });
}
