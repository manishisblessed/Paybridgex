import { NextResponse } from "next/server";
import type { Prisma, ServiceCode, TxnStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApiKey } from "@/lib/platform/apiKeys";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { toNumber } from "@/lib/money";

/**
 * Partner API v1 — GET /api/v1/transactions
 * Scope: txn.read
 * Query: limit (1-100, default 25), status, service, cursor (transaction id)
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const STATUSES = new Set(["INITIATED", "PROCESSING", "SUCCESS", "FAILED", "REFUNDED"]);

export async function GET(req: Request) {
  try {
    const { user } = await requireApiKey(req, ["txn.read"]);
    const url = new URL(req.url);

    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 25, 1), 100);
    const status = url.searchParams.get("status")?.toUpperCase();
    const service = url.searchParams.get("service")?.toUpperCase();
    const cursor = url.searchParams.get("cursor");

    const where: Prisma.TransactionWhereInput = { userId: user.id };
    if (status) {
      if (!STATUSES.has(status)) {
        return NextResponse.json({ ok: false, error: { code: "BAD_REQUEST", message: `Unknown status: ${status}` } }, { status: 400 });
      }
      where.status = status as TxnStatus;
    }
    if (service) where.service = service as ServiceCode;

    const rows = await prisma.transaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    // Per-transaction commission the API key owner actually earned, from the
    // CommissionCredit ledger. Transaction.commission is not reliable here — on
    // POS/QR settlement bridge rows it holds the GROSS upline chain-commission
    // pool (credited to the upline, not this user), so exposing it would report
    // another party's earnings on the partner's own transactions.
    const txnIds = page.map((t) => t.id);
    const creditRows = txnIds.length
      ? await prisma.commissionCredit.groupBy({
          by: ["transactionId"],
          where: { transactionId: { in: txnIds }, userId: user.id },
          _sum: { amount: true },
        })
      : [];
    const commissionByTxn = new Map(
      creditRows.map((c) => [c.transactionId, toNumber(c._sum.amount ?? 0)])
    );

    return NextResponse.json({
      ok: true,
      data: page.map((t) => ({
        refId: t.refId,
        service: t.service,
        status: t.status,
        amount: toNumber(t.amount),
        fee: toNumber(t.fee),
        commission: commissionByTxn.get(t.id) ?? 0,
        customer: t.customer,
        operator: t.operator,
        errorCode: t.errorCode,
        errorMessage: t.errorMessage,
        createdAt: t.createdAt.toISOString(),
      })),
      pagination: { nextCursor: hasMore ? page[page.length - 1].id : null },
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
