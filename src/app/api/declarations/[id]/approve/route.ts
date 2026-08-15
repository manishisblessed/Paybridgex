import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { buildDeclarationData } from "@/lib/declaration/data";
import { generateSuccessorDeclarationPdf } from "@/lib/declaration/generatePdf";
import { uploadPdfToCloudinary } from "@/lib/cloudinary";
import type { ApprovalEvidence } from "@/lib/declaration/types";
import { getPartner } from "@/lib/partners";

const Body = z.object({
  signatureUrl: z.string().url(),
  selfieUrl: z.string().url(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  // Raw image data URLs — embedded into the final signed PDF audit record.
  signatureDataUrl: z.string().startsWith("data:").optional(),
  selfieDataUrl: z.string().startsWith("data:").optional(),
});

function dataUrlToBuffer(dataUrl?: string): Buffer | undefined {
  if (!dataUrl) return undefined;
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return undefined;
  try {
    return Buffer.from(dataUrl.slice(comma + 1), "base64");
  } catch {
    return undefined;
  }
}

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

  // Expire the approval if its invite has lapsed — a stale link cannot be
  // used to approve a subordinate into the network.
  const inviteForExpiry = await prisma.invite.findFirst({
    where: { id: approval.inviteId },
    select: { expiresAt: true },
  });
  if (inviteForExpiry?.expiresAt && new Date() > inviteForExpiry.expiresAt) {
    await prisma.declarationApproval.update({
      where: { id },
      data: { status: "EXPIRED" },
    });
    return NextResponse.json(
      { error: "This onboarding invite has expired. The applicant must be re-invited." },
      { status: 400 }
    );
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const ip = clientIp(req);
  const userAgent = req.headers.get("user-agent") ?? undefined;
  const now = new Date();

  const updated = await prisma.declarationApproval.update({
    where: { id },
    data: {
      status: "APPROVED",
      approverSignatureUrl: parsed.data.signatureUrl,
      approverSelfieUrl: parsed.data.selfieUrl,
      approvedAt: now,
      approvalIp: ip,
      approvalUserAgent: userAgent,
      approvalLatitude: parsed.data.latitude,
      approvalLongitude: parsed.data.longitude,
    },
  });

  // Generate + store the final, signed responsibility declaration as the audit
  // record. Never let a PDF/upload hiccup roll back a completed approval.
  try {
    const data = await buildDeclarationData(approval.inviteId);
    if (data) {
      const approvedAtLabel = new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
      }).format(now);
      const evidence: ApprovalEvidence = {
        approverName: user.name,
        signaturePng: dataUrlToBuffer(parsed.data.signatureDataUrl),
        selfieJpg: dataUrlToBuffer(parsed.data.selfieDataUrl),
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
        approvedAt: approvedAtLabel,
        ip: ip ?? undefined,
      };
      const pdf = await generateSuccessorDeclarationPdf(data, evidence);
      const uploaded = await uploadPdfToCloudinary(Buffer.from(pdf), {
        userId: user.id,
        type: "successor_declaration",
      });
      await prisma.declarationApproval.update({
        where: { id },
        data: { declarationDocUrl: uploaded.public_id },
      });
    }
  } catch {
    /* audit PDF is best-effort; approval already persisted */
  }

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "declaration.approved",
      entity: "DeclarationApproval",
      entityId: id,
      ip,
      userAgent,
      meta: {
        inviteId: approval.inviteId,
        onboardeeRole: approval.onboardeeRole,
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
        approvedAt: now.toISOString(),
      },
    },
  });

  const invite = await prisma.invite.findFirst({
    where: { id: approval.inviteId },
    select: { name: true, phone: true, email: true, role: true, userId: true },
  });

  // The onboardee is typically still mid-wizard (no user account yet) and polls
  // the declaration status, so reach them via their invite contact. Only create
  // an in-app notification if a real user account already exists for them.
  if (invite?.userId) {
    try {
      await prisma.notification.create({
        data: {
          userId: invite.userId,
          title: "Declaration Approved",
          body: `${user.name} (${approval.approverRole.replace(/_/g, " ")}) has approved your declaration. You can now complete your registration.`,
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
        subject: "Paybridgex — Your declaration has been approved",
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;">
            <h1 style="color:#1e293b;font-size:22px;margin:0 0 16px;">Declaration Approved</h1>
            <p>Hi <strong>${invite.name ?? "there"}</strong>,</p>
            <p><strong>${user.name}</strong> (${approval.approverRole.replace(/_/g, " ")}) has approved your responsibility declaration.</p>
            <p>You can now return to your onboarding and complete your registration.</p>
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
        templateId: "declaration_approved",
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
      approvedAt: updated.approvedAt?.toISOString(),
    },
  });
}
