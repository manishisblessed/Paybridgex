import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { getResubmitStatus } from "@/lib/onboarding/resubmission";
import {
  buildKycDetail,
  kycDetailInclude,
  kycDetailVerificationSelect,
} from "@/lib/kyc/detail";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const pageSize = Math.min(50, Math.max(10, Number(searchParams.get("pageSize") ?? 25)));
  const statusFilter = searchParams.get("status");

  const where =
    statusFilter && ["PENDING_REVIEW", "APPROVED", "REJECTED", "AWAITING_RESUBMISSION"].includes(statusFilter)
      ? { status: statusFilter as "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "AWAITING_RESUBMISSION" }
      : undefined;

  const [total, kycs, pendingCount, approvedCount, rejectedCount, awaitingResubmissionCount] = await Promise.all([
    prisma.kyc.count({ where }),
    prisma.kyc.findMany({
      where,
      include: kycDetailInclude,
      orderBy: [
        { status: "asc" as const },
        { submittedAt: "desc" as const },
      ],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.kyc.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.kyc.count({ where: { status: "APPROVED" } }),
    prisma.kyc.count({ where: { status: "REJECTED" } }),
    prisma.kyc.count({ where: { status: "AWAITING_RESUBMISSION" } }),
  ]);

  const userIds = kycs.map((k) => k.userId);

  // Onboarding verifications are created against the invite; their userId is
  // only backfilled at registration. Legacy/edge records can therefore still
  // have userId = null while remaining linked to an invite that IS owned by the
  // user. Resolve verifications by userId OR the user's invite id so the admin
  // always sees the applicant's PAN/bank/document data — not just the rows
  // where the userId backfill happened to run.
  const invites = await prisma.invite.findMany({
    where: { userId: { in: userIds } },
    select: { id: true, userId: true, status: true, createdAt: true },
  });
  const inviteToUser = new Map<string, string>();
  for (const inv of invites) {
    if (inv.userId) inviteToUser.set(inv.id, inv.userId);
  }
  const inviteIds = invites.map((i) => i.id);

  const verificationResults = await prisma.verificationResult.findMany({
    where: {
      OR: [{ userId: { in: userIds } }, { inviteId: { in: inviteIds } }],
    },
    orderBy: { createdAt: "desc" },
    select: kycDetailVerificationSelect,
  });

  type VR = (typeof verificationResults)[number];
  const verificationsByUser = new Map<string, VR[]>();
  for (const v of verificationResults) {
    const owner =
      v.userId ?? (v.inviteId ? inviteToUser.get(v.inviteId) ?? null : null);
    if (!owner) continue;
    const list = verificationsByUser.get(owner) ?? [];
    list.push(v);
    verificationsByUser.set(owner, list);
  }

  // For applications awaiting a targeted re-upload, work out whether the
  // applicant has already replaced every flagged document — even if they never
  // pressed the final "submit" button on the re-upload page. This lets the
  // admin review/approve as soon as the documents are actually present instead
  // of being stuck on "Waiting for the applicant to re-upload".
  type ResubmitInfo = { ready: boolean; pending: number; done: number; total: number };
  const resubmitByUser = new Map<string, ResubmitInfo>();
  const awaitingUserIds = new Set(
    kycs.filter((k) => k.status === "AWAITING_RESUBMISSION").map((k) => k.userId)
  );
  if (awaitingUserIds.size > 0) {
    const resubmitInvites = invites.filter(
      (i) => i.userId && awaitingUserIds.has(i.userId) && i.status === "RESUBMIT"
    );
    await Promise.all(
      resubmitInvites.map(async (inv) => {
        if (!inv.userId) return;
        const st = await getResubmitStatus(inv.id);
        const total = st.doneTypes.length + st.pendingTypes.length;
        resubmitByUser.set(inv.userId, {
          ready: st.allDone,
          pending: st.pendingTypes.length,
          done: st.doneTypes.length,
          total,
        });
      })
    );
  }

  return NextResponse.json({
    page,
    pageSize,
    total,
    kycs: kycs.map((k) => ({
      ...buildKycDetail(k, verificationsByUser.get(k.userId) ?? []),
      resubmit:
        k.status === "AWAITING_RESUBMISSION"
          ? resubmitByUser.get(k.userId) ?? null
          : null,
    })),
    stats: {
      pending: pendingCount,
      approved: approvedCount,
      rejected: rejectedCount,
      awaitingResubmission: awaitingResubmissionCount,
    },
  });
}
