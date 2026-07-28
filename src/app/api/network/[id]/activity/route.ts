import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { canAccessUser } from "@/lib/security/ownership";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/** Map raw audit action codes to a friendly label. Falls back to the code. */
function labelFor(action: string): string {
  const map: Record<string, string> = {
    "user.login": "Signed in",
    "user.logout": "Signed out",
    "network.user.suspend": "Account frozen",
    "network.user.activate": "Account reactivated",
    "network.scheme_assigned": "Scheme assigned",
    "network.wallet.push": "Wallet credited",
    "network.wallet.pull": "Wallet debited",
    "transaction.demo": "Ran a transaction",
    "kyc.submit": "Submitted KYC",
    "kyc.approve": "KYC approved",
    "kyc.reject": "KYC rejected",
    "funds.request": "Requested funds",
    "funds.approve": "Fund request approved",
    "payout.request": "Requested payout",
  };
  return map[action] ?? action.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * GET /api/network/[id]/activity
 *
 * Recent activity for a downline member: audit-log entries the member performed
 * plus actions taken on their account (freeze, scheme change, wallet ops).
 * Scoped to the caller's downline; admins are unrestricted.
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

    const rows = await prisma.auditLog.findMany({
      where: {
        OR: [
          { userId: params.id },
          { entity: "User", entityId: params.id },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        action: true,
        entity: true,
        meta: true,
        ip: true,
        createdAt: true,
        userId: true,
      },
    });

    const data = rows.map((r) => ({
      id: r.id,
      action: r.action,
      label: labelFor(r.action),
      entity: r.entity,
      bySelf: r.userId === params.id,
      meta: r.meta ?? null,
      ip: r.ip,
      date: r.createdAt.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    }));

    return NextResponse.json({ ok: true, data });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }
}
