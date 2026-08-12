import { NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { ONBOARD_CAPABLE_ROLES } from "@/lib/hierarchy";
import { computeInviteExpiry } from "@/lib/onboarding/inviteExpiry";
import { sendInviteLink, onboardingLinkFor } from "@/lib/onboarding/inviteNotifications";
import { getOnboardingProgressForInvite } from "@/lib/onboarding/status";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * GET — step-by-step onboarding progress for an invite the caller shared,
 * including invites the invitee hasn't finished registering yet. The wizard
 * saves each completed step against the invite, so this lets the upline watch
 * exactly which step an applicant is stuck on in real time. Status-only — no
 * documents or raw KYC PII (only the contact details the parent already entered).
 *
 * Guard: strictly the invite's own creator (`invitedById === caller`).
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireAuth();

    if (!(ONBOARD_CAPABLE_ROLES as string[]).includes(user.role)) {
      return NextResponse.json(
        { error: "You cannot view onboarding invites" },
        { status: 403 }
      );
    }

    const invite = await prisma.invite.findUnique({ where: { id: params.id } });
    if (!invite)
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });

    if (invite.invitedById !== user.id) {
      return NextResponse.json(
        { error: "This invite was not shared by you" },
        { status: 403 }
      );
    }

    const progress = await getOnboardingProgressForInvite(invite);

    return NextResponse.json({
      user: {
        id: invite.userId,
        name: invite.name,
        userCode: null,
        phone: invite.phone,
        role: invite.role,
        createdAt: invite.createdAt.toISOString(),
      },
      ...progress,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    return toErrorResponse(e);
  }
}

const PatchBody = z.object({
  action: z.enum(["resend", "reshare", "update", "cancel"]),
  phone: z.string().min(10).max(15).optional(),
  email: z.string().email().optional(),
  name: z.string().min(2).max(100).optional(),
});

