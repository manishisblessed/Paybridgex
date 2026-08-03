import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-server";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { rechargekitStatus } from "@/lib/partners/sameday-rechargekit";
import { AuthError } from "@/lib/auth-server";

const Body = z
  .object({
    txnId: z.string().min(1).optional(),
    requestId: z.string().min(1).optional(),
  })
  .strict()
  .refine((d) => d.txnId || d.requestId, {
    message: "Either txnId or requestId is required",
  });

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * POST /api/services/rechargekit/status
 *
 * Polls the status of a RechargeKit CC-2 payment. Use this:
 *   - When pay returns PENDING (poll every 30s, max 10 retries)
 *   - When pay times out or has a network error (immediately, with request_id)
 *   - NEVER retry pay on timeout — use this endpoint instead
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    if (user.role !== "RETAILER") throw new AuthError("Credit Card Bill Payment-2 is available for retailers only", 403);
    await enforceRateLimit(`rk:status:${user.id}`, RATE_LIMITS.default);
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const result = await rechargekitStatus(parsed.data);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: 502 }
    );
  }

  return NextResponse.json(result.data);
}
