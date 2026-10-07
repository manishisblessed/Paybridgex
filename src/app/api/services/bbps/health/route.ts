import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { getBbpsHealthSnapshot } from "@/lib/services/bbpsHealth";

/**
 * Lightweight, read-only rail-health signal for the bill-pay UI. Lets the
 * credit-card / BBPS forms show an honest banner ("payment service is
 * temporarily down" vs "this bank is facing issues") and disable actions during
 * an outage so retailers aren't left hammering a dead biller. No DB access —
 * served from the in-process health window (see lib/services/bbpsHealth.ts).
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireAuth();
    if (user.role !== "RETAILER") throw new AuthError("Not available", 403);
    const h = getBbpsHealthSnapshot();
    return NextResponse.json(h, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
