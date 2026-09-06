import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createMobileToken } from "@/lib/auth-server";
import {
  verifyTempToken,
  decryptSecret,
  verifyTotpCode,
  verifyBackupCode,
  MAX_2FA_ATTEMPTS,
} from "@/lib/two-factor";
import { checkRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { clientIp } from "@/lib/security/audit";
import { getLoginBlock } from "@/lib/security/accountGate";

const Body = z.object({
  tempToken: z.string().min(10),
  code: z.string().min(1).max(20),
  type: z.enum(["totp", "backup"]).default("totp"),
});

/**
 * POST /api/auth/2fa/verify
 * Step 2 of login — verifies the TOTP or backup code using the temp token.
 * Returns a full session token on success.
 *
 * Anti-hack:
 * - Temp token expires in 3 minutes
 * - Max 3 attempts per temp token (tracked server-side)
 * - Constant-time signature verification
 * - Backup codes are single-use
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  // IP-level throttle layered on top of the per-token attempt counter below.
  const rl = await checkRateLimit(`2fa:ip:${clientIp(req)}`, RATE_LIMITS.twoFactor);
  if (!rl.allowed)
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  const { tempToken, code, type } = parsed.data;

  // Verify temp token
  const tokenPayload = verifyTempToken(tempToken);
  if (!tokenPayload) {
    return NextResponse.json(
      { error: "Session expired. Please log in again." },
      { status: 401 }
    );
  }

  // Check attempt count (stored in DB for tamper-proof tracking)
  const userId = tokenPayload.sub;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      walletBalance: true,
      allowedTabs: true,
      enabledServices: true,
      twoFactorSecret: true,
      twoFactorBackupCodes: true,
    },
  });

  if (!user || !user.twoFactorSecret) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  const loginBlock = getLoginBlock(user.status);
  if (loginBlock) {
    return NextResponse.json(
      { error: loginBlock.error, code: loginBlock.code },
      { status: 403 }
    );
  }

  // Rate limiting: use a short-lived cache key for attempts
  // For simplicity, we track attempts via audit log count in last 3 minutes
  const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000);
  const recentAttempts = await prisma.auditLog.count({
    where: {
      userId,
      action: "2fa.attempt_failed",
      createdAt: { gte: threeMinAgo },
    },
  });

  if (recentAttempts >= MAX_2FA_ATTEMPTS) {
    return NextResponse.json(
      { error: "Too many attempts. Please log in again." },
      { status: 429 }
    );
  }

  const secret = decryptSecret(user.twoFactorSecret);
  let verified = false;

  if (type === "totp") {
    verified = verifyTotpCode(secret, code);
  } else if (type === "backup") {
    const result = await verifyBackupCode(code, user.twoFactorBackupCodes);
    if (result.valid) {
      verified = true;
      // Invalidate used backup code
      const updatedCodes = [...user.twoFactorBackupCodes];
      updatedCodes[result.index] = "";
      await prisma.user.update({
        where: { id: userId },
        data: { twoFactorBackupCodes: updatedCodes },
      });
    }
  }

  if (!verified) {
    await prisma.auditLog.create({
      data: {
        userId,
        action: "2fa.attempt_failed",
        entity: "User",
        entityId: userId,
        meta: { type, remainingAttempts: MAX_2FA_ATTEMPTS - recentAttempts - 1 },
        ip: clientIp(req),
      },
    });

    const remaining = MAX_2FA_ATTEMPTS - recentAttempts - 1;
    return NextResponse.json(
      {
        error: "Invalid code.",
        remainingAttempts: Math.max(0, remaining),
      },
      { status: 401 }
    );
  }

  // Success — issue full session token
  await prisma.auditLog.create({
    data: {
      userId,
      action: "2fa.verified",
      entity: "User",
      entityId: userId,
      ip: clientIp(req),
    },
  });

  const sessionUser = {
    id: user.id,
    userCode: (user as { userCode?: string | null }).userCode ?? null,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    walletBalance: Number(user.walletBalance),
    allowedTabs: user.allowedTabs ?? [],
    enabledServices: user.enabledServices ?? [],
    twoFactorEnabled: true,
    twoFactorExempt: (user as { twoFactorExempt?: boolean }).twoFactorExempt ?? false,
  };

  const token = createMobileToken(sessionUser);

  return NextResponse.json({
    ok: true,
    token,
    user: sessionUser,
  });
}
