/**
 * Helpers for the targeted document-resubmission flow.
 *
 * When an admin flags specific uploaded documents (see the KYC review action
 * `request_resubmission`), each flagged document's `VerificationResult` row is
 * marked `status = "Rejected"` and the invite is re-opened with a fresh token
 * and `status = "RESUBMIT"`. The applicant then re-uploads ONLY those flagged
 * documents via `/onboard/resubmit`.
 *
 * The set of `Rejected` rows is the single source of truth for "what still
 * needs re-uploading". A re-upload creates a NEW `Uploaded` row of the same
 * type; a rejected type is considered satisfied once an `Uploaded` row of that
 * type exists that is newer than the rejection.
 */

import { prisma } from "@/lib/db";

export type RejectedDoc = {
  id: string;
  /** As stored: `DOCUMENT_<TYPE>` or `ONBOARD_VIDEO`. */
  dbType: string;
  /** Stripped: `PAN`, `SELFIE`, `ONBOARD_VIDEO`, … */
  bareType: string;
  reason: string | null;
  createdAt: Date;
};

/** Map a bare document type back to its stored `VerificationResult.type`. */
export function bareToDbType(bareType: string): string {
  return bareType === "ONBOARD_VIDEO" ? "ONBOARD_VIDEO" : `DOCUMENT_${bareType}`;
}

/** Strip a stored `VerificationResult.type` down to its bare document type. */
export function dbToBareType(dbType: string): string {
  return dbType === "ONBOARD_VIDEO" ? "ONBOARD_VIDEO" : dbType.replace("DOCUMENT_", "");
}

/**
 * The most-recent `Rejected` document per type for an invite (what the
 * applicant has been asked to re-upload).
 */
export async function getRejectedDocs(inviteId: string): Promise<RejectedDoc[]> {
  const rows = await prisma.verificationResult.findMany({
    where: { inviteId, status: "Rejected" },
    select: { id: true, type: true, responsePayload: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const byType = new Map<string, RejectedDoc>();
  for (const r of rows) {
    const bareType = dbToBareType(r.type);
    if (byType.has(bareType)) continue;
    const payload = (r.responsePayload ?? {}) as Record<string, unknown>;
    byType.set(bareType, {
      id: r.id,
      dbType: r.type,
      bareType,
      reason: (payload.rejectionReason as string) ?? null,
      createdAt: r.createdAt,
    });
  }
  return Array.from(byType.values());
}

export type ResubmitStatus = {
  rejected: RejectedDoc[];
  /** bareTypes that still have no fresh re-upload. */
  pendingTypes: string[];
  /** bareTypes that now have a fresh `Uploaded` row. */
  doneTypes: string[];
  allDone: boolean;
};

/**
 * Compute resubmission progress: for every rejected type, has the applicant
 * uploaded a fresh replacement (an `Uploaded` row newer than the rejection)?
 */
export async function getResubmitStatus(inviteId: string): Promise<ResubmitStatus> {
  const rejected = await getRejectedDocs(inviteId);
  if (rejected.length === 0) {
    return { rejected, pendingTypes: [], doneTypes: [], allDone: true };
  }

  const uploaded = await prisma.verificationResult.findMany({
    where: { inviteId, status: "Uploaded" },
    select: { type: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  // Newest Uploaded row timestamp per type.
  const newestUploadedByType = new Map<string, Date>();
  for (const u of uploaded) {
    const bareType = dbToBareType(u.type);
    if (!newestUploadedByType.has(bareType)) newestUploadedByType.set(bareType, u.createdAt);
  }

  const pendingTypes: string[] = [];
  const doneTypes: string[] = [];
  for (const r of rejected) {
    const freshAt = newestUploadedByType.get(r.bareType);
    if (freshAt && freshAt > r.createdAt) doneTypes.push(r.bareType);
    else pendingTypes.push(r.bareType);
  }

  return { rejected, pendingTypes, doneTypes, allDone: pendingTypes.length === 0 };
}

/**
 * During RESUBMIT, only the flagged (rejected) document types may be
 * (re)uploaded — this enforces the docs-only, scoped nature of the flow so a
 * crafted request can't silently swap an unrelated document.
 */
export async function isResubmitTypeAllowed(
  inviteId: string,
  bareType: string
): Promise<boolean> {
  const rejected = await getRejectedDocs(inviteId);
  return rejected.some((r) => r.bareType === bareType);
}
