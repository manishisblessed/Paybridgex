import { NextResponse } from "next/server";
import type { TxnStatus } from "@prisma/client";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { canAccessUser } from "@/lib/security/ownership";
import { formatISTDateTime } from "@/lib/utils";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

function displayStatus(status: TxnStatus): "Success" | "Pending" | "Failed" {
  if (status === "SUCCESS") return "Success";
  if (status === "FAILED" || status === "REFUNDED") return "Failed";
  return "Pending";
}

function formatService(service: string, operator: string | null): string {
  const label = service
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
  return operator ? `${label} - ${operator}` : label;
}

/**
 * GET /api/network/[id]/transactions
 *
 * A parent's window into a downline member's transaction history. Access is
 * scoped to the caller's downline (self + descendants); admins are
 * unrestricted. Supports the same status / free-text filters as the caller's
 * own transactions feed.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth();

    if (!(await canAccessUser(params.id, user))) {
      return NextResponse.json(
        { error: "This account is not in your network" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 200);
    const q = (searchParams.get("q") ?? "").trim();
    const statusFilter = searchParams.get("status");

    const where: Record<string, unknown> = { userId: params.id };

    if (statusFilter && statusFilter !== "All") {
      const map: Record<string, TxnStatus[]> = {
        Success: ["SUCCESS"],
        Pending: ["INITIATED", "PROCESSING"],
        Failed: ["FAILED", "REFUNDED"],
      };
      if (map[statusFilter]) where.status = { in: map[statusFilter] };
    }

    if (q) {
      where.OR = [
        { refId: { contains: q, mode: "insensitive" } },
        { customer: { contains: q, mode: "insensitive" } },
        { operator: { contains: q, mode: "insensitive" } },
      ];
    }

    const rows = await prisma.transaction.findMany({
      where: where as any,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // Per-transaction commission THIS member actually earned, from the
    // CommissionCredit ledger. Transaction.commission is not reliable here — on
    // POS/QR settlement bridge rows it holds the GROSS upline chain-commission
    // pool (credited to the upline, not this member), so it would misreport
    // another party's earnings on the member's own transactions.
    const txnIds = rows.map((t) => t.id);
    const creditRows = txnIds.length
      ? await prisma.commissionCredit.groupBy({
          by: ["transactionId"],
          where: { transactionId: { in: txnIds }, userId: params.id },
          _sum: { amount: true },
        })
      : [];
    const commissionByTxn = new Map(
      creditRows.map((c) => [c.transactionId, toNumber(c._sum.amount ?? 0)])
    );

    const data = rows.map((t) => ({
      id: t.refId,
      service: formatService(t.service, t.operator),
      amount: toNumber(t.amount),
      status: displayStatus(t.status),
      date: formatISTDateTime(t.createdAt),
      customer: t.customer ?? "—",
      commission: commissionByTxn.get(t.id) ?? 0,
    }));

    return NextResponse.json({ ok: true, data });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }
}
