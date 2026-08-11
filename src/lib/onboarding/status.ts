/**
 * Onboarding / KYC progress model for a network user — the single source of
 * truth behind the parent-facing "where is my onboardee stuck?" tracker.
 *
 * PRIVACY: this intentionally returns ONLY step state (done / pending /
 * rejected) and rejection reasons. It never returns document URLs, file
 * identifiers, or raw KYC PII (PAN/Aadhaar/account numbers). Those remain
 * admin-only (served via the admin invite detail + /api/kyc/document/[id]).
 *
 * The step list mirrors the server-side registration gate in
 * `src/app/api/onboard/[token]/register/route.ts` so the parent sees exactly
 * the same requirements the applicant must satisfy.
 */

import { prisma } from "@/lib/db";
import { getRequiredDocTypes, docTypeLabel } from "./requiredDocuments";
import { getResubmitStatus } from "./resubmission";
import { needsSuccessorApproval } from "@/lib/declaration/types";

export type StepStatus = "done" | "pending" | "rejected";
export type StepGroup = "identity" | "documents" | "declaration" | "review";

export type OnboardingStep = {
  key: string;
  label: string;
  status: StepStatus;
  reason?: string | null;
  group: StepGroup;
};

export type OnboardingProgress = {
  hasInvite: boolean;
  inviteStatus: string | null; // effective (a PENDING invite past expiry → EXPIRED)
  kycStatus: string | null;
  accountStatus: string; // the user's own status (ACTIVE / PENDING_KYC / ...)
  registeredAt: string | null;
  approvedAt: string | null;
  rejectedReason: string | null; // consolidated pending / reject reason (if any)
  steps: OnboardingStep[];
  totalSteps: number;
  doneSteps: number;
  pendingSteps: number;
  rejected: { key: string; label: string; reason: string | null }[];
  waitingOn: "retailer" | "admin" | "upline" | "none";
  summary: string;
  updatedAt: string | null;
};

type TargetUser = {
  id: string;
  role: string;
  status: string;
  hasLivenessVideo: boolean;
};

/**
 * Build the onboarding progress for a single network user. Safe to expose to
 * that user's upline (status-only; no documents/PII).
 */
