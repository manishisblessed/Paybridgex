import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/security/ownership";
import { listHeldPayouts } from "@/lib/payout/service";
import { toNumber } from "@/lib/money";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/payouts/held
 *
 * The review queue for payouts HELD as NEEDS_REVIEW — an INDETERMINATE send
 * outcome (lost transfer response / HTTP 5xx / timeout) where the bank MAY have
 * disbursed. The hold is NOT released; the recon sweep tries reference recovery
 * + poll automatically, and an admin can resolve each against the rail's books.
 * Oldest first, so ops act on the longest-held exposure.
 */
export async function GET() {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }
  if (!isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const items = await listHeldPayouts(200);

  // Exposure total across ALL held rows (the funds we are holding, not released).
  const exposureAgg = await prisma.payoutRequest.aggregate({
    where: { status: "NEEDS_REVIEW" },
    _sum: { totalDebit: true },
  });
  const exposure = toNumber(exposureAgg._sum.totalDebit ?? 0);

  return NextResponse.json({ items, total: items.length, exposure });
}
