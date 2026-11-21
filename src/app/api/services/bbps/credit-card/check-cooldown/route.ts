import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { enforceRateLimit } from "@/lib/security/rateLimit";
import { checkCooldown } from "@/lib/services/cooldown";

const Body = z
  .object({
    billerId: z.string().min(1),
    cardLast4: z.string().regex(/^\d{4}$/, "Must be exactly 4 digits"),
    partner: z.enum(["SAMEDAY_PAY2NEW", "CHAGANS_CC_BILL"]).optional(),
  })
  .strict();

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    if (user.role !== "RETAILER")
      throw new AuthError("Available for retailers only", 403);
    await enforceRateLimit(`cooldown:check:${user.id}`, { limit: 20, windowSec: 10 });
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { billerId, cardLast4, partner } = parsed.data;

  try {
    const result = await checkCooldown({
      userId: user.id,
      service: "BILL_CREDIT_CARD",
      operator: billerId,
      customer: cardLast4,
      partner,
    });

    return NextResponse.json({
      success: true,
      allowed: !result.blocked,
      remainingSeconds: result.retryAfterSec,
      remainingMilliseconds: result.retryAfterMs,
      cooldownExpiry: result.cooldownExpiry,
      serverTime: new Date().toISOString(),
      ...(result.blocked ? { message: "Please wait before making another payment to this credit card." } : {}),
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
