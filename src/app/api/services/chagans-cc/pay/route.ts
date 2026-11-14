import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertLivenessReady } from "@/lib/security/livenessGate";
import { requireTxnPin } from "@/lib/security/txnPin";
import { clientIp } from "@/lib/security/audit";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { BBPS_PRICE_SCOPES } from "@/lib/services/priceScope";
import { getEffectiveRate, withGst } from "@/lib/scheme/resolver";
import { toNumber, dec, sub, round } from "@/lib/money";
import { runTransaction } from "@/lib/services/transaction";
import { chagansCcPayBill } from "@/lib/partners/chagans-cc-bill";
import { requireChagansMerchant } from "@/lib/services/bbpsMerchant";

const Body = z
  .object({
    billerId: z.string().min(1, "billerId is required"),
    billerName: z.string().min(1, "billerName is required"),
    enquiryId: z.string().min(1, "enquiryId is required"),
    parameters: z.record(z.string(), z.string()),
    amount: z.number().positive().max(500000),
    customerPan: z.string().default(""),
    idempotencyKey: z.string().min(8),
  })
  .strict();

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * POST /api/services/chagans-cc/pay
 *
 * Initiates a credit card bill payment via Chagans CC Bill API V2.
 * Wrapped by runTransaction for idempotency, ledger atomicity, and auto-refund.
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
    await assertLivenessReady(user);
    await enforceRateLimit(`txn:create:${user.id}`, RATE_LIMITS.txnCreate);
    await requireTxnPin(user, req, {
      action: "chagans-cc-bill.pay",
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const d = parsed.data;

  let merchantId: string;
  try {
    const m = await requireChagansMerchant(user.id);
    merchantId = m.providerMerchantId;
  } catch (e) {
    return toErrorResponse(e);
  }

  try {
    const rate = await getEffectiveRate(
      user.id,
      "BILL_CREDIT_CARD",
      d.amount,
      BBPS_PRICE_SCOPES.BBPS_CHAGANS
    );

    const gstInclusive = rate.chargeGstInclusive;
    const gross = withGst(rate.charge, 18);
    const feeMoney = gstInclusive ? dec(rate.charge) : gross.total;
    const baseCharge = gstInclusive
      ? round(dec(rate.charge).div("1.18"))
      : dec(rate.charge);
    const gstMoney = gstInclusive
      ? round(sub(feeMoney, baseCharge))
      : gross.gst;
    const fee = toNumber(feeMoney);

    const primaryParam = Object.values(d.parameters)[0] ?? "";

    const result = await runTransaction({
      userId: user.id,
      service: "BILL_CREDIT_CARD",
      amount: d.amount,
      fee,
      gst: toNumber(gstMoney),
      vendorCharge: toNumber(rate.vendorCharge),
      priceScope: BBPS_PRICE_SCOPES.BBPS_CHAGANS,
      commission: toNumber(rate.commission),
      idempotencyKey: d.idempotencyKey,
      customer: primaryParam.length >= 4 ? primaryParam.slice(-4) : primaryParam,
      operator: d.billerName,
      partner: "CHAGANS_CC_BILL",
      request: {
        billerId: d.billerId,
        billerName: d.billerName,
        enquiryId: d.enquiryId,
        parameters: d.parameters,
        amount: d.amount,
        customerPan: d.customerPan || undefined,
      },
      ip: clientIp(req),
      call: () =>
        chagansCcPayBill({
          billerId: d.billerId,
          enquiryId: d.enquiryId,
          amount: d.amount,
          externalRef: d.idempotencyKey,
          customerPan: d.customerPan || undefined,
          userMerchantId: merchantId,
        }),
    });

    const httpStatus =
      result.status === "SUCCESS"
        ? 200
        : result.status === "PROCESSING" || result.status === "INITIATED"
          ? 202
          : 502;

    return NextResponse.json(result, { status: httpStatus });
  } catch (e) {
    return toErrorResponse(e);
  }
}
