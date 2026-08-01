import { NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { requireAuth } from "@/lib/auth-server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { clientIp } from "@/lib/security/audit";
import { withIdempotency } from "@/lib/idempotency";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { initiateReKyc, ReKycError } from "@/lib/rekyc/service";

const Body = z
  .object({
    // DigiLocker return URL — required for Aadhaar methods, validated downstream.
    // Must be a clean URL with no query string (eKYC Hub WAF rejects nested queries).
    redirectUrl: z.string().url().max(512).optional(),
  })
  .strict();

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await requireAuth();
    const ip = clientIp(req);

    // Abuse control: rate-limit per user AND per IP so retries don't hammer the
    // eKYC provider (each initiate may cost an OTP send).
    await enforceRateLimit(`rekyc:initiate:user:${user.id}`, RATE_LIMITS.rekyc);
    await enforceRateLimit(`rekyc:initiate:ip:${ip}`, RATE_LIMITS.rekyc);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const userAgent = req.headers.get("user-agent");
    const idemKey =
      req.headers.get("Idempotency-Key") || req.headers.get("idempotency-key") || nanoid();

    // Idempotent so a double-tap / client retry reuses the same provider call.
    const result = await withIdempotency(
      { key: idemKey, scope: "rekyc.initiate", userId: user.id, ttlSec: 600 },
      () => initiateReKyc(user, { redirectUrl: parsed.data.redirectUrl }, { ip, userAgent })
    );

    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    if (e instanceof ReKycError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode });
    }
    return toErrorResponse(e);
  }
}
