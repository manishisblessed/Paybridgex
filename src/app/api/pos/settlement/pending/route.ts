import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import { toErrorResponse } from "@/lib/security/apiErrors";
import {
  listPendingPosSettlements,
  remainingInstantBudget,
  INSTANT_BUDGET_UNLIMITED,
} from "@/lib/settlement/pos";
import { isInstantButtonEnabled } from "@/lib/settlement/engine";

/**
 * GET /api/pos/settlement/pending
 *
 * The caller's UNSETTLED POS proceeds, each with an instant-settlement quote
 * (net at the scheme's T0 rate). Powers the dashboard "Instant settle" table:
 * the retailer picks which captures to cash out now; the rest auto-settle T+1.
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

  const [entries, instantEnabled, budget] = await Promise.all([
    listPendingPosSettlements(user.id),
    isInstantButtonEnabled("POS"),
    remainingInstantBudget(user.id),
  ]);
  // A daily instant limit constrains the caller only when the remaining budget
  // is below the sentinel (i.e. a global pool and/or per-user cap is enforced).
  const instantLimited = budget < INSTANT_BUDGET_UNLIMITED;
  return NextResponse.json({
    entries,
    instantEnabled,
    instantBudget: instantLimited ? budget : null,
  });
}
