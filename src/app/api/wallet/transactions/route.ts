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

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const pageSize = Math.min(
    500,
    Math.max(1, Number(searchParams.get("pageSize") ?? 20))
  );
  const direction = searchParams.get("direction"); // CREDIT | DEBIT
  const reason = searchParams.get("reason");
  const q = searchParams.get("q")?.trim();

  const where: Record<string, unknown> = { userId: user.id };
  if (direction === "CREDIT" || direction === "DEBIT") where.direction = direction;
  if (reason) where.reason = reason;
  if (q) {
    where.OR = [
      { note: { contains: q, mode: "insensitive" } },
      { refId: { contains: q, mode: "insensitive" } },
      { refType: { contains: q, mode: "insensitive" } },
    ];
  }

  const [txns, total] = await Promise.all([
    prisma.walletTxn.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.walletTxn.count({ where }),
  ]);

  const breakdownOf = await buildBreakdowns(txns);

  return NextResponse.json({
    txns: txns.map((t) => {
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
    total,
    page,
    pageSize,
  });
}
