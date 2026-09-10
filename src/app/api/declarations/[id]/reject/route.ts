import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { getPartner } from "@/lib/partners";
import { env } from "@/lib/env";
import { renderDeclarationRejectedEmail } from "@/lib/email/templates";

const Body = z.object({
  reason: z.string().min(5).max(500),
});

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await requireAuth();

  const approval = await prisma.declarationApproval.findUnique({
    where: { id },
  });

  if (!approval) {
    return NextResponse.json({ error: "Approval not found" }, { status: 404 });
  }

  if (approval.approverId !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  if (approval.status !== "PENDING") {
    return NextResponse.json(
      { error: `This declaration has already been ${approval.status.toLowerCase()}` },
      { status: 400 }
    );
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const ip = clientIp(req);
  const userAgent = req.headers.get("user-agent") ?? undefined;

  const updated = await prisma.declarationApproval.update({
    where: { id },
    data: {
      status: "REJECTED",
      rejectedAt: new Date(),
      rejectedReason: parsed.data.reason,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "declaration.rejected",
      entity: "DeclarationApproval",
      entityId: id,
      ip,
      userAgent,
      meta: {
        inviteId: approval.inviteId,
        onboardeeRole: approval.onboardeeRole,
        reason: parsed.data.reason,
      },
    },
  });

  const invite = await prisma.invite.findFirst({
    where: { id: approval.inviteId },
    select: { name: true, phone: true, email: true, userId: true, token: true },
  });

  if (invite?.userId) {
    try {
      await prisma.notification.create({
        data: {
          userId: invite.userId,
          title: "Declaration Rejected",
          body: `${user.name} (${approval.approverRole.replace(/_/g, " ")}) has rejected your declaration. Reason: ${parsed.data.reason}`,
          channel: "INAPP",
        },
      });
    } catch {}
  }

  if (invite?.email) {
    try {
      const emailProvider = getPartner("email");
      const mail = renderDeclarationRejectedEmail({
        name: invite.name,
        approverName: user.name,
        approverRole: approval.approverRole,
        reason: parsed.data.reason,
        onboardLink: `${env.NEXT_PUBLIC_APP_URL}/onboard?token=${invite.token}`,
      });
      await emailProvider.send({
        to: invite.email,
        subject: mail.subject,
        html: mail.html,
      });
    } catch {}
  }

  if (invite?.phone) {
    try {
      const smsProvider = getPartner("sms");
      await smsProvider.sendTransactional({
        phone: invite.phone,
        templateId: "declaration_rejected",
        variables: {
          name: invite.name ?? "",
          approverName: user.name,
        },
      });
    } catch {}
  }

  return NextResponse.json({
    ok: true,
    approval: {
      id: updated.id,
      status: updated.status,
      rejectedAt: updated.rejectedAt?.toISOString(),
      rejectedReason: updated.rejectedReason,
    },
  });
}
