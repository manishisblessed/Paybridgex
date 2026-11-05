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
        refundEligibleAt: true,
        request: true,
        response: true,
        operator: true,
        customer: true,
        user: { select: { name: true, email: true, userCode: true, phone: true } },
      },
    }),
    prisma.transaction.count({ where }),
  ]);

  // Pull a trimmed string (or number coerced to string) from a loose JSON bag.
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;

  const items = rows.map((r) => {
    const req = (r.request ?? {}) as Record<string, unknown>;
    const res = (r.response ?? {}) as Record<string, unknown>;
    const cp = (req.customerParams ?? {}) as Record<string, unknown>;

    // References ops need to verify with the provider. The pay-step `request_id`
    // (SDS…) is returned in the RESPONSE; the `bill_fetch_ref` survives in both
    // the request (`customerParams.billFetchRef`) and the response. Fall back to
    // mining the full JSON so a row with an odd shape is still resolvable.
    const minedBoth = deriveTxnRefs({ request: r.request, response: r.response });
    const isSds = (s: string) => /^SDS/i.test(s);
    const requestId =
      str(res.request_id) ?? minedBoth.find(isSds) ?? null;
    const billFetchRef =
      str(res.bill_fetch_ref) ??
      str(cp.billFetchRef) ??
      str(cp.bill_fetch_ref) ??
      minedBoth.find((s) => !isSds(s)) ??
      null;
    const orderId = str(res.order_id) ?? null;

    return {
      refId: r.refId,
      service: r.service,
      partner: r.partner,
      amount: toNumber(r.amount),
      fee: toNumber(r.fee),
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      createdAt: r.createdAt.toISOString(),
      partnerTxnId: r.partnerTxnId,
      // When set, this row is a provider-confirmed failure whose refund is holding
      // in the cooling-off window; the reserve releases after this time + re-check.
      refundEligibleAt: r.refundEligibleAt?.toISOString() ?? null,
      // Provider verification handles (for the ops "verify with Request ID" flow).
      requestId,
      billFetchRef,
      orderId,
      // Biller / card details read back from the stored pay request.
      operator: r.operator, // biller product code (e.g. 4001)
      billerName: str(req.billerName), // e.g. "SBI CARD"
      customer: r.customer, // card last-4
      customerMobile: str(cp.customerNumber) ?? str(cp.mobile),
      cardholderName: str(req.customerName),
      user: r.user
        ? { name: r.user.name, email: r.user.email, userCode: r.user.userCode, phone: r.user.phone }
        : null,
    };
  });

  // Exposure total across ALL held rows (not just this page).
  const exposureAgg = await prisma.transaction.aggregate({ where, _sum: { amount: true, fee: true } });
  const exposure = toNumber(exposureAgg._sum.amount ?? 0) + toNumber(exposureAgg._sum.fee ?? 0);

  return NextResponse.json({ items, total, page, pageSize, exposure });
}
