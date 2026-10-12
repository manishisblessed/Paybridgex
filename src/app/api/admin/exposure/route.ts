import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { isAdminRole } from "@/lib/security/ownership";
import { getMoneyAtRisk } from "@/lib/recon/exposure";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/exposure
 *
 * Consolidated money-at-risk snapshot: NEEDS_REVIEW payout exposure, open
 * transaction-anomaly exposure, and outstanding (ACTIVE) lien balances. Read-only.
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

  const data = await getMoneyAtRisk();
  return NextResponse.json(data);
}
