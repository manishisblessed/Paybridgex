import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { chagansCcFetchBill } from "@/lib/partners/chagans-cc-bill";
import { requireChagansMerchant } from "@/lib/services/bbpsMerchant";

const Body = z
  .object({
    billerId: z.string().min(1, "billerId is required"),
    enquiryId: z.string().min(1, "enquiryId is required"),
    parameters: z
      .record(z.string(), z.string())
      .refine(
        (p) => Object.keys(p).length > 0,
        "At least one parameter is required"
      ),
  })
  .strict();

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * POST /api/services/chagans-cc/fetch-bill
 *
 * Validates consumer inputs and retrieves bill details from Chagans CC Bill API.
 * Read-only preflight — no money moves.
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
    await enforceRateLimit(`chagans-cc:fetch-bill:${user.id}`, RATE_LIMITS.default);
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

  const d = parsed.data;
  const result = await chagansCcFetchBill({
    billerId: d.billerId,
    enquiryId: d.enquiryId,
    parameters: d.parameters,
    userMerchantId: merchantId,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: 502 }
    );
  }

  return NextResponse.json({
    billerResponse: result.data.billerResponse,
    additionalInfo: result.data.additionalInfo,
    message: result.data.message,
    dueAmount: result.data.dueAmount,
  });
}
