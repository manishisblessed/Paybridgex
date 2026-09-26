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

  // Service-category filter (POS / QR / Payout / BBPS / Credit Card / CC-2).
  const categoryWhere = txnCategoryWhere(serviceFilter);
  if (categoryWhere) and.push(categoryWhere);

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

  const rows = await prisma.transaction.findMany({
    where: where as any,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: isAdmin
      ? { user: { select: { name: true, userCode: true } } }
      : undefined,
  });

  // Retailers do not see commission on the transaction feed: on settlement rails
  // (POS/QR/PG) the `commission` on their bridge txn is the UPLINE's distributed
  // commission, not the retailer's income, so surfacing it here is misleading.
  // The retailer's genuine earnings live on the dedicated "My Earnings" page
  // (sourced from CommissionCredit). Zero it out so it isn't even sent client-side.
  const hideCommission = user.role === "RETAILER";

  const data = rows.map((t) => {
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
    };
  });

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
