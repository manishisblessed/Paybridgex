import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-server";
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
import { rechargekitPay } from "@/lib/partners/sameday-rechargekit";
import { AuthError } from "@/lib/auth-server";

const Body = z
  .object({
    mobileNo: z
      .string()
      .regex(/^\d{10}$/, "Mobile must be exactly 10 digits"),
    accountNo: z
      .string()
      .regex(/^\d{13,19}$/, "Card number must be 13-19 digits"),
    ifsc: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "A valid bank IFSC is required (e.g. ICIC0001234)"),
    bankName: z.string().min(2),
    beneficiaryName: z.string().min(2),
    amount: z.number().positive().max(500000),
    operatorCode: z.string().min(1),
    idempotencyKey: z.string().min(8),
  })
  .strict();

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * POST /api/services/rechargekit/pay
 *
 * Initiates a credit card payment via RechargeKit (CC-2). The full payment
 * lifecycle is wrapped by runTransaction for idempotency, ledger atomicity,
 * and auto-refund on failure.
 *
 * CRITICAL: on timeout/network error, callers MUST use the /status endpoint
 * with the request_id. NEVER retry this endpoint on timeout.
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    if (user.role !== "RETAILER") throw new AuthError("Credit Card Bill Payment-2 is available for retailers only", 403);
    await assertServiceEnabled(SERVICE_KEYS.RECHARGEKIT_CC, {
      name: "Credit Card Bill Payment-2",
      userId: user.id,
      role: user.role,
    });
    await assertLivenessReady(user);
    await enforceRateLimit(`txn:create:${user.id}`, RATE_LIMITS.txnCreate);
    await requireTxnPin(user, req, {
      action: "rechargekit.pay",
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

  try {
    // Prices under its own product scope ("rechargekit_cc") so this Same Day
    // RechargeKit CC rail is separate from the Same Day Pay2New CC rail even
    // though both are BILL_CREDIT_CARD on the same partner family.
    const rate = await getEffectiveRate(
      user.id,
      "BILL_CREDIT_CARD",
      d.amount,
      BBPS_PRICE_SCOPES.RECHARGEKIT_CC
    );
    // Split the customer charge into base + GST so revenue excludes the GST
    // pass-through (mirrors bbps/pay). GST-inclusive slabs back-calculate base.
    const gstInclusive = rate.chargeGstInclusive;
    const gross = withGst(rate.charge, 18);
    const feeMoney = gstInclusive ? dec(rate.charge) : gross.total;
    const baseCharge = gstInclusive ? round(dec(rate.charge).div("1.18")) : dec(rate.charge);
    const gstMoney = gstInclusive ? round(sub(feeMoney, baseCharge)) : gross.gst;
    const fee = toNumber(feeMoney);

    const result = await runTransaction({
      userId: user.id,
      service: "BILL_CREDIT_CARD",
      amount: d.amount,
      fee,
      gst: toNumber(gstMoney),
      vendorCharge: toNumber(rate.vendorCharge),
      priceScope: BBPS_PRICE_SCOPES.RECHARGEKIT_CC,
      commission: toNumber(rate.commission),
      idempotencyKey: d.idempotencyKey,
      customer: d.accountNo.slice(-4),
      operator: d.bankName,
      partner: "SAMEDAY_RECHARGEKIT",
      request: {
        mobileNo: d.mobileNo,
        cardLast4: d.accountNo.slice(-4),
        ifsc: d.ifsc,
        bankName: d.bankName,
        beneficiaryName: d.beneficiaryName,
        amount: d.amount,
        operatorCode: d.operatorCode,
      },
      ip: clientIp(req),
      call: () =>
        rechargekitPay({
          mobileNo: d.mobileNo,
          accountNo: d.accountNo,
          ifsc: d.ifsc,
          bankName: d.bankName,
          beneficiaryName: d.beneficiaryName,
          amount: d.amount,
          operatorCode: d.operatorCode,
        }),
    });

    const httpStatus =
      result.status === "SUCCESS"
        ? 200
        : result.status === "PROCESSING"
          ? 202
          : 502;

    return NextResponse.json(result, { status: httpStatus });
  } catch (e) {
    return toErrorResponse(e);
  }
}
