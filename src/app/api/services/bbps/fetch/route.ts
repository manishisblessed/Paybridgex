import { NextResponse } from "next/server";
import { z } from "zod";
import { getPartner } from "@/lib/partners";
import { requireAuth } from "@/lib/auth-server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { bbpsServiceKey } from "@/lib/services/bbpsKey";
import { friendlyPartnerError } from "@/lib/partners/friendlyError";
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
  return r.ok
    ? NextResponse.json(r.data)
    : NextResponse.json(
        { error: friendlyPartnerError(r.code, r.message, "fetch"), code: r.code },
        { status: 502 }
      );
}
