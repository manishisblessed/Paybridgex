import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { decryptSecret, verifyTotpCode } from "@/lib/two-factor";
import { invalidateSessionValidation } from "@/lib/security/sessionValidationCache";

const Body = z.object({
  code: z.string().length(6).regex(/^\d+$/),
});

/**
 * POST /api/auth/2fa/confirm
 * Verifies the user's first TOTP code to activate 2FA.
 * Must be called after /setup with a valid 6-digit code.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid code format" }, { status: 400 });

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { twoFactorSecret: true, twoFactorEnabled: true },
  });

  if (!dbUser?.twoFactorSecret) {
    return NextResponse.json(
      { error: "No 2FA setup found. Call /api/auth/2fa/setup first." },
      { status: 400 }
    );
  }

  if (dbUser.twoFactorEnabled) {
    return NextResponse.json(
      { error: "2FA is already active." },
      { status: 400 }
    );
  }

  const secret = decryptSecret(dbUser.twoFactorSecret);
  const valid = verifyTotpCode(secret, parsed.data.code);

  if (!valid) {
    return NextResponse.json(
      { error: "Invalid code. Please try again with a fresh code from your authenticator." },
      { status: 401 }
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      twoFactorEnabled: true,
      twoFactorVerifiedAt: new Date(),
    },
  });

  // Drop the cached session snapshot so the very next session.update() reads the
  // fresh twoFactorEnabled=true instead of the stale (up to 20s) cached value.
  // Without this the setup modal can briefly reappear and the user gets a
  // spurious "2FA is already enabled" error if they click Begin setup again.
  invalidateSessionValidation(user.id);

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "2fa.enabled",
      entity: "User",
      entityId: user.id,
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true, message: "2FA activated successfully." });
}
