import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { needsSuccessorApproval } from "@/lib/declaration/types";
import { getPartner } from "@/lib/partners";
import { env } from "@/lib/env";
import { renderDeclarationRequestEmail } from "@/lib/email/templates";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite) {
    return NextResponse.json({ error: "Invalid invite" }, { status: 404 });
  }

  if (!["PENDING", "REGISTERED"].includes(invite.status)) {
    return NextResponse.json({ error: "Invite is no longer active" }, { status: 400 });
  }

  if (new Date() > invite.expiresAt) {
    return NextResponse.json({ error: "Invite has expired" }, { status: 400 });
  }

  const inviter = await prisma.user.findUnique({
    where: { id: invite.invitedById },
    select: { id: true, name: true, email: true, phone: true, role: true },
  });

  if (!inviter) {
    return NextResponse.json({ error: "Inviter not found" }, { status: 404 });
  }

  if (!needsSuccessorApproval(invite.role, inviter.role)) {
    return NextResponse.json(
      { error: "Successor approval is not required for this role combination" },
      { status: 400 }
    );
  }

  const existing = await prisma.declarationApproval.findFirst({
    where: {
      inviteId: invite.id,
      status: { in: ["PENDING", "APPROVED"] },
    },
  });

  if (existing) {
    return NextResponse.json({
      ok: true,
      alreadySent: true,
      approval: {
        id: existing.id,
        status: existing.status,
        approvedAt: existing.approvedAt?.toISOString() ?? null,
      },
    });
  }

  const approval = await prisma.declarationApproval.create({
    data: {
      inviteId: invite.id,
      requestedById: invite.userId ?? invite.invitedById,
      approverId: inviter.id,
      approverRole: inviter.role,
      onboardeeRole: invite.role,
    },
  });

  const appUrl = env.NEXT_PUBLIC_APP_URL;
  const approvalUrl = `${appUrl}/dashboard/approvals`;

  try {
    await prisma.notification.create({
      data: {
        userId: inviter.id,
        title: "Declaration Approval Required",
        body: `${invite.name ?? invite.phone} (${invite.role.replace(/_/g, " ")}) has requested your declaration approval to complete onboarding. Please review and approve in your dashboard.`,
        channel: "INAPP",
      },
    });
  } catch {}

  try {
    const emailProvider = getPartner("email");
    const mail = renderDeclarationRequestEmail({
      approverName: inviter.name,
      applicantName: invite.name ?? invite.phone,
      applicantRole: invite.role,
      approvalLink: approvalUrl,
    });
    await emailProvider.send({
      to: inviter.email,
      subject: mail.subject,
      html: mail.html,
    });
  } catch {}

  try {
    const smsProvider = getPartner("sms");
    await smsProvider.sendTransactional({
      phone: inviter.phone,
      templateId: "declaration_approval",
      variables: {
        name: inviter.name,
        applicantName: invite.name ?? invite.phone,
        role: invite.role.replace(/_/g, " "),
      },
    });
  } catch {}

  return NextResponse.json({
    ok: true,
    approval: {
      id: approval.id,
      status: approval.status,
    },
  });
}
