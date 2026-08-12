import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-server";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { listSettleableQrClaims } from "@/lib/qr/claims";
import { isInstantButtonEnabled } from "@/lib/settlement/engine";

/**
 * GET /api/qr/settlement/pending
 *
 * The caller's approved-but-unsettled (SETTLEABLE) QR claims, each with an
 * instant (T0) and T+1 quote net of the scheme's QR MDR. Powers the dashboard
 * "Instant settle" table.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET() {
  let user;
  try {
    // Settleable QR claims belong to retailers only.
    user = await requireRole("RETAILER");
  } catch (e) {
    return toErrorResponse(e);
  }

  const [claims, instantEnabled] = await Promise.all([
    listSettleableQrClaims(user.id),
    isInstantButtonEnabled("QR"),
  ]);
  return NextResponse.json({ claims, instantEnabled });
}
