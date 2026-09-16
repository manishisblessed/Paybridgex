import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { clientIp, logSecurityEvent } from "@/lib/security/audit";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

/**
 * Self-service login (second-factor) method management.
 *
 * Any user may CHOOSE to sign in with their transaction PIN instead of an
 * authenticator app — no admin permission required. Because a 4–6 digit PIN is
 * weaker than a TOTP authenticator, enabling it is a deliberate security
 * downgrade, so the user must accept a liability declaration (all account risk
 * is theirs; the company bears no responsibility). The acceptance is recorded.
 *
 * When BOTH an authenticator and TPIN login are available, the user picks which
 * to use at every login; a saved default lets the login chooser be pre-selected
 * or skipped.
 *
 *   GET  → current capabilities + preference
 *   POST → { action: "enablePinLogin", riskAccepted: true }
 *          { action: "disablePinLogin" }
 *          { action: "setPreference", preferred: "authenticator" | "tpin" | null }
 */

// Highly-privileged staff accounts may not weaken their own login to a PIN.
const SELF_PIN_LOGIN_BLOCKED_ROLES = new Set(["ADMIN", "MASTER_ADMIN"]);

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("enablePinLogin"),
    // Must be literally true — the declaration is mandatory.
    riskAccepted: z.literal(true),
  }),
  z.object({ action: z.literal("disablePinLogin") }),
  z.object({
    action: z.literal("setPreference"),
    preferred: z.enum(["authenticator", "tpin"]).nullable(),
  }),
]);

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

async function loadState(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
      twoFactorExempt: true,
      pinLoginEnabled: true,
      txnPinHash: true,
      pinLoginRiskAcceptedAt: true,
      preferredLoginMethod: true,
    },
  });
  return user;
}

function summarize(user: NonNullable<Awaited<ReturnType<typeof loadState>>>) {
  const canAuthenticator = Boolean(user.twoFactorEnabled && user.twoFactorSecret);
  const pinLoginEnabled = Boolean(
    user.twoFactorExempt && user.pinLoginEnabled && user.txnPinHash
  );
  return {
    // Whether this account is allowed to self-manage PIN login at all.
    selfManageable: !SELF_PIN_LOGIN_BLOCKED_ROLES.has(user.role),
    twoFactorEnabled: canAuthenticator,
    hasTxnPin: Boolean(user.txnPinHash),
    pinLoginEnabled,
    riskAccepted: Boolean(user.pinLoginRiskAcceptedAt),
    // The login chooser only appears when BOTH factors are usable.
    canChoose: canAuthenticator && pinLoginEnabled,
    preferred: user.preferredLoginMethod ?? null,
  };
}

export async function GET() {
  try {
    const auth = await requireAuth();
    const user = await loadState(auth.id);
    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(summarize(user));
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAuth();
    await enforceRateLimit(`loginmethod:${auth.id}`, RATE_LIMITS.twoFactor);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const user = await loadState(auth.id);
    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const state = summarize(user);
    const body = parsed.data;
    const ip = clientIp(req);

    // ── Enable TPIN login (self-service) ────────────────────────────────────
    if (body.action === "enablePinLogin") {
      if (!state.selfManageable) {
        return NextResponse.json(
          { error: "PIN login can't be enabled for this account type." },
          { status: 403 }
        );
      }
      if (!user.txnPinHash) {
        return NextResponse.json(
          {
            error: "Set a transaction PIN first, then enable PIN login.",
            code: "NO_TXN_PIN",
          },
          { status: 400 }
        );
      }

      await prisma.$transaction([
        prisma.user.update({
          where: { id: auth.id },
          data: {
            twoFactorExempt: true,
            pinLoginEnabled: true,
            pinLoginRiskAcceptedAt: new Date(),
            pinLoginRiskAcceptedIp: ip,
          },
        }),
        prisma.auditLog.create({
          data: {
            userId: auth.id,
            action: "user.pin_login_self_enabled",
            entity: "User",
            entityId: auth.id,
            meta: { self: true },
            ip,
          },
        }),
      ]);

      await logSecurityEvent({
        action: "auth.pin_login_self_enabled",
        severity: "warn",
        userId: auth.id,
        entity: "User",
        entityId: auth.id,
        ip,
        meta: { self: true },
      });

      const fresh = await loadState(auth.id);
      return NextResponse.json({ ok: true, ...summarize(fresh!) });
    }

    // ── Disable TPIN login (restore authenticator-only) ─────────────────────
    if (body.action === "disablePinLogin") {
      await prisma.$transaction([
        prisma.user.update({
          where: { id: auth.id },
          data: {
            twoFactorExempt: false,
            pinLoginEnabled: false,
            pinLoginRiskAcceptedAt: null,
            pinLoginRiskAcceptedIp: null,
            preferredLoginMethod: null,
          },
        }),
        prisma.auditLog.create({
          data: {
            userId: auth.id,
            action: "user.pin_login_self_disabled",
            entity: "User",
            entityId: auth.id,
            meta: { self: true },
            ip,
          },
        }),
      ]);

      const fresh = await loadState(auth.id);
      return NextResponse.json({ ok: true, ...summarize(fresh!) });
    }

    // ── Set the preferred method (only meaningful when both are available) ───
    if (body.action === "setPreference") {
      if (body.preferred === "authenticator" && !state.twoFactorEnabled) {
        return NextResponse.json(
          { error: "You don't have an authenticator app set up." },
          { status: 400 }
        );
      }
      if (body.preferred === "tpin" && !state.pinLoginEnabled) {
        return NextResponse.json(
          { error: "PIN login isn't enabled for your account." },
          { status: 400 }
        );
      }

      await prisma.user.update({
        where: { id: auth.id },
        data: { preferredLoginMethod: body.preferred },
      });

      const fresh = await loadState(auth.id);
      return NextResponse.json({ ok: true, ...summarize(fresh!) });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return toErrorResponse(e);
  }
}
