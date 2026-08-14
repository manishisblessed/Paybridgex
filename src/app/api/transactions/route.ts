import { NextResponse } from "next/server";
import { z } from "zod";
import type { TxnStatus } from "@prisma/client";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { enforceRateLimit, RATE_LIMITS, RateLimitError } from "@/lib/security/rateLimit";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { isAdminRole } from "@/lib/security/ownership";

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

  const where: Record<string, unknown> = isAdminRole(user.role)
    ? {}
    : { userId: user.id };

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

  // Retailers do not see commission on the transaction feed: on settlement rails
  // (POS/QR/PG) the `commission` on their bridge txn is the UPLINE's distributed
  // commission, not the retailer's income, so surfacing it here is misleading.
  // The retailer's genuine earnings live on the dedicated "My Earnings" page
  // (sourced from CommissionCredit). Zero it out so it isn't even sent client-side.
  const hideCommission = user.role === "RETAILER";

  const data = rows.map((t) => ({
    id: t.refId,
    service: formatService(t.service, t.operator),
    amount: toNumber(t.amount),
    status: displayStatus(t.status),
    date: t.createdAt.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    customer: t.customer ?? "—",
    commission: hideCommission ? 0 : toNumber(t.commission),
  }));

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
