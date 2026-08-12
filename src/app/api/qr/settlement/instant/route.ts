import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth-server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { instantSettleQrClaims } from "@/lib/qr/claims";
import { isInstantButtonEnabled } from "@/lib/settlement/engine";

/**
 * POST /api/qr/settlement/instant
 *
 * Retailer-driven INSTANT settlement of chosen SETTLEABLE QR claims at the
 * scheme's T0 rate. Only the caller's own claims are touched; the engine's
 * status gate + ledger idempotency guarantee no double credit against the T+1
 * cron.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    claimIds: z.array(z.string().min(1)).min(1).max(200),
  })
  .strict();

export async function POST(req: Request) {
  let user;
  try {
    // Only retailers own claims to settle; instant-settle is a retailer action.
    user = await requireRole("RETAILER");
    await enforceRateLimit(`qr:instant-settle:${user.id}`, RATE_LIMITS.txnCreate);
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (!(await isInstantButtonEnabled("QR")))
    return NextResponse.json(
      { error: "Instant settlement is currently disabled by the admin. Your approved claims will auto-settle on T+1." },
      { status: 403 }
    );

  try {
    const result = await instantSettleQrClaims(user.id, parsed.data.claimIds);
    return NextResponse.json(result);
  } catch (e) {
    return toErrorResponse(e);
  }
}
