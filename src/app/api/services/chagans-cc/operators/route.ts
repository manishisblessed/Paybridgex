import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { chagansCcGetBillers } from "@/lib/partners/chagans-cc-bill";
import { getBbpsMerchantStatus } from "@/lib/services/bbpsMerchant";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * GET /api/services/chagans-cc/operators
 *
 * Returns credit-card billers (issuers/banks) from Chagans CC Bill API V2.
 * Cached in-process for 6 hours; pass ?refresh=true to bust the cache.
 */
export async function GET(req: Request) {
  let userId: string;
  try {
    const user = await requireAuth();
    userId = user.id;
    if (user.role !== "RETAILER")
      throw new AuthError("CC Bill Payment is available for retailers only", 403);
    await assertServiceEnabled(SERVICE_KEYS.BBPS_CHAGANS, {
      name: "CC Bill Payment",
      userId: user.id,
      role: user.role,
    });
    await enforceRateLimit(`chagans-cc:operators:${user.id}`, RATE_LIMITS.default);
  } catch (e) {
    return toErrorResponse(e);
  }

  // Include merchant onboarding status so the UI can gate the form.
  const merchant = await getBbpsMerchantStatus(userId);
  const canTransact = !!(
    merchant?.status === "ACTIVE" && merchant.providerMerchantId
  );

  // If user hasn't onboarded as a merchant yet, return early with
  // canTransact=false — no need to hit Chagans for the biller list.
  if (!canTransact) {
    return NextResponse.json({
      operators: [],
      count: 0,
      merchant: merchant
        ? { status: merchant.status, kycStatus: merchant.kycStatus }
        : null,
      canTransact: false,
    });
  }

  const refresh = new URL(req.url).searchParams.get("refresh") === "true";
  const result = await chagansCcGetBillers(
    refresh,
    merchant?.providerMerchantId ?? undefined
  );

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.message,
        code: result.code,
        operators: [],
        count: 0,
        merchant: merchant
          ? { status: merchant.status, kycStatus: merchant.kycStatus }
          : null,
        canTransact,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    operators: result.data.map((b) => ({
      operatorCode: b.billerId,
      operatorName: b.billerName,
      billerId: b.billerId,
      billerName: b.billerName,
    })),
    count: result.data.length,
    merchant: merchant
      ? { status: merchant.status, kycStatus: merchant.kycStatus }
      : null,
    canTransact,
  });
}
