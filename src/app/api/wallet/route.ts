import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { buildBreakdowns } from "@/lib/wallet/breakdown";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const dbUser = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { walletBalance: true },
  });

  // Light mode for the topbar poller — skips the txn/aggregate queries.
  const { searchParams } = new URL(req.url);
  if (searchParams.get("balanceOnly") === "1") {
    return NextResponse.json({ balance: Number(dbUser.walletBalance) });
  }

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [monthlyAgg, recentTxns] = await Promise.all([
    prisma.walletTxn.groupBy({
      by: ["direction"],
      where: { userId: user.id, createdAt: { gte: startOfMonth } },
      _sum: { amount: true },
    }),
    prisma.walletTxn.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const monthlyIn = Number(
    monthlyAgg.find((a) => a.direction === "CREDIT")?._sum.amount ?? 0
  );
  const monthlyOut = Number(
    monthlyAgg.find((a) => a.direction === "DEBIT")?._sum.amount ?? 0
  );

  const breakdownOf = await buildBreakdowns(recentTxns);

  return NextResponse.json({
    balance: Number(dbUser.walletBalance),
    monthlyIn,
    monthlyOut,
    recentTxns: recentTxns.map((t) => {
      const b = breakdownOf(t);
      return {
        id: t.id,
        direction: t.direction,
        reason: t.reason,
        txnAmount: b.txnAmount,
        charges: b.charges,
        amount: Number(t.amount),
        balanceAfter: Number(t.balanceAfter),
        note: t.note,
        refType: t.refType,
        refId: t.refId,
        createdAt: t.createdAt.toISOString(),
      };
    }),
  });
}
