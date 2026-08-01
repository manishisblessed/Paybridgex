import { NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { requireAuth } from "@/lib/auth-server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { clientIp } from "@/lib/security/audit";
import { withIdempotency } from "@/lib/idempotency";
import { requireStepUp, readStepUpCode } from "@/lib/security/stepUp";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { verifyReKyc, ReKycError } from "@/lib/rekyc/service";

const Body = z
  .object({
    // Opaque provider/Cloudinary reference for the fresh liveness capture.
    faceProbeRef: z.string().trim().max(256).optional(),
    // Step-up 2FA (verified before any provider submit).
    stepUpCode: z.string().max(20).optional(),
    stepUpType: z.enum(["totp", "backup"]).optional(),
  })
  .strict();

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await requireAuth();
    const ip = clientIp(req);
    const userAgent = req.headers.get("user-agent");

    await enforceRateLimit(`rekyc:verify:user:${user.id}`, RATE_LIMITS.rekyc);
    await enforceRateLimit(`rekyc:verify:ip:${ip}`, RATE_LIMITS.rekyc);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    // Step-up: the user's 2FA must be satisfied before we submit identity proof
    // (no-op unless SECURITY_STEPUP_ENABLED). Defends against a hijacked session
    // completing re-KYC on the victim's behalf.
    const { code, type } = readStepUpCode(req, parsed.data);
    await requireStepUp(user, {
      action: "rekyc.verify",
      code: code ?? parsed.data.stepUpCode,
      type: parsed.data.stepUpType ?? type,
      ip,
      userAgent,
    });

    const idemKey =
      req.headers.get("Idempotency-Key") || req.headers.get("idempotency-key") || nanoid();

    const result = await withIdempotency(
      { key: idemKey, scope: "rekyc.verify", userId: user.id, ttlSec: 600 },
      () =>
        verifyReKyc(user, { faceProbeRef: parsed.data.faceProbeRef }, { ip, userAgent })
    );

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ReKycError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode });
    }
    return toErrorResponse(e);
  }
}
