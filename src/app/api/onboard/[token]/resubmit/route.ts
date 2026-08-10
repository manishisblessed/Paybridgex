import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPartner } from "@/lib/partners";
import { deleteFromCloudinary } from "@/lib/cloudinary";
import { getResubmitStatus } from "@/lib/onboarding/resubmission";
import { docTypeLabel } from "@/lib/onboarding/requiredDocuments";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * Finalise a targeted document re-upload. Once the applicant has replaced every
 * document an admin flagged, this:
 *   - removes the stale `Rejected` rows (and their private assets),
 *   - moves the KYC back into the review queue (PENDING_REVIEW),
 *   - closes the re-opened invite (RESUBMIT → REGISTERED), and
 *   - notifies the reviewing admin.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite) {
    return NextResponse.json({ error: "Invalid invite" }, { status: 404 });
  }

  if (invite.status !== "RESUBMIT") {
    return NextResponse.json(
      { error: "This link is not open for document re-upload" },
      { status: 400 }
    );
  }

  if (new Date() > invite.expiresAt) {
    return NextResponse.json({ error: "This re-upload link has expired" }, { status: 400 });
  }

  const status = await getResubmitStatus(invite.id);
  if (!status.allDone) {
    return NextResponse.json(
      {
        error: "Please re-upload all requested documents before submitting.",
        pending: status.pendingTypes.map((t) => ({ type: t, label: docTypeLabel(t) })),
      },
      { status: 400 }
    );
  }

  // Snapshot the rejected rows so we can clean up their private assets after
  // the state transition commits.
  const rejectedRows = await prisma.verificationResult.findMany({
    where: { inviteId: invite.id, status: "Rejected" },
    select: { id: true, requestPayload: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.verificationResult.deleteMany({
      where: { inviteId: invite.id, status: "Rejected" },
    });

    if (invite.userId) {
      await tx.kyc.updateMany({
        where: { userId: invite.userId },
        data: {
          status: "PENDING_REVIEW",
          submittedAt: new Date(),
          rejectedReason: null,
          reviewedById: null,
          reviewedAt: null,
        },
      });
    }

    await tx.invite.update({
      where: { id: invite.id },
      data: { status: "REGISTERED" },
    });
  });

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

  await prisma.auditLog.create({
    data: {
      userId: invite.userId ?? undefined,
      action: "onboard.resubmitted",
      entity: "Invite",
      entityId: invite.id,
      meta: {
        userId: invite.userId,
        resubmittedTypes: status.doneTypes,
      },
    },
  });

  // Notify the reviewing admin that the application is back in the queue.
  try {
    const inviter = invite.invitedById
      ? await prisma.user.findUnique({
          where: { id: invite.invitedById },
          select: { id: true, email: true, name: true },
        })
      : null;

    if (inviter) {
      await prisma.notification.create({
        data: {
          userId: inviter.id,
          title: "Documents re-uploaded — ready for review",
          body: `${invite.name ?? "An applicant"} has re-uploaded the requested document(s). The KYC is back in your review queue.`,
          channel: "INAPP",
        },
      });

      try {
        const emailProvider = getPartner("email");
        await emailProvider.send({
          to: inviter.email,
          subject: `NextGenPay — ${invite.name ?? "Applicant"} re-uploaded documents`,
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="color:#0f172a;margin:0 0 12px;">Documents re-uploaded</h2>
              <p style="color:#334155;font-size:14px;line-height:1.6;">
                <strong>${invite.name ?? "An applicant"}</strong> has re-uploaded the document(s) you requested.
                Their KYC is back in the review queue and awaiting your decision.
              </p>
              <p style="color:#64748b;font-size:13px;">Phone: ${invite.phone} &middot; Email: ${invite.email}</p>
            </div>
          `,
        });
      } catch {
        // email is best-effort
      }
    }
  } catch {
    // notification failures shouldn't fail the resubmission
  }

  return NextResponse.json({
    ok: true,
    status: "PENDING_REVIEW",
    message: "Documents re-submitted. Your application is back under review.",
  });
}