/**
 * PATCH — parent-scoped actions on an onboarding invite they shared, for links
 * that have NOT yet converted to a registered account.
 *
 *  - resend  : re-send the same (still-live) link over email + SMS
 *  - reshare : mint a fresh token + reset the expiry clock (for expired/stalled)
 *  - update  : correct the phone / email / name, then re-send the link
 *  - cancel  : revoke the invite (link stops working, drops off the list)
 *
 * Guard: strictly the invite's own creator (`invitedById === caller`) and only
 * while `userId` is null (once registered, the account is managed elsewhere).
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireAuth();

    if (!(ONBOARD_CAPABLE_ROLES as string[]).includes(user.role)) {
      return NextResponse.json(
        { error: "You cannot manage onboarding invites" },
        { status: 403 }
      );
    }

    const parsed = PatchBody.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const invite = await prisma.invite.findUnique({ where: { id: params.id } });
    if (!invite)
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });

    // Ownership: only the parent who shared this link may act on it.
    if (invite.invitedById !== user.id) {
      return NextResponse.json(
        { error: "This invite was not shared by you" },
        { status: 403 }
      );
    }

    // Once someone has registered against the link there's nothing to chase.
    if (invite.userId) {
      return NextResponse.json(
        { error: "This applicant has already registered" },
        { status: 400 }
      );
    }

    const now = new Date();
    const action = parsed.data.action;

    // ── Cancel / revoke (hard delete) ──
    // The link stops working immediately and the invite drops off the list.
    // Any eKYC verification rows are detached (Invite→VerificationResult is
    // onDelete: SetNull), so the KYC audit trail is preserved. We log the
    // revocation to the AuditLog first, before the row is gone.
    if (action === "cancel") {
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: "invite.cancelled",
          entity: "Invite",
          entityId: invite.id,
          meta: {
            email: invite.email,
            phone: invite.phone,
            name: invite.name,
            role: invite.role,
            previousStatus: invite.status,
            deleted: true,
          },
          ip: clientIp(req),
        },
      });
      await prisma.invite.delete({ where: { id: invite.id } });
      return NextResponse.json({ ok: true, deleted: true });
    }

    // ── Resend (same live link) ──
    if (action === "resend") {
      if (invite.status !== "PENDING" || invite.expiresAt < now) {
        return NextResponse.json(
          { error: "This link is no longer live — use Reshare to send a fresh one" },
          { status: 400 }
        );
      }
      const { onboardingLink, emailSent, emailError } = await sendInviteLink(
        invite,
        { isReminder: true }
      );
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: "invite.resent",
          entity: "Invite",
          entityId: invite.id,
          meta: { email: invite.email, emailSent, emailError },
          ip: clientIp(req),
        },
      });
      return NextResponse.json({ ok: true, onboardingLink, emailSent, ...(emailError ? { emailError } : {}) });
    }

    // ── Reshare (fresh token + reset clock) ──
    if (action === "reshare") {
      if (invite.status !== "PENDING" && invite.status !== "EXPIRED") {
        return NextResponse.json(
          { error: `Cannot reshare an invite with status ${invite.status}` },
          { status: 400 }
        );
      }
      const updated = await prisma.invite.update({
        where: { id: invite.id },
        data: {
          token: nanoid(24),
          status: "PENDING",
          expiresAt: await computeInviteExpiry(),
        },
      });
      const { onboardingLink, emailSent, emailError } = await sendInviteLink(
        updated,
        { isReminder: true }
      );
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: "invite.reshared",
          entity: "Invite",
          entityId: invite.id,
          meta: { email: updated.email, previousStatus: invite.status, emailSent, emailError },
          ip: clientIp(req),
        },
      });
      return NextResponse.json({ ok: true, onboardingLink, emailSent, ...(emailError ? { emailError } : {}) });
    }

    // ── Update contact + re-send ──
    if (invite.status !== "PENDING") {
      return NextResponse.json(
        { error: `Cannot edit an invite with status ${invite.status}` },
        { status: 400 }
      );
    }

    const phone = parsed.data.phone?.replace(/\s/g, "");
    const email = parsed.data.email?.toLowerCase();
    const name = parsed.data.name;

    if (!phone && !email && name === undefined) {
      return NextResponse.json(
        { error: "Provide a new phone, email or name to update" },
        { status: 400 }
      );
    }

    const contactChecks: { email?: string; phone?: string }[] = [];
    if (email && email !== invite.email) contactChecks.push({ email });
    if (phone && phone !== invite.phone) contactChecks.push({ phone });

    if (contactChecks.length > 0) {
      const existingUser = await prisma.user.findFirst({ where: { OR: contactChecks } });
      if (existingUser) {
        return NextResponse.json(
          { error: "A user with this email or phone already exists" },
          { status: 409 }
        );
      }
      const existingInvite = await prisma.invite.findFirst({
        where: {
          id: { not: invite.id },
          OR: contactChecks,
          status: { in: ["PENDING", "REGISTERED"] },
        },
      });
      if (existingInvite) {
        return NextResponse.json(
          { error: "An active invite already exists for this email or phone" },
          { status: 409 }
        );
      }
    }

    const updated = await prisma.invite.update({
      where: { id: invite.id },
      data: {
        ...(phone ? { phone } : {}),
        ...(email ? { email } : {}),
        ...(name !== undefined ? { name } : {}),
      },
    });

    const { onboardingLink, emailSent, emailError } = await sendInviteLink(updated);

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "invite.updated",
        entity: "Invite",
        entityId: invite.id,
        meta: {
          before: { phone: invite.phone, email: invite.email, name: invite.name },
          after: { phone: updated.phone, email: updated.email, name: updated.name },
          emailSent,
          emailError,
        },
        ip: clientIp(req),
      },
    });

    return NextResponse.json({
      ok: true,
      onboardingLink: onboardingLink ?? onboardingLinkFor(updated.token),
      emailSent,
      ...(emailError ? { emailError } : {}),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    return toErrorResponse(e);
  }
}
