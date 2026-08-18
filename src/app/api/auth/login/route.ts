import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createMobileToken, createSessionGrant } from "@/lib/auth-server";
import { createTempToken } from "@/lib/two-factor";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import {
  assertNotLocked,
  recordFailedLogin,
  recordSuccessfulLogin,
  recentFailureCount,
  normalizeIdentifier,
} from "@/lib/security/lockout";
import { assertCaptcha } from "@/lib/security/captcha";
import {
  logSecurityEvent,
  detectLoginAnomalies,
  deviceHash,
  clientIp,
} from "@/lib/security/audit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { getLoginBlock } from "@/lib/security/accountGate";

const LocationSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number().optional(),
});

const Body = z.object({
  identifier: z.string().min(3).max(120),
  password: z.string().min(1).max(200),
  location: LocationSchema,
  captchaToken: z.string().max(4000).optional(),
  // Optional role assertion. When the public login form sends this, the
  // credentials must match a user whose role equals it — otherwise we return
  // the same generic "Invalid credentials" so an attacker can never learn a
  // real account's role. Admin/staff login pages omit this field and are
  // unaffected.
  role: z
    .enum(["RETAILER", "DISTRIBUTOR", "MASTER_DISTRIBUTOR", "SUPER_DISTRIBUTOR"])
    .optional(),
});

/**
 * POST /api/auth/login
 * Step 1 of login — validates email/phone + password, with brute-force
 * lockout, IP+identifier rate limiting, optional CAPTCHA, and login-anomaly
 * detection. Never reveals whether the identifier exists.
 *
 * If 2FA is enabled: returns { needs2FA: true, tempToken } — no session issued.
 * If 2FA is NOT enabled: returns { needs2FA: false, needsSetup: true }.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ip = clientIp(req);
  const userAgent = req.headers.get("user-agent") || "unknown";

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Location verification is required. Please allow location access." },
      { status: 400 }
    );
  }

  const { identifier, password, location, captchaToken, role: assertedRole } = parsed.data;
  const normalized = normalizeIdentifier(identifier);

  try {
    // 1) Rate limit by IP and by identifier (fixed window, shared across PM2).
    await enforceRateLimit(`login:ip:${ip}`, RATE_LIMITS.login);
    await enforceRateLimit(`login:id:${normalized}`, RATE_LIMITS.login);

    // 2) Bot/abuse gate (no-op unless SECURITY_CAPTCHA_ENABLED).
    await assertCaptcha(captchaToken, ip);

    // 3) Brute-force lockout (exponential backoff across windows).
    await assertNotLocked(normalized);
  } catch (e) {
    return toErrorResponse(e);
  }

  try {
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: normalized }, { phone: normalized }], deletedAt: null },
    });

    const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;

    if (!user || !valid) {
      const { failedCount, locked, lockedUntil } = await recordFailedLogin(normalized, ip);
      await logSecurityEvent({
        action: "auth.login_failed",
        severity: locked ? "danger" : "warn",
        userId: user?.id ?? null,
        entity: "User",
        entityId: user?.id ?? null,
        ip,
        userAgent,
        meta: { identifier: normalized, failedCount, locked, lockedUntil: lockedUntil?.toISOString() ?? null },
      });
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Role assertion: if the public login form supplied a role, the account's
    // real role must match. Return the SAME generic error as an invalid
    // password to avoid leaking whether the account exists or what role it
    // holds. We do NOT increment the brute-force counter here — reaching this
    // branch already required a valid password, so an honest user who picked
    // the wrong role card should be able to hit "change" and retry freely.
    if (assertedRole && user.role !== assertedRole) {
      await logSecurityEvent({
        action: "auth.login_role_mismatch",
        severity: "warn",
        userId: user.id,
        entity: "User",
        entityId: user.id,
        ip,
        userAgent,
        meta: { attemptedRole: assertedRole, actualRole: user.role },
      });
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const loginBlock = getLoginBlock(user.status);
    if (loginBlock) {
      await logSecurityEvent({
        action: "auth.login_blocked",
        severity: "warn",
        userId: user.id,
        entity: "User",
        entityId: user.id,
        ip,
        userAgent,
        meta: { reason: loginBlock.code },
      });
      return NextResponse.json(
        { error: loginBlock.error, code: loginBlock.code },
        { status: 403 }
      );
    }

    // Successful credential check — clear lockout counter.
    const priorFailures = await recentFailureCount(normalized);
    await recordSuccessfulLogin(normalized);

    // Anomaly detection against the user's last known login context.
    const anomalies = detectLoginAnomalies({
      lastLoginLat: user.lastLoginLat,
      lastLoginLng: user.lastLoginLng,
      lastLoginAt: user.lastLoginAt,
      knownDevices: user.knownDevices ?? [],
      lat: location.lat,
      lng: location.lng,
      userAgent,
      recentFailures: priorFailures,
    });

    const device = deviceHash(userAgent);
    const knownDevices = Array.from(new Set([...(user.knownDevices ?? []), device])).slice(-10);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginLat: location.lat,
        lastLoginLng: location.lng,
        lastLoginAt: new Date(),
        lastLoginIp: ip,
        lastLoginUserAgent: userAgent.slice(0, 512),
        knownDevices,
      },
    });

    await logSecurityEvent({
      action: "auth.login",
      severity: anomalies.flagged ? "danger" : "info",
      userId: user.id,
      entity: "User",
      entityId: user.id,
      ip,
      userAgent,
      meta: {
        lat: location.lat,
        lng: location.lng,
        accuracy: location.accuracy,
        anomalies,
      },
    });

    // 2FA is mandatory for all users.
    if (user.twoFactorEnabled && user.twoFactorSecret) {
      const tempToken = createTempToken(user.id);
      return NextResponse.json({
        ok: true,
        needs2FA: true,
        needsSetup: false,
        tempToken,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      });
    }

    // 2FA NOT configured — issue a session grant so the frontend can
    // call signIn("token-login") without a second password check. Also
    // include a mobile token for native clients.
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
      twoFactorEnabled: user.twoFactorEnabled,
    };

    const token = createMobileToken(sessionUser);
    const grant = createSessionGrant(user.id);

    return NextResponse.json({
      ok: true,
      needs2FA: false,
      needsSetup: true,
      token,
      grant,
      user: sessionUser,
    });
  } catch (err) {
    console.error("[auth/login] Unhandled error:", err);
    return NextResponse.json(
      { error: "Internal server error. Please try again." },
      { status: 500 }
    );
  }
}
