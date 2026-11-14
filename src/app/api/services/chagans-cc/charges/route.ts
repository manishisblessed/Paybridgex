import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { requireActiveScheme } from "@/lib/scheme/gate";
import { getEffectiveRate, withGst } from "@/lib/scheme/resolver";
import { BBPS_PRICE_SCOPES } from "@/lib/services/priceScope";
import { toNumber, add } from "@/lib/money";

const Body = z
  .object({
    amount: z.number().positive().max(500000),
  })
  .strict();

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * POST /api/services/chagans-cc/charges
 *
 * Scheme-driven charge preview for the CC Bill Payment (Chagans) rail.
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    if (user.role !== "RETAILER")
      throw new AuthError("CC Bill Payment is available for retailers only", 403);
    await assertServiceEnabled(SERVICE_KEYS.BBPS_CHAGANS, {
      name: "CC Bill Payment",
      userId: user.id,
      role: user.role,
    });
    await requireActiveScheme(user.id);
    await enforceRateLimit(`chagans-cc:charges:${user.id}`, RATE_LIMITS.default);
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { amount } = parsed.data;

  const rate = await getEffectiveRate(
    user.id,
    "BILL_CREDIT_CARD",
    amount,
    BBPS_PRICE_SCOPES.BBPS_CHAGANS
  );

  const serviceCharge = toNumber(rate.charge);
  const gstBreakdown = withGst(rate.charge, 18);
  const gst = rate.chargeGstInclusive ? 0 : toNumber(gstBreakdown.gst);
  const totalCharge = rate.chargeGstInclusive
    ? serviceCharge
    : toNumber(gstBreakdown.total);
  const totalDebit = toNumber(
    add(amount, rate.chargeGstInclusive ? rate.charge : gstBreakdown.total)
  );
  const commission = toNumber(rate.commission);

  return NextResponse.json({
    amount,
    serviceCharge,
    gst,
    gstPercent: rate.chargeGstInclusive ? 0 : 18,
    totalCharge,
    totalDebit,
    commission,
    source: rate.source,
    schemeName: rate.schemeName,
  });
}
