import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { needsSuccessorApproval } from "@/lib/declaration/types";
import { getPartner } from "@/lib/partners";
import { env } from "@/lib/env";

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
    await emailProvider.send({
      to: inviter.email,
      subject: `Paybridgex — Declaration Approval Required for ${invite.name ?? invite.phone}`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;">
          <h1 style="color:#1e293b;font-size:22px;margin:0 0 16px;">Declaration Approval Required</h1>
          <p>Hi <strong>${inviter.name}</strong>,</p>
          <p><strong>${invite.name ?? invite.phone}</strong> is onboarding as a <strong>${invite.role.replace(/_/g, " ")}</strong> under your network and has requested your declaration approval.</p>
          <p>As per company policy, you need to review the responsibility & indemnity declaration, provide your signature, selfie, and approve the onboarding.</p>
          <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:12px;padding:16px;margin:20px 0;">
            <p style="margin:0;font-weight:600;color:#92400e;">By approving, you accept responsibility for all activities performed by this ${invite.role.replace(/_/g, " ")}.</p>
          </div>
          <div style="text-align:center;margin:24px 0;">
            <a href="${approvalUrl}" style="display:inline-block;padding:14px 32px;background:#1b45ea;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">Review & Approve</a>
          </div>
          <p style="color:#64748b;font-size:13px;">Please review within 24 hours. The applicant cannot complete registration until this is approved.</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
          <p style="color:#94a3b8;font-size:12px;text-align:center;">Paybridgex — K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED</p>
        </div>
      `,
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