export async function getOnboardingProgress(
  user: TargetUser
): Promise<OnboardingProgress> {
  const invite = await prisma.invite.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  const results = await prisma.verificationResult.findMany({
    where: invite ? { inviteId: invite.id } : { userId: user.id },
    select: { type: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const kyc = await prisma.kyc.findUnique({
    where: { userId: user.id },
    select: { status: true, rejectedReason: true, updatedAt: true },
  });

  const resub = invite
    ? await getResubmitStatus(invite.id)
    : { rejected: [], pendingTypes: [], doneTypes: [], allDone: true };
  const reasonByType = new Map(resub.rejected.map((r) => [r.bareType, r.reason]));
  const rejectedPending = new Set(resub.pendingTypes);

  const successTypes = new Set(
    results.filter((r) => r.status === "Success").map((r) => r.type)
  );
  const uploadedDocTypes = new Set(
    results
      .filter((r) => r.status === "Uploaded" && r.type.startsWith("DOCUMENT_"))
      .map((r) => r.type.replace("DOCUMENT_", ""))
  );
  const hasVideo =
    results.some((r) => r.type === "ONBOARD_VIDEO" && r.status === "Uploaded") ||
    user.hasLivenessVideo;

  const now = new Date();
  const inviteStatus = invite
    ? invite.status === "PENDING" && invite.expiresAt < now
      ? "EXPIRED"
      : invite.status
    : null;

  const docStatus = (bareType: string): StepStatus => {
    if (rejectedPending.has(bareType)) return "rejected";
    if (uploadedDocTypes.has(bareType)) return "done";
    return "pending";
  };

  const steps: OnboardingStep[] = [];

  // ── Identity checks ──
  if (invite) {
    steps.push({
      key: "MOBILE",
      label: "Mobile number verified",
      status: invite.phoneVerifiedAt ? "done" : "pending",
      group: "identity",
    });
    steps.push({
      key: "EMAIL",
      label: "Email verified",
      status: invite.emailVerifiedAt ? "done" : "pending",
      group: "identity",
    });
  }
  steps.push({
    key: "PAN",
    label: "PAN verification",
    status: successTypes.has("PAN_360") ? "done" : "pending",
    group: "identity",
  });
  steps.push({
    key: "AADHAAR",
    label: "Aadhaar verification",
    status:
      successTypes.has("AADHAAR_DIGILOCKER") || invite?.aadhaarVerifiedAt
        ? "done"
        : "pending",
    group: "identity",
  });
  steps.push({
    key: "BANK",
    label: "Bank account verification",
    status:
      successTypes.has("BANK_PENNY_DROP") || successTypes.has("BANK_ADVANCE")
        ? "done"
        : "pending",
    group: "identity",
  });
  // GST is optional — surface it only if the applicant attempted it.
  if (results.some((r) => r.type === "GST")) {
    steps.push({
      key: "GST",
      label: "GST verification",
      status: successTypes.has("GST") ? "done" : "pending",
      group: "identity",
    });
  }

  // ── Selfie, liveness video & required documents ──
  steps.push({
    key: "SELFIE",
    label: docTypeLabel("SELFIE"),
    status: docStatus("SELFIE"),
    reason: reasonByType.get("SELFIE") ?? null,
    group: "documents",
  });
  // The liveness video isn't part of the mandatory registration gate, so only
  // surface it when it's actually relevant (captured, or flagged for re-upload)
  // — otherwise it would sit "pending" forever on completed onboardings.
  const videoAttempted =
    hasVideo ||
    rejectedPending.has("ONBOARD_VIDEO") ||
    results.some((r) => r.type === "ONBOARD_VIDEO");
  if (videoAttempted) {
    steps.push({
      key: "ONBOARD_VIDEO",
      label: docTypeLabel("ONBOARD_VIDEO"),
      status: rejectedPending.has("ONBOARD_VIDEO")
        ? "rejected"
        : hasVideo
        ? "done"
        : "pending",
      reason: reasonByType.get("ONBOARD_VIDEO") ?? null,
      group: "documents",
    });
  }
  for (const t of getRequiredDocTypes(user.role)) {
    steps.push({
      key: t,
      label: docTypeLabel(t),
      status: docStatus(t),
      reason: reasonByType.get(t) ?? null,
      group: "documents",
    });
  }

  // ── Declarations ──
  steps.push({
    key: "SELF_DECLARATION",
    label: docTypeLabel("SELF_DECLARATION"),
    status: docStatus("SELF_DECLARATION"),
    reason: reasonByType.get("SELF_DECLARATION") ?? null,
    group: "declaration",
  });

  const inviter = invite
    ? await prisma.user.findUnique({
        where: { id: invite.invitedById },
        select: { role: true },
      })
    : null;
  const requiresSuccessor = inviter
    ? needsSuccessorApproval(user.role, inviter.role)
    : false;
  let successorPending = false;
  if (requiresSuccessor && invite) {
    const appr = await prisma.declarationApproval.findFirst({
      where: { inviteId: invite.id },
      orderBy: { createdAt: "desc" },
      select: { status: true, rejectedReason: true },
    });
    const st: StepStatus = !appr
      ? "pending"
      : appr.status === "APPROVED"
      ? "done"
      : appr.status === "REJECTED"
      ? "rejected"
      : "pending";
    if (st !== "done") successorPending = true;
    steps.push({
      key: "SUCCESSOR_DECLARATION",
      label: "Upline responsibility approval",
      status: st,
      reason: appr?.rejectedReason ?? null,
      group: "declaration",
    });
  }

  // ── Review & activation ──
  const submitted = Boolean(
    invite?.registeredAt ||
      ["REGISTERED", "VERIFIED", "APPROVED", "RESUBMIT"].includes(
        inviteStatus ?? ""
      ) ||
      (kyc && ["PENDING_REVIEW", "APPROVED", "AWAITING_RESUBMISSION"].includes(kyc.status))
  );
  steps.push({
    key: "SUBMITTED",
    label: "Submitted for review",
    status: submitted ? "done" : "pending",
    group: "review",
  });
  const activated =
    user.status === "ACTIVE" ||
    inviteStatus === "APPROVED" ||
    kyc?.status === "APPROVED";
  steps.push({
    key: "APPROVED",
    label: "Approved & activated",
    status: activated ? "done" : "pending",
    group: "review",
  });

  // ── Aggregates ──
  const doneSteps = steps.filter((s) => s.status === "done").length;
  const rejected = steps
    .filter((s) => s.status === "rejected")
    .map((s) => ({ key: s.key, label: s.label, reason: s.reason ?? null }));
  const pendingSteps = steps.length - doneSteps;

  let waitingOn: OnboardingProgress["waitingOn"];
  let summary: string;
  if (activated) {
    waitingOn = "none";
    summary = "Onboarding complete — the account is active.";
  } else if (rejectedPending.size > 0 || inviteStatus === "RESUBMIT") {
    waitingOn = "retailer";
    const labels = rejected.map((r) => r.label).join(", ");
    summary = labels
      ? `Re-upload requested — waiting on the applicant to resubmit: ${labels}.`
      : "Waiting on the applicant to re-upload the flagged document(s).";
  } else if (requiresSuccessor && successorPending) {
    waitingOn = "upline";
    summary = "Waiting on the upline's responsibility approval.";
  } else if (submitted) {
    waitingOn = "admin";
    summary = "All steps submitted — waiting on admin approval.";
  } else {
    waitingOn = "retailer";
    summary = `Onboarding in progress — ${pendingSteps} step${
      pendingSteps === 1 ? "" : "s"
    } left for the applicant to complete.`;
  }

  const updatedAt =
    kyc?.updatedAt?.toISOString() ?? invite?.updatedAt?.toISOString() ?? null;

  // A single "pending / reject reason" for the details card: prefer the KYC
  // review note (covers REJECTED and "Re-upload requested: …"), then any invite
  // rejection reason, otherwise fall back to the computed summary.
  const rejectedReason =
    kyc?.rejectedReason ?? invite?.rejectedReason ?? (waitingOn === "none" ? null : summary);

  return {
    hasInvite: Boolean(invite),
    inviteStatus,
    kycStatus: kyc?.status ?? null,
    accountStatus: user.status,
    registeredAt: invite?.registeredAt?.toISOString() ?? null,
    approvedAt: invite?.approvedAt?.toISOString() ?? null,
    rejectedReason,
    steps,
    totalSteps: steps.length,
    doneSteps,
    pendingSteps,
    rejected,
    waitingOn,
    summary,
    updatedAt,
  };
}
