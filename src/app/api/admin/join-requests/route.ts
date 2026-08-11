import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { canManageJoinRequests } from "@/lib/onboarding/joinAccess";

const VALID_STATUSES = ["NEW", "CONTACTED", "INVITED", "CLOSED", "REJECTED"];

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

  if (!canManageJoinRequests(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const q = searchParams.get("q")?.trim();
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.min(100, parseInt(searchParams.get("limit") ?? "20"));

  const where: Record<string, unknown> = {};
  if (status && VALID_STATUSES.includes(status)) where.status = status;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
      { shopName: { contains: q, mode: "insensitive" } },
    ];
  }

  const [requests, total, counts] = await Promise.all([
    prisma.joinRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.joinRequest.count({ where }),
    prisma.joinRequest.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const statusCounts = Object.fromEntries(
    counts.map((c) => [c.status, c._count._all])
  );

  return NextResponse.json({ requests, total, page, limit, statusCounts });
}
