import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { listPendingPgSettlements } from "@/lib/settlement/pg";
import { isInstantButtonEnabled } from "@/lib/settlement/engine";

/**
 * GET /api/pg/settlement/pending
 *
 * The caller's UNSETTLED PG proceeds, each with an instant-settlement quote
 * (net at the scheme's T0 rate). Powers the dashboard "Instant settle" table:
 * the retailer picks which collections to cash out now; the rest auto-settle T+1.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET() {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    return toErrorResponse(e);
  }

  const [entries, instantEnabled] = await Promise.all([
    listPendingPgSettlements(user.id),
    isInstantButtonEnabled("PG"),
  ]);
  return NextResponse.json({ entries, instantEnabled });
}
