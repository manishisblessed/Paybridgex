import { NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getPartner } from "@/lib/partners";
import { deleteFromCloudinary } from "@/lib/cloudinary";
import { renderDocResubmissionEmail } from "@/lib/email/templates";
import { docTypeLabel } from "@/lib/onboarding/requiredDocuments";
import { computeInviteExpiry } from "@/lib/onboarding/inviteExpiry";
import { getResubmitStatus } from "@/lib/onboarding/resubmission";

const PatchBody = z.object({
  action: z.enum(["approve", "reject", "request_resubmission"]),
  reason: z.string().optional(),
  // For request_resubmission: the specific uploaded documents to flag, each
  // with its own reason the applicant will see.
  documents: z
    .array(
      z.object({
        documentId: z.string().min(1),
        reason: z.string().trim().min(3).max(500),
      })
    )
    .optional(),
});

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const parsed = PatchBody.safeParse(await req.json());
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const kyc = await prisma.kyc.findUnique({
    where: { id: params.id },
    include: { user: { select: { id: true, status: true } } },
  });

  if (!kyc)
    return NextResponse.json({ error: "KYC record not found" }, { status: 404 });

  // Reviewable when freshly submitted, or when it was awaiting a targeted
  // re-upload (the applicant may have replaced the flagged documents without
  // pressing the final "submit" button — the admin can still act on it).
  if (kyc.status !== "PENDING_REVIEW" && kyc.status !== "AWAITING_RESUBMISSION")
    return NextResponse.json(
      { error: "Only pending KYC applications can be reviewed" },
      { status: 409 }
    );

  if (parsed.data.action === "approve") {
    // If the application was awaiting a targeted re-upload, only approve once
    // every flagged document has actually been replaced, then finalise the
    // re-opened invite and drop the now-stale rejected rows in the same step.
    let resubmitInvite: { id: string } | null = null;
    if (kyc.status === "AWAITING_RESUBMISSION") {
      resubmitInvite = await prisma.invite.findFirst({
        where: { userId: kyc.user.id, status: "RESUBMIT" },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (resubmitInvite) {
        const st = await getResubmitStatus(resubmitInvite.id);
        if (!st.allDone) {
          return NextResponse.json(
            { error: "The applicant still has documents left to re-upload." },
            { status: 409 }
          );
        }
      }
    }

    // Snapshot the stale rejected rows so their private assets can be cleaned
    // up after the state transition commits.
    const rejectedRows = resubmitInvite
      ? await prisma.verificationResult.findMany({
          where: { inviteId: resubmitInvite.id, status: "Rejected" },
          select: { id: true, requestPayload: true },
        })
      : [];

    await prisma.$transaction([
      ...(resubmitInvite
        ? [
            prisma.verificationResult.deleteMany({
              where: { inviteId: resubmitInvite.id, status: "Rejected" },
            }),
          ]
        : []),
      prisma.kyc.update({
        where: { id: params.id },
        data: {
          status: "APPROVED",
          reviewedById: admin.id,
          reviewedAt: new Date(),
          rejectedReason: null,
        },
      }),
      prisma.user.update({
        where: { id: kyc.user.id },
        data: { status: "ACTIVE" },
      }),
      // Keep the onboarding invite in sync so it doesn't stay stuck at
      // VERIFIED/REGISTERED/RESUBMIT once KYC has been approved.
      prisma.invite.updateMany({
        where: {
          userId: kyc.user.id,
          status: { in: ["VERIFIED", "REGISTERED", "RESUBMIT"] },
        },
        data: { status: "APPROVED", approvedAt: new Date() },
      }),
      prisma.auditLog.create({
        data: {
          userId: admin.id,
          action: "kyc.approved",
          entity: "Kyc",
          entityId: params.id,
          meta: { userId: kyc.user.id, fromResubmission: !!resubmitInvite },
        },
      }),
    ]);

    // Best-effort: destroy the old (rejected) Cloudinary assets so they don't
    // linger. S3-stored selfies/videos have no publicId and are skipped.
    for (const row of rejectedRows) {
      const payload = row.requestPayload as Record<string, unknown> | null;
      const publicId = payload?.publicId;
      if (typeof publicId === "string" && publicId) {
        try {
          await deleteFromCloudinary(publicId, { isSensitive: true });
        } catch {
          // ignore — the DB row is already gone, which is what matters
        }
      }
    }

    return NextResponse.json({ status: "APPROVED" });
  }

  // Request re-upload of specific documents (keeps everything else intact).
  if (parsed.data.action === "request_resubmission") {
    const items = parsed.data.documents ?? [];
    if (items.length === 0) {
      return NextResponse.json(
        { error: "Select at least one document to request a re-upload" },
        { status: 400 }
      );
    }

    // The applicant's onboarding invite is where the fresh, targeted link
    // lives. Without it there is no mechanism to re-open uploads.
    const invite = await prisma.invite.findFirst({
      where: {
        userId: kyc.user.id,
        status: { in: ["REGISTERED", "VERIFIED", "RESUBMIT"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!invite) {
      return NextResponse.json(
        { error: "No active onboarding record found for this applicant" },
        { status: 409 }
      );
    }

    // Resolve every requested document and enforce the docs-only scope:
    // only uploaded file documents, the live selfie, and the liveness video
    // may be flagged for re-upload (never the verified PAN/Aadhaar/Bank data).
    const ids = items.map((i) => i.documentId);
    const docs = await prisma.verificationResult.findMany({
      where: {
        id: { in: ids },
        OR: [{ userId: kyc.user.id }, { inviteId: invite.id }],
      },
    });
    const docsById = new Map(docs.map((d) => [d.id, d]));

    const resolved: { doc: (typeof docs)[number]; reason: string; label: string }[] = [];
    for (const item of items) {
      const doc = docsById.get(item.documentId);
      if (!doc) {
        return NextResponse.json(
          { error: "One or more selected documents could not be found" },
          { status: 404 }
        );
      }
      const isDoc = doc.type.startsWith("DOCUMENT_") || doc.type === "ONBOARD_VIDEO";
      if (!isDoc) {
        return NextResponse.json(
          { error: "Only uploaded documents, selfie or video can be re-requested" },
          { status: 400 }
        );
      }
      const bareType =
        doc.type === "ONBOARD_VIDEO" ? "ONBOARD_VIDEO" : doc.type.replace("DOCUMENT_", "");
      resolved.push({ doc, reason: item.reason, label: docTypeLabel(bareType) });
    }

    const freshToken = nanoid(24);
    const expiresAt = await computeInviteExpiry();
    const summary = resolved.map((r) => r.label).join(", ");

    await prisma.$transaction([
      ...resolved.map((r) =>
        prisma.verificationResult.update({
          where: { id: r.doc.id },
          data: {
            status: "Rejected",
            responsePayload: {
              ...((r.doc.responsePayload as Record<string, unknown> | null) ?? {}),
              rejectionReason: r.reason,
              rejectedAt: new Date().toISOString(),
              rejectedById: admin.id,
            },
          },
        })
      ),
      prisma.kyc.update({
        where: { id: params.id },
        data: {
          status: "AWAITING_RESUBMISSION",
          reviewedById: admin.id,
          reviewedAt: new Date(),
          rejectedReason: `Re-upload requested: ${summary}`,
        },
      }),
      prisma.invite.update({
        where: { id: invite.id },
        data: {
          status: "RESUBMIT",
          token: freshToken,
          expiresAt,
          rejectedReason: null,
          rejectedAt: null,
        },
      }),
      prisma.auditLog.create({
        data: {
          userId: admin.id,
          action: "kyc.resubmission_requested",
          entity: "Kyc",
          entityId: params.id,
          meta: {
            userId: kyc.user.id,
            inviteId: invite.id,
            documents: resolved.map((r) => ({
              id: r.doc.id,
              type: r.doc.type,
              reason: r.reason,
            })),
          },
        },
      }),
    ]);

    const resubmitLink = `${env.NEXT_PUBLIC_APP_URL}/onboard/resubmit?token=${freshToken}`;

    // Notify the applicant with the targeted link (best-effort — the flag is
    // already persisted, so a delivery hiccup shouldn't fail the request).
    let emailSent = false;
    try {
      const { subject, html } = renderDocResubmissionEmail({
        name: invite.name ?? undefined,
        role: invite.role,
        resubmitLink,
        expiresAt,
        documents: resolved.map((r) => ({ label: r.label, reason: r.reason })),
      });
      const emailProvider = getPartner("email");
      const result = await emailProvider.send({
        from: process.env.EMAIL_FROM_INFO || process.env.EMAIL_FROM,
        to: invite.email,
        subject,
        html,
      });
      emailSent = result.ok;
    } catch {
      // ignore — persisted state is the source of truth
    }

    try {
      const smsProvider = getPartner("sms");
      await smsProvider.sendTransactional({
        phone: invite.phone,
        templateId: "onboard_invite",
        variables: {
          link: resubmitLink,
          role: invite.role.replace(/_/g, " "),
        },
      });
    } catch {
      // ignore
    }

    try {
      if (invite.userId) {
        await prisma.notification.create({
          data: {
            userId: invite.userId,
            title: "Documents need to be re-uploaded",
            body: `Please re-upload the following document(s): ${summary}. Check your email for the secure link.`,
            channel: "INAPP",
          },
        });
      }
    } catch {
      // ignore
    }

    return NextResponse.json({
      status: "AWAITING_RESUBMISSION",
      resubmitLink,
      emailSent,
      documents: resolved.length,
    });
  }

  // Reject
  await prisma.$transaction([
    prisma.kyc.update({
      where: { id: params.id },
      data: {
        status: "REJECTED",
        reviewedById: admin.id,
        reviewedAt: new Date(),
        rejectedReason: parsed.data.reason ?? null,
      },
    }),
    // Mirror the rejection onto the onboarding invite (including a re-opened
    // RESUBMIT invite, so its live re-upload link is closed).
    prisma.invite.updateMany({
      where: {
        userId: kyc.user.id,
        status: { in: ["VERIFIED", "REGISTERED", "RESUBMIT"] },
      },
      data: {
        status: "REJECTED",
        rejectedAt: new Date(),
        rejectedReason: parsed.data.reason ?? "Rejected by admin",
      },
    }),
    prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "kyc.rejected",
        entity: "Kyc",
        entityId: params.id,
        meta: {
          userId: kyc.user.id,
          reason: parsed.data.reason,
        },
      },
    }),
  ]);

  return NextResponse.json({ status: "REJECTED" });
}
