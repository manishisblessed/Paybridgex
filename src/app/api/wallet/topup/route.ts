import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-server";
import { assertAccountActive } from "@/lib/security/accountGate";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { withIdempotency } from "@/lib/idempotency";
import { clientIp } from "@/lib/security/audit";
import { initiateTopup, settleTopup } from "@/lib/wallet/topup";

/**
 * Instant wallet top-up.
 *
 * POST — create a top-up intent: returns a hosted payment URL / UPI intent /
 *        collect request from the PG partner (Razorpay).
 * GET  — ?refId=TOPUPXXXX verify + settle: polls the provider and credits the
 *        wallet once PAID (idempotent; also driven by the PG webhook).
 */
const Body = z.object({
  amount: z.number().positive().max(200000),
  vpa: z.string().regex(/^[\w.\-]{2,}@[a-zA-Z]{2,}$/).optional(),
  note: z.string().max(80).optional(),
  idempotencyKey: z.string().min(8)
}).strict();

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    await assertAccountActive(user.id);
    await assertServiceEnabled(SERVICE_KEYS.PG, { name: "Wallet top-up", userId: user.id, role: user.role });
    await enforceRateLimit(`wallet:topup:${user.id}`, RATE_LIMITS.fundRequestCreate);
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const result = await withIdempotency(
      { key: parsed.data.idempotencyKey, scope: "wallet.topup", userId: user.id },
      () =>
        initiateTopup({
          userId: user.id,
          amount: parsed.data.amount,
          vpa: parsed.data.vpa,
          note: parsed.data.note,
          customerPhone: user.phone,
          customerEmail: user.email || undefined,
          ip: clientIp(req),
        })
    );
    return NextResponse.json(result);
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function GET(req: Request) {
  let user;
  try {
    user = await requireAuth();
    await enforceRateLimit(`wallet:topup:status:${user.id}`, RATE_LIMITS.default);
  } catch (e) {
    return toErrorResponse(e);
  }

  const refId = new URL(req.url).searchParams.get("refId");
  if (!refId || !refId.startsWith("TOPUP")) {
    return NextResponse.json({ error: "refId query param required" }, { status: 400 });
  }

  try {
    const result = await settleTopup(refId);
    return NextResponse.json(result);
  } catch (e) {
    return toErrorResponse(e);
  }
}
