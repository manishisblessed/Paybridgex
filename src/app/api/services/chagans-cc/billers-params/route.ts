import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { chagansCcGetBillerParams } from "@/lib/partners/chagans-cc-bill";
import { requireChagansMerchant } from "@/lib/services/bbpsMerchant";

const Body = z
  .object({
    billerId: z.string().min(1, "billerId is required"),
  })
  .strict();

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * POST /api/services/chagans-cc/billers-params
 *
 * Returns the required input fields for a biller + issues an enquiryId
 * (valid 30 minutes) for the subsequent fetch-bill and pay calls.
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
    await enforceRateLimit(`chagans-cc:billers-params:${user.id}`, RATE_LIMITS.default);
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  let merchantId: string;
  try {
    const m = await requireChagansMerchant(user.id);
    merchantId = m.providerMerchantId;
  } catch (e) {
    return toErrorResponse(e);
  }

  const result = await chagansCcGetBillerParams(parsed.data.billerId, merchantId);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: 502 }
    );
  }

  return NextResponse.json({
    requiredFields: result.data.requiredFields,
    billerName: result.data.billerName,
    enquiryId: result.data.enquiryId,
    enquiryFetchedAt: Date.now(),
  });
}
