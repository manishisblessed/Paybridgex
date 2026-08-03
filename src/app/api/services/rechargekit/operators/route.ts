import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { rechargekitOperators } from "@/lib/partners/sameday-rechargekit";
import { AuthError } from "@/lib/auth-server";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * GET /api/services/rechargekit/operators
 *
 * Returns the cached list of CC-2 operators (one per bank/card issuer).
 * Cached in-memory for 24h; pass ?refresh=true to force a refresh.
 */
export async function GET(req: Request) {
  try {
    const user = await requireAuth();
    if (user.role !== "RETAILER") throw new AuthError("Credit Card Bill Payment-2 is available for retailers only", 403);
    await assertServiceEnabled(SERVICE_KEYS.RECHARGEKIT_CC, {
      name: "Credit Card Bill Payment-2",
      userId: user.id,
      role: user.role,
    });
    await enforceRateLimit(`rk:operators:${user.id}`, RATE_LIMITS.default);
  } catch (e) {
    return toErrorResponse(e);
  }

  const refresh = new URL(req.url).searchParams.get("refresh") === "true";
  const result = await rechargekitOperators(refresh);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: 502 }
    );
  }

  return NextResponse.json({
    operators: result.data,
    count: result.data.length,
  });
}
