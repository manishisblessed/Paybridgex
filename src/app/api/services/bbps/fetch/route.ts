import { NextResponse } from "next/server";
import { z } from "zod";
import { getPartner } from "@/lib/partners";
import { requireAuth } from "@/lib/auth-server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { bbpsServiceKey } from "@/lib/services/bbpsKey";
import { friendlyPartnerError, isNoBillDue, NO_BILL_DUE_MESSAGE } from "@/lib/partners/friendlyError";
import { classifyBbpsFailure } from "@/lib/services/bbpsHealth";
import { AuthError } from "@/lib/auth-server";

const Body = z.object({
  billerCode: z.string().min(2),
  category: z.enum(["ELECTRICITY", "WATER", "GAS", "CREDIT_CARD", "EDUCATION", "INSURANCE", "BROADBAND"]),
  customerParams: z.record(z.string()),
  idempotencyKey: z.string().min(8)
});

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    if (user.role !== "RETAILER") throw new AuthError("BBPS is available for retailers only", 403);
    await assertServiceEnabled(SERVICE_KEYS.BBPS, { name: "Bill Payments", userId: user.id, role: user.role });
    await enforceRateLimit(`bbps:fetch:${user.id}`, RATE_LIMITS.txnCreate);
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = Body.safeParse(await req.json());
  if (parsed.success) {
    const catKey = bbpsServiceKey(parsed.data.category);
    try {
      if (catKey) await assertServiceEnabled(catKey, { name: "Bill Payments", userId: user.id, role: user.role });
    } catch (e) {
      return toErrorResponse(e);
    }
  }
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const bbps = getPartner("bbps");
  const r = await bbps.fetchBill({ userId: user.id, ...parsed.data });
  if (r.ok) return NextResponse.json(r.data);

  // "No bill due" is a legitimate outcome, NOT an error — tag it so the client
  // shows a friendly notice (not a red error) and return 200 so it isn't
  // treated as a transport failure. The `noBillDue` flag is the discriminator;
  // `error` is kept for older clients that only read that field.
  if (isNoBillDue(r.message)) {
    return NextResponse.json(
      { noBillDue: true, message: NO_BILL_DUE_MESSAGE, error: NO_BILL_DUE_MESSAGE },
      { status: 200 }
    );
  }

  // `kind` lets the client react instantly (show "service down" vs "choose
  // another issuer") without waiting for the polled health banner to flip.
  return NextResponse.json(
    {
      error: friendlyPartnerError(r.code, r.message, "fetch"),
      code: r.code,
      kind: classifyBbpsFailure(r.code, r.message),
    },
    { status: 502 }
  );
}
