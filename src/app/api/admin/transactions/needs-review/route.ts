import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/security/ownership";
import { deriveTxnRefs } from "@/lib/recon/refs";
import { toNumber } from "@/lib/money";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/transactions/needs-review?page=1
 *
 * The review queue for payments HELD as NEEDS_REVIEW — an INDETERMINATE partner
 * pay response (lost / HTTP 5xx / timeout) where the provider may have charged.
 * These are NOT refunded; they await an authoritative resolution (the recon sweep
 * / webhook usually self-heal them, or an admin resolves via the provider status
 * API). Oldest first, so ops act on the longest-held exposure.
 */
export async function GET(req: Request) {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }
  if (!isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const pageSize = 25;
  const where = { status: "NEEDS_REVIEW" as const };

  const [rows, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        refId: true,
        service: true,
        partner: true,
        amount: true,
        fee: true,
        errorCode: true,
        errorMessage: true,
        createdAt: true,
        partnerTxnId: true,
        request: true,
        operator: true,
        customer: true,
        user: { select: { name: true, email: true, userCode: true } },
      },
    }),
    prisma.transaction.count({ where }),
  ]);

  const items = rows.map((r) => ({
    refId: r.refId,
    service: r.service,
    partner: r.partner,
    amount: toNumber(r.amount),
    fee: toNumber(r.fee),
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    createdAt: r.createdAt.toISOString(),
    partnerTxnId: r.partnerTxnId,
    billFetchRef: deriveTxnRefs({ request: r.request }).find(Boolean) ?? null,
    operator: r.operator,
    customer: r.customer,
    user: r.user ? { name: r.user.name, email: r.user.email, userCode: r.user.userCode } : null,
  }));

  // Exposure total across ALL held rows (not just this page).
  const exposureAgg = await prisma.transaction.aggregate({ where, _sum: { amount: true, fee: true } });
  const exposure = toNumber(exposureAgg._sum.amount ?? 0) + toNumber(exposureAgg._sum.fee ?? 0);

  return NextResponse.json({ items, total, page, pageSize, exposure });
}
