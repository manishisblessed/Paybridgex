import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/money";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * GET /api/network/earnings
 *
 * Returns the caller's commission earnings — aggregated and detailed.
 * Shows how much commission was earned from their own transactions
 * and from their downline's transactions.
 */
export async function GET(req: Request) {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize")) || 25));
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where: Record<string, unknown> = { userId: user.id };
  if (from || to) {
    const createdAt: Record<string, Date> = {};
    if (from) createdAt.gte = new Date(`${from}T00:00:00.000+05:30`);
    if (to) createdAt.lte = new Date(`${to}T23:59:59.999+05:30`);
    where.createdAt = createdAt;
  }

  const [total, credits, agg, serviceAgg, qrAgg, pgAgg] = await Promise.all([
    prisma.commissionCredit.count({ where }),
    prisma.commissionCredit.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        transaction: {
          select: { refId: true, service: true, amount: true, customer: true, userId: true },
        },
      },
    }),
    prisma.commissionCredit.aggregate({
      where: { userId: user.id },
      _sum: { amount: true, grossAmount: true, tdsAmount: true },
      _count: true,
    }),
    prisma.commissionCredit.groupBy({
      by: ["service"],
      where: { userId: user.id },
      _sum: { amount: true },
      _count: true,
    }),
    // QR and PG settlement commissions are booked against the WALLET_TOPUP
    // placeholder ServiceCode and identified by their synthetic Transaction refId
    // prefix ("QR…" / "PG…"), mirroring the admin earnings report. Split them out
    // of the WALLET_TOPUP bucket so the breakdown reads "QR/PG Settlement" rather
    // than "Wallet Top-up".
    prisma.commissionCredit.aggregate({
      where: { userId: user.id, service: "WALLET_TOPUP", transaction: { refId: { startsWith: "QR" } } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.commissionCredit.aggregate({
      where: { userId: user.id, service: "WALLET_TOPUP", transaction: { refId: { startsWith: "PG" } } },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  const qrAmount = toNumber(qrAgg._sum.amount ?? 0);
  const qrCount = qrAgg._count;
  const pgAmount = toNumber(pgAgg._sum.amount ?? 0);
  const pgCount = pgAgg._count;

  const byService: Array<{ service: string; amount: number; count: number }> = [];
  for (const s of serviceAgg) {
    if (s.service === "WALLET_TOPUP") {
      // Carve QR/PG out of the placeholder bucket; the remainder is genuine top-ups.
      const restAmount = toNumber(s._sum.amount ?? 0) - qrAmount - pgAmount;
      const restCount = s._count - qrCount - pgCount;
      if (restCount > 0) byService.push({ service: "WALLET_TOPUP", amount: restAmount, count: restCount });
    } else {
      byService.push({ service: s.service, amount: toNumber(s._sum.amount ?? 0), count: s._count });
    }
  }
  if (qrCount > 0) byService.push({ service: "QR", amount: qrAmount, count: qrCount });
  if (pgCount > 0) byService.push({ service: "PG", amount: pgAmount, count: pgCount });

  // A settlement-rail label for a credit: POS is first-class; QR/PG ride the
  // WALLET_TOPUP placeholder and are distinguished by their refId prefix.
  const railOf = (service: string, refId: string | null | undefined): string => {
    if (service === "WALLET_TOPUP" && refId) {
      if (refId.startsWith("QR")) return "QR";
      if (refId.startsWith("PG")) return "PG";
    }
    return service;
  };

  return NextResponse.json({
    totalEarnings: toNumber(agg._sum.amount ?? 0),
    totalGross: toNumber(agg._sum.grossAmount ?? 0),
    totalTds: toNumber(agg._sum.tdsAmount ?? 0),
    totalCredits: agg._count,
    byService,
    credits: credits.map((c) => ({
      id: c.id,
      tier: c.tier,
      amount: toNumber(c.amount),
      grossAmount: c.grossAmount !== null ? toNumber(c.grossAmount) : null,
      tdsAmount: toNumber(c.tdsAmount),
      service: railOf(c.service, c.transaction?.refId),
      txnAmount: toNumber(c.txnAmount),
      txnRefId: c.transaction?.refId,
      txnUserId: c.transaction?.userId,
      customer: c.transaction?.customer,
      createdAt: c.createdAt.toISOString(),
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  });
}
