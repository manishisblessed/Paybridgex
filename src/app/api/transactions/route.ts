import { NextResponse } from "next/server";
import { z } from "zod";
import type { TxnStatus } from "@prisma/client";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { enforceRateLimit, RATE_LIMITS, RateLimitError } from "@/lib/security/rateLimit";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { formatISTDateTime } from "@/lib/utils";
import { isAdminRole } from "@/lib/security/ownership";
import { txnCategoryWhere } from "@/lib/services/txnCategories";
import {
  payoutDisplayStatus,
  payoutServiceLabel,
  payoutCustomerLabel,
  PAYOUT_STATUS_GROUPS,
} from "@/lib/payout/display";

const CreateBody = z.object({
  service: z.string().trim().min(1).max(64).optional(),
  amount: z.number().nonnegative().max(500000).optional(),
});

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
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 200);
  const q = (searchParams.get("q") ?? "").trim();
  const statusFilter = searchParams.get("status");
  const serviceFilter = searchParams.get("service");
  const userFilter = (searchParams.get("user") ?? "").trim();
  const userIdFilter = (searchParams.get("userId") ?? "").trim();

  const isAdmin = isAdminRole(user.role);
  const where: Record<string, unknown> = isAdmin ? {} : { userId: user.id };
  // AND is accumulated so the (optional) user-filter, service-category, and
  // free-text search each constrain the result independently.
  const and: Record<string, unknown>[] = [];

  if (statusFilter && statusFilter !== "All") {
    const map: Record<string, TxnStatus[]> = {
      Success: ["SUCCESS"],
      Pending: ["INITIATED", "PROCESSING"],
      Failed: ["FAILED", "REFUNDED"],
    };
    if (map[statusFilter]) where.status = { in: map[statusFilter] };
  }

  // Payouts live on PayoutRequest, NOT the Transaction table — so the "Payout"
  // service category is served by folding PayoutRequest rows into the feed.
  //  - service = "PAYOUT"        → payouts ONLY
  //  - service = another category → transactions ONLY (no payouts)
  //  - service = "All"/unset      → both, merged and sorted by date
  const isPayoutCategory = serviceFilter === "PAYOUT";
  const isOtherCategory =
    !!serviceFilter && serviceFilter !== "All" && !isPayoutCategory;
  const wantTxns = !isPayoutCategory;
  const wantPayouts = !isOtherCategory;

  // Service-category filter (POS / QR / BBPS / Credit Card / CC-2). PAYOUT is
  // handled via the PayoutRequest branch below, not as a Transaction constraint.
  const categoryWhere = isPayoutCategory ? null : txnCategoryWhere(serviceFilter);
  if (categoryWhere) and.push(categoryWhere);

  // Exact user match (admins only) — used by the Role → User dropdown so a
  // specific selected account is isolated regardless of name collisions.
  if (isAdmin && userIdFilter) {
    and.push({ userId: userIdFilter });
  }

  // Filter by originating user — admins only, so a retailer can't probe other
  // accounts. Matches user name / userCode / phone (partial, case-insensitive).
  if (isAdmin && userFilter) {
    and.push({
      user: {
        is: {
          OR: [
            { name: { contains: userFilter, mode: "insensitive" } },
            { userCode: { contains: userFilter, mode: "insensitive" } },
            { phone: { contains: userFilter, mode: "insensitive" } },
          ],
        },
      },
    });
  }

  if (q) {
    const or: Record<string, unknown>[] = [
      { refId: { contains: q, mode: "insensitive" } },
      { customer: { contains: q, mode: "insensitive" } },
      { operator: { contains: q, mode: "insensitive" } },
    ];
    // Admins can also match the free-text search against the originating user
    // (name / code) so a name typed into the main search box works too.
    if (isAdmin) {
      or.push({
        user: {
          is: {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { userCode: { contains: q, mode: "insensitive" } },
            ],
          },
        },
      });
    }
    and.push({ OR: or });
  }

  if (and.length) where.AND = and;

  // ── PayoutRequest where clause — mirrors the transaction filters above so a
  //    payout is subject to the same status / user / search constraints. ──────
  const payoutWhere: Record<string, unknown> = isAdmin
    ? {}
    : { userId: user.id };
  const payoutAnd: Record<string, unknown>[] = [];

  if (statusFilter && statusFilter !== "All") {
    const grp = PAYOUT_STATUS_GROUPS[statusFilter];
    if (grp) payoutWhere.status = { in: grp };
  }

  if (isAdmin && userIdFilter) payoutAnd.push({ userId: userIdFilter });

  if (isAdmin && userFilter) {
    payoutAnd.push({
      user: {
        is: {
          OR: [
            { name: { contains: userFilter, mode: "insensitive" } },
            { userCode: { contains: userFilter, mode: "insensitive" } },
            { phone: { contains: userFilter, mode: "insensitive" } },
          ],
        },
      },
    });
  }

  if (q) {
    const por: Record<string, unknown>[] = [
      { beneficiaryName: { contains: q, mode: "insensitive" } },
      { accountLast4: { contains: q, mode: "insensitive" } },
      { utr: { contains: q, mode: "insensitive" } },
      { providerReferenceId: { contains: q, mode: "insensitive" } },
    ];
    if (isAdmin) {
      por.push({
        user: {
          is: {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { userCode: { contains: q, mode: "insensitive" } },
            ],
          },
        },
      });
    }
    payoutAnd.push({ OR: por });
  }

  if (payoutAnd.length) payoutWhere.AND = payoutAnd;

  const [txnRows, payoutRows] = await Promise.all([
    wantTxns
      ? prisma.transaction.findMany({
          where: where as any,
          orderBy: { createdAt: "desc" },
          take: limit,
          include: isAdmin
            ? { user: { select: { name: true, userCode: true } } }
            : undefined,
        })
      : Promise.resolve([]),
    wantPayouts
      ? prisma.payoutRequest.findMany({
          where: payoutWhere as any,
          orderBy: { createdAt: "desc" },
          take: limit,
          include: isAdmin
            ? { user: { select: { name: true, userCode: true } } }
            : undefined,
        })
      : Promise.resolve([]),
  ]);

  // Retailers do not see commission on the transaction feed: on settlement rails
  // (POS/QR/PG) the `commission` on their bridge txn is the UPLINE's distributed
  // commission, not the retailer's income, so surfacing it here is misleading.
  // The retailer's genuine earnings live on the dedicated "My Earnings" page
  // (sourced from CommissionCredit). Zero it out so it isn't even sent client-side.
  const hideCommission = user.role === "RETAILER";

  // Merge both sources into one shape, carrying a hidden sort timestamp so the
  // combined feed stays newest-first before we trim to `limit`.
  type FeedRow = {
    id: string;
    service: string;
    amount: number;
    status: "Success" | "Pending" | "Failed";
    date: string;
    customer: string;
    commission: number;
    user?: string;
    userCode?: string;
    _ts: number;
  };

  const txnData: FeedRow[] = txnRows.map((t) => {
    const u = (t as { user?: { name: string; userCode: string | null } }).user;
    return {
      id: t.refId,
      service: formatService(t.service, t.operator),
      amount: toNumber(t.amount),
      status: displayStatus(t.status),
      date: formatISTDateTime(t.createdAt),
      customer: t.customer ?? "—",
      commission: hideCommission ? 0 : toNumber(t.commission),
      ...(isAdmin && u
        ? { user: u.name, userCode: u.userCode ?? undefined }
        : {}),
      _ts: t.createdAt.getTime(),
    };
  });

  const payoutData: FeedRow[] = payoutRows.map((p) => {
    const u = (p as { user?: { name: string; userCode: string | null } }).user;
    return {
      // The payout's own id — the receipt route falls back to PayoutRequest on
      // this id so the Receipt button works for payout rows too.
      id: p.id,
      service: payoutServiceLabel(p.mode),
      amount: toNumber(p.amount),
      status: payoutDisplayStatus(p.status),
      date: formatISTDateTime(p.createdAt),
      customer: payoutCustomerLabel(p.beneficiaryName, p.accountLast4),
      // Payouts never distribute a per-txn commission (see commission cascade).
      commission: 0,
      ...(isAdmin && u
        ? { user: u.name, userCode: u.userCode ?? undefined }
        : {}),
      _ts: p.createdAt.getTime(),
    };
  });

  const data = [...txnData, ...payoutData]
    .sort((a, b) => b._ts - a._ts)
    .slice(0, limit)
    .map(({ _ts, ...row }) => row);

  return NextResponse.json({ ok: true, data });
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    await enforceRateLimit(`txn:create:${user.id}`, RATE_LIMITS.txnCreate);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    if (e instanceof RateLimitError)
      return NextResponse.json(
        { error: e.message, retryAfterSec: e.result.retryAfterSec },
        { status: 429 }
      );
    throw e;
  }

  const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const refId =
    "TXN" +
    Date.now().toString(36).toUpperCase() +
    Math.random().toString(36).slice(2, 6).toUpperCase();

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "transaction.demo",
      entity: "Transaction",
      entityId: refId,
      meta: { service: parsed.data.service ?? "Generic", amount: parsed.data.amount ?? 0 },
    },
  });

  return NextResponse.json({
    ok: true,
    refId,
    service: parsed.data.service ?? "Generic",
    amount: parsed.data.amount ?? 0,
    status: "Success",
    timestamp: new Date().toISOString(),
  });
}
