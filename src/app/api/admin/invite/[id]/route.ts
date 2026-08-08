import { NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { getPartner } from "@/lib/partners";
import { env } from "@/lib/env";
import { renderInviteEmail, renderAccountApprovedEmail } from "@/lib/email/templates";
import { adminInviteInScope } from "@/lib/security/ownership";

// Keep in sync with the create route — how long a fresh onboarding link stays valid.
const INVITE_EXPIRY_DAYS = 15;

// A plain admin needs the master-admin-granted "invites" tab to touch invites.
function adminLacksInvitePermission(user: { role: string; allowedTabs?: string[] }): boolean {
  return user.role === "ADMIN" && !(user.allowedTabs ?? []).includes("invites");
}

const PatchBody = z.object({
  action: z.enum(["approve", "reject", "resend", "update", "reshare"]),
  reason: z.string().optional(),
  phone: z.string().min(10).max(15).optional(),
  email: z.string().email().optional(),
  name: z.string().min(2).optional(),
});

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  if (!["MASTER_ADMIN", "ADMIN", "SUPPORT"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (adminLacksInvitePermission(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = PatchBody.safeParse(await req.json());
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const invite = await prisma.invite.findUnique({ where: { id } });
  if (!invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  // An admin may only act on invites within their own hierarchy scope.
  if (!(await adminInviteInScope(user, invite))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (parsed.data.action === "update") {
    if (invite.status !== "PENDING") {
      return NextResponse.json(
        { error: `Cannot edit invite with status ${invite.status}` },
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
      const existingUser = await prisma.user.findFirst({
        where: { OR: contactChecks },
      });
      if (existingUser) {
        return NextResponse.json(
          { error: "A user with this email or phone already exists" },
          { status: 409 }
        );
      }

      const existingInvite = await prisma.invite.findFirst({
        where: {
          id: { not: id },
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
      where: { id },
      data: {
        ...(phone ? { phone } : {}),
        ...(email ? { email } : {}),
        ...(name !== undefined ? { name } : {}),
      },
    });

    // Resend the onboarding link to the corrected contact details
    const appUrl = env.NEXT_PUBLIC_APP_URL;
    const onboardingLink = `${appUrl}/onboard?token=${updated.token}`;
    let emailSent = false;
    let emailError: string | undefined;

    try {
      const emailProvider = getPartner("email");
      const { subject, html } = renderInviteEmail({
        name: updated.name ?? undefined,
        role: updated.role,
        onboardingLink,
        expiresAt: updated.expiresAt,
      });
      const result = await emailProvider.send({
        from: process.env.EMAIL_FROM_INFO || process.env.EMAIL_FROM,
        to: updated.email,
        subject,
        html,
      });
      emailSent = result.ok;
      if (!result.ok) emailError = `${result.code}: ${result.message}`;
    } catch (e) {
      emailError = (e as Error).message;
    }

    try {
      const smsProvider = getPartner("sms");
      await smsProvider.sendTransactional({
        phone: updated.phone,
        templateId: "onboard_invite",
        variables: {
          link: onboardingLink,
          role: updated.role.replace(/_/g, " "),
        },
      });
    } catch {
      // SMS failure shouldn't block the update
    }

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "invite.updated",
        entity: "Invite",
        entityId: id,
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
      invite: updated,
      emailSent,
      ...(emailError ? { emailError } : {}),
    });
  }

  if (parsed.data.action === "resend") {
    if (invite.status !== "PENDING") {
      return NextResponse.json(
        { error: `Cannot resend invite with status ${invite.status}` },
        { status: 400 }
      );
    }

    const appUrl = env.NEXT_PUBLIC_APP_URL;
    const onboardingLink = `${appUrl}/onboard?token=${invite.token}`;
    let emailSent = false;
    let emailError: string | undefined;

    try {
      const emailProvider = getPartner("email");
      const { subject, html } = renderInviteEmail({
        name: invite.name ?? undefined,
        role: invite.role,
        onboardingLink,
        expiresAt: invite.expiresAt,
        isReminder: true,
      });
      const result = await emailProvider.send({
        from: process.env.EMAIL_FROM_INFO || process.env.EMAIL_FROM,
        to: invite.email,
        subject,
        html,
      });
      emailSent = result.ok;
      if (!result.ok) emailError = `${result.code}: ${result.message}`;
    } catch (e) {
      emailError = (e as Error).message;
    }

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "invite.resent",
        entity: "Invite",
        entityId: id,
        meta: { email: invite.email, emailSent, emailError },
        ip: clientIp(req),
      },
    });

    return NextResponse.json({
      ok: true,
      emailSent,
      ...(emailError ? { emailError } : {}),
      message: emailSent
        ? "Onboarding email resent successfully"
        : `Failed to send email${emailError ? ` — ${emailError}` : " — please check email provider configuration"}`,
    });
  }

  // Reshare regenerates a fresh, unexpired onboarding link for an applicant who
  // never finished. Only PENDING (link still alive but the invitee stalled) and
  // EXPIRED (link timed out) invites qualify — anything further along has a real
  // User attached and shouldn't have its onboarding restarted.
  if (parsed.data.action === "reshare") {
    if (invite.status !== "PENDING" && invite.status !== "EXPIRED") {
      return NextResponse.json(
        { error: `Cannot reshare invite with status ${invite.status}` },
        { status: 400 }
      );
    }
    if (invite.userId) {
      return NextResponse.json(
        { error: "This applicant has already registered — reshare is not available" },
        { status: 400 }
      );
    }

    // Issue a brand-new token so any previously shared (now dead/leaked) link is
    // invalidated, and reset the clock + status so the invitee can start over.
    const freshToken = nanoid(24);
    const updated = await prisma.invite.update({
      where: { id },
      data: {
        token: freshToken,
        status: "PENDING",
        expiresAt: new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    const appUrl = env.NEXT_PUBLIC_APP_URL;
    const onboardingLink = `${appUrl}/onboard?token=${updated.token}`;
    let emailSent = false;
    let emailError: string | undefined;

    try {
      const emailProvider = getPartner("email");
      const { subject, html } = renderInviteEmail({
        name: updated.name ?? undefined,
        role: updated.role,
        onboardingLink,
        expiresAt: updated.expiresAt,
        isReminder: true,
      });
      const result = await emailProvider.send({
        from: process.env.EMAIL_FROM_INFO || process.env.EMAIL_FROM,
        to: updated.email,
        subject,
        html,
      });
      emailSent = result.ok;
      if (!result.ok) emailError = `${result.code}: ${result.message}`;
    } catch (e) {
      emailError = (e as Error).message;
    }

    try {
      const smsProvider = getPartner("sms");
      await smsProvider.sendTransactional({
        phone: updated.phone,
        templateId: "onboard_invite",
        variables: {
          link: onboardingLink,
          role: updated.role.replace(/_/g, " "),
        },
      });
    } catch {
      // SMS failure shouldn't block resharing — the admin still gets the link back.
    }

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "invite.reshared",
        entity: "Invite",
        entityId: id,
        meta: {
          previousStatus: invite.status,
          email: updated.email,
          emailSent,
          emailError,
        },
        ip: clientIp(req),
      },
    });

    return NextResponse.json({
      ok: true,
      invite: updated,
      onboardingLink,
      emailSent,
      ...(emailError ? { emailError } : {}),
      message: emailSent
        ? "Fresh onboarding link generated and sent"
        : `Fresh onboarding link generated${emailError ? ` — email failed: ${emailError}` : ", but email delivery failed"}`,
    });
  }

  if (invite.status !== "VERIFIED" && invite.status !== "REGISTERED") {
    return NextResponse.json(
      { error: `Cannot ${parsed.data.action} invite with status ${invite.status}` },
      { status: 400 }
    );
  }

  if (parsed.data.action === "approve") {
    await prisma.$transaction(async (tx) => {
      await tx.invite.update({
        where: { id },
        data: { status: "APPROVED", approvedAt: new Date() },
      });

      if (invite.userId) {
        await tx.user.update({
          where: { id: invite.userId },
          data: { status: "ACTIVE" },
        });

        // Keep the KYC review queue in sync: approving the onboarding invite
        // also clears the applicant's pending KYC so it doesn't linger in the
        // "Awaiting review" tab.
        await tx.kyc.updateMany({
          where: { userId: invite.userId, status: "PENDING_REVIEW" },
          data: {
            status: "APPROVED",
            reviewedById: user.id,
            reviewedAt: new Date(),
            rejectedReason: null,
          },
        });
      }
    });

    let emailSent = false;
    let emailError: string | undefined;
    try {
      const approvedUser = invite.userId
        ? await prisma.user.findUnique({
            where: { id: invite.userId },
            select: { name: true, email: true },
          })
        : null;
      const loginLink = `${env.NEXT_PUBLIC_APP_URL}/login`;
      const { subject, html } = renderAccountApprovedEmail({
        name: approvedUser?.name ?? invite.name ?? undefined,
        role: invite.role,
        loginLink,
        email: approvedUser?.email ?? invite.email,
      });
      const emailProvider = getPartner("email");
      const result = await emailProvider.send({
        from: process.env.EMAIL_FROM_INFO || process.env.EMAIL_FROM,
        to: approvedUser?.email ?? invite.email,
        subject,
        html,
      });
      emailSent = result.ok;
      if (!result.ok) emailError = `${result.code}: ${result.message}`;
    } catch (e) {
      emailError = (e as Error).message;
    }

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "invite.approved",
        entity: "Invite",
        entityId: id,
        meta: { approvedUserId: invite.userId, emailSent, emailError },
        ip: clientIp(req),
      },
    });

    return NextResponse.json({
      ok: true,
      status: "APPROVED",
      emailSent,
      ...(emailError ? { emailError } : {}),
    });
  } else {
    await prisma.$transaction(async (tx) => {
      await tx.invite.update({
        where: { id },
        data: {
          status: "REJECTED",
          rejectedAt: new Date(),
          rejectedReason: parsed.data.reason ?? "Rejected by admin",
        },
      });

      if (invite.userId) {
        await tx.user.update({
          where: { id: invite.userId },
          data: { status: "SUSPENDED" },
        });

        // Mirror the rejection onto the KYC queue so it doesn't stay pending.
        await tx.kyc.updateMany({
          where: { userId: invite.userId, status: "PENDING_REVIEW" },
          data: {
            status: "REJECTED",
            reviewedById: user.id,
            reviewedAt: new Date(),
            rejectedReason: parsed.data.reason ?? "Rejected by admin",
          },
        });
      }
    });

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "invite.rejected",
        entity: "Invite",
        entityId: id,
        meta: { rejectedUserId: invite.userId, reason: parsed.data.reason },
        ip: clientIp(req),
      },
    });

    return NextResponse.json({ ok: true, status: "REJECTED" });
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  if (!["MASTER_ADMIN", "ADMIN", "SUPPORT"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (adminLacksInvitePermission(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const invite = await prisma.invite.findUnique({ where: { id } });
  if (!invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  // An admin may only view invites within their own hierarchy scope.
  if (!(await adminInviteInScope(user, invite))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const allResults = await prisma.verificationResult.findMany({
    where: { inviteId: id },
    orderBy: { createdAt: "desc" },
  });

  // Split KYC verifications (PAN/Aadhaar/Bank/GST) from uploaded documents.
  // Documents are stored as VerificationResult rows of type DOCUMENT_* with
  // status "Uploaded" — treat them as attachments, not pass/fail checks.
  const verifications = allResults.filter(
    (v) => !v.type.startsWith("DOCUMENT_")
  );
  const documents = allResults
    .filter((v) => v.type.startsWith("DOCUMENT_"))
    .map((v) => {
      const payload = (v.requestPayload ?? {}) as Record<string, unknown>;
      return {
        id: v.id,
        type: v.type.replace("DOCUMENT_", ""),
        status: v.status,
        url: (payload.url as string) ?? null,
        format: (payload.format as string) ?? null,
        publicId: (payload.publicId as string) ?? null,
        resourceType: (payload.resourceType as string) ?? "image",
        gpsLatitude: (payload.gpsLatitude as number) ?? null,
        gpsLongitude: (payload.gpsLongitude as number) ?? null,
        createdAt: v.createdAt.toISOString(),
      };
    });

  let registeredUser = null;
  if (invite.userId) {
    registeredUser = await prisma.user.findUnique({
      where: { id: invite.userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        shopName: true,
        state: true,
        city: true,
        pincode: true,
        createdAt: true,
      },
    });
  }

  // Who shared/created this invite (network distributor or staff member).
  const invitedBy = invite.invitedById
    ? await prisma.user.findUnique({
        where: { id: invite.invitedById },
        select: { id: true, name: true, role: true, userCode: true },
      })
    : null;

  const onboardingLink = `${env.NEXT_PUBLIC_APP_URL}/onboard?token=${invite.token}`;

  // Successor (upline) responsibility declaration approvals for this invite,
  // so admins can audit who approved the subordinate and see the evidence.
  const declarationApprovalRows = await prisma.declarationApproval.findMany({
    where: { inviteId: id },
    orderBy: { createdAt: "desc" },
  });
  const approverIds = [...new Set(declarationApprovalRows.map((a) => a.approverId))];
  const approvers = approverIds.length
    ? await prisma.user.findMany({
        where: { id: { in: approverIds } },
        select: { id: true, name: true, email: true, phone: true, role: true },
      })
    : [];
  const approverMap = new Map(approvers.map((a) => [a.id, a]));

  const declarationApprovals = declarationApprovalRows.map((a) => {
    const approver = approverMap.get(a.approverId);
    return {
      id: a.id,
      status: a.status,
      approverName: approver?.name ?? null,
      approverRole: a.approverRole,
      onboardeeRole: a.onboardeeRole,
      approvedAt: a.approvedAt?.toISOString() ?? null,
      rejectedAt: a.rejectedAt?.toISOString() ?? null,
      rejectedReason: a.rejectedReason ?? null,
      approvalLatitude: a.approvalLatitude,
      approvalLongitude: a.approvalLongitude,
      approvalIp: a.approvalIp,
      approverSignatureUrl: a.approverSignatureUrl,
      approverSelfieUrl: a.approverSelfieUrl,
      hasDocument: !!a.declarationDocUrl,
      sentAt: a.createdAt.toISOString(),
    };
  });

  // A PENDING invite past its expiry reads as EXPIRED to admins (kept in sync
  // with the list endpoint). The DB row is left PENDING so reshare still works.
  const effectiveInvite = {
    ...invite,
    status:
      invite.status === "PENDING" && invite.expiresAt < new Date()
        ? "EXPIRED"
        : invite.status,
  };

  return NextResponse.json({
    invite: effectiveInvite,
    invitedBy,
    onboardingLink,
    verifications,
    documents,
    registeredUser,
    declarationApprovals,
  });
}
