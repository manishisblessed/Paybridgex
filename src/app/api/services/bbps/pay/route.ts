import { NextResponse } from "next/server";
import { z } from "zod";
import { getPartner } from "@/lib/partners";
import { runTransaction } from "@/lib/services/transaction";
import { requireAuth } from "@/lib/auth-server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertLivenessReady } from "@/lib/security/livenessGate";
import { requireTxnPin } from "@/lib/security/txnPin";
import { clientIp } from "@/lib/security/audit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { bbpsServiceKey } from "@/lib/services/bbpsKey";
import { getEffectiveRate, withGst } from "@/lib/scheme/resolver";
import { toNumber } from "@/lib/money";
import { AuthError } from "@/lib/auth-server";

const Body = z.object({
  billerCode: z.string().min(2),
  category: z.enum(["ELECTRICITY", "WATER", "GAS", "CREDIT_CARD", "EDUCATION", "INSURANCE", "BROADBAND"]),
  customerParams: z.record(z.string()),
  amount: z.number().positive().max(500000),
  idempotencyKey: z.string().min(8),
  // Display-only snapshots captured from the bill-fetch step so the payment
  // record (and the Bill Payment Report) carries the human customer / biller
  // name. Stored in Transaction.request; never forwarded to the partner.
  customerName: z.string().trim().max(140).optional(),
  billerName: z.string().trim().max(140).optional()
}).strict();

const SERVICE = {
  ELECTRICITY: "BILL_ELECTRICITY",
  WATER: "BILL_WATER",
  GAS: "BILL_GAS",
  CREDIT_CARD: "BILL_CREDIT_CARD",
  EDUCATION: "BILL_EDUCATION",
  INSURANCE: "BILL_INSURANCE",
  BROADBAND: "RECHARGE_BROADBAND"
} as const;

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    if (user.role !== "RETAILER") throw new AuthError("BBPS is available for retailers only", 403);
    await assertServiceEnabled(SERVICE_KEYS.BBPS, { name: "Bill Payments", userId: user.id, role: user.role });
    await assertLivenessReady(user);
    await enforceRateLimit(`txn:create:${user.id}`, RATE_LIMITS.txnCreate);
    // Transaction PIN — required on every money-moving action (x-txn-pin header).
    await requireTxnPin(user, req, { action: "bbps.pay", ip: clientIp(req), userAgent: req.headers.get("user-agent") });
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const catKey = bbpsServiceKey(parsed.data.category);
  try {
    if (catKey) await assertServiceEnabled(catKey, { name: "Bill Payments", userId: user.id, role: user.role });
  } catch (e) {
    return toErrorResponse(e);
  }

  const bbps = getPartner("bbps");
  try {
    // Scheme-driven pricing: the user's assigned scheme slab
    // sets the charge (fee). BBPS does not earn commission.
    const service = SERVICE[parsed.data.category];
    // Provider-scoped slabs: a slab pinned to this BBPS partner wins over the
    // any-provider slab for the same band.
    const rate = await getEffectiveRate(user.id, service, parsed.data.amount, bbps.name);
    const fee = rate.chargeGstInclusive
      ? toNumber(rate.charge)
      : toNumber(withGst(rate.charge, 18).total);

    // Keep the display-only snapshots out of the partner payload.
    const { customerName: _cn, billerName: _bn, ...payInput } = parsed.data;

    const result = await runTransaction({
      userId: user.id,
      service,
      amount: parsed.data.amount,
      fee,
      commission: toNumber(rate.commission),
      idempotencyKey: parsed.data.idempotencyKey,
      customer: Object.values(parsed.data.customerParams)[0],
      operator: parsed.data.billerCode,
      partner: bbps.name,
      request: parsed.data,
      call: () => bbps.pay({
        userId: user.id,
        ...payInput,
        remark: user.userCode
          ? `Pay by NxtGenPay by RT Code - ${user.userCode}`
          : `Pay by NxtGenPay ${user.id}`,
      })
    });

    const httpStatus = result.status === "SUCCESS" ? 200 : result.status === "PROCESSING" ? 202 : 502;
    return NextResponse.json(result, { status: httpStatus });
  } catch (e) {
    return toErrorResponse(e);
  }
}
