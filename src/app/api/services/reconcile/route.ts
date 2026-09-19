import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { reconcileOneTransaction } from "@/lib/recon/reconcileOne";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * POST /api/services/reconcile  { refId }
 *
 * Retailer self-service "Check status" for a bill/credit-card payment stuck in
 * PROCESSING. Re-polls the provider's authoritative status and settles or
 * auto-refunds the retailer's OWN transaction through the shared idempotent
 * finalizer. Scoped to the caller's userId, so a retailer can never touch
 * another user's row. Racing with the webhook/sweep is a safe no-op.
 */
const Body = z.object({ refId: z.string().trim().min(3).max(60) }).strict();

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    if (user.role !== "RETAILER")
      throw new AuthError("Status checks are available for retailers only", 403);
    await enforceRateLimit(`txn:reconcile:${user.id}`, RATE_LIMITS.default);
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const result = await reconcileOneTransaction(parsed.data.refId, {
    ownerUserId: user.id,
    source: "retailer_status",
  });
  if (!result.found)
    return NextResponse.json({ error: "No transaction found for that reference" }, { status: 404 });

  return NextResponse.json(result);
}
