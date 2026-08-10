import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { docTypeLabel } from "@/lib/onboarding/requiredDocuments";
import { getResubmitStatus } from "@/lib/onboarding/resubmission";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const invite = await prisma.invite.findUnique({ where: { token } });

  if (!invite) {
    return NextResponse.json({ error: "Invalid invite link" }, { status: 404 });
  }

  if (invite.status === "APPROVED") {
    return NextResponse.json(
      { error: "This invite has already been approved", status: invite.status },
      { status: 400 }
    );
  }

  if (invite.status === "REJECTED") {
    return NextResponse.json(
      { error: "This invite has been rejected", status: invite.status },
      { status: 400 }
    );
  }

  if (invite.status === "EXPIRED" || new Date() > invite.expiresAt) {
    if (invite.status !== "EXPIRED") {
      await prisma.invite.update({
        where: { id: invite.id },
        data: { status: "EXPIRED" },
      });
    }
    return NextResponse.json(
      { error: "This invite link has expired", status: "EXPIRED" },
      { status: 400 }
    );
  }

  const verifications = await prisma.verificationResult.findMany({
    where: { inviteId: invite.id },
    select: { type: true, status: true, verifiedName: true, responsePayload: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  // When the invite has been re-opened for a targeted re-upload, surface the
  // exact documents an admin flagged (with the reason + whether the applicant
  // has already replaced it) so the resubmission page can show only those and
  // survive a page reload mid-session.
  let resubmit:
    | {
        documents: { type: string; label: string; reason: string | null; done: boolean }[];
        allDone: boolean;
      }
    | null = null;
  if (invite.status === "RESUBMIT") {
    const status = await getResubmitStatus(invite.id);
    const doneSet = new Set(status.doneTypes);
    resubmit = {
      documents: status.rejected.map((d) => ({
        type: d.bareType,
        label: docTypeLabel(d.bareType),
        reason: d.reason,
        done: doneSet.has(d.bareType),
      })),
      allDone: status.allDone,
    };
  }

  return NextResponse.json({
    invite: {
      id: invite.id,
      phone: invite.phone,
      email: invite.email,
      role: invite.role,
      name: invite.name,
      status: invite.status,
      expiresAt: invite.expiresAt.toISOString(),
      phoneVerifiedAt: invite.phoneVerifiedAt?.toISOString() ?? null,
      emailVerifiedAt: invite.emailVerifiedAt?.toISOString() ?? null,
      aadhaarVerifiedAt: invite.aadhaarVerifiedAt?.toISOString() ?? null,
    },
    verifications,
    resubmit,
  });
}
