import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { isAdminRole } from "@/lib/security/ownership";
import { getOpenAnomalies } from "@/lib/recon/anomalies";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/transactions/anomalies?page=1
 *
 * Returns auto-detected transaction anomalies for the Reversal Desk:
 *   - FAILED_NO_REVERSAL  — wallet debit not reversed after failure
 *   - SUCCESS_NO_PROVIDER — success with no provider trace (idempotent replay)
 *   - STUCK_NON_TERMINAL  — payment stuck beyond 1 hour
 *
 * The background sweep (txn.anomaly.sweep, every 5 min) populates these;
 * resolved anomalies are auto-cleared on the next sweep run.
 */
export async function GET(req: Request) {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }
  if (!isAdminRole(user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));

  const result = await getOpenAnomalies({ page, pageSize: 50 });
  return NextResponse.json(result);
}
