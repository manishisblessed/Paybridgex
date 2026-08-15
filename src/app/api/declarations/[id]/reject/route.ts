import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { getPartner } from "@/lib/partners";

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
    select: { name: true, phone: true, email: true, userId: true },
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
      await emailProvider.send({
        to: invite.email,
        subject: "Paybridgex — Your declaration was not approved",
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;">
            <h1 style="color:#1e293b;font-size:22px;margin:0 0 16px;">Declaration Not Approved</h1>
            <p>Hi <strong>${invite.name ?? "there"}</strong>,</p>
            <p><strong>${user.name}</strong> (${approval.approverRole.replace(/_/g, " ")}) could not approve your declaration.</p>
            <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:16px;margin:16px 0;">
              <p style="margin:0;color:#991b1b;"><strong>Reason:</strong> ${parsed.data.reason}</p>
            </div>
            <p>Please contact your upline to resolve this and re-submit your declaration.</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
            <p style="color:#94a3b8;font-size:12px;text-align:center;">Paybridgex — K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED</p>
          </div>
        `,
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
