/**
 * Shared resolution of a KYC document to a short-lived signed URL, plus owner
 * lookup for object-level authorization.
 *
 * A "document" here is either a `VerificationResult` (uploaded during
 * onboarding — private Cloudinary asset, or a biometric selfie / liveness video
 * in private S3) or a `Document` (directly-uploaded, private Cloudinary asset),
 * addressed by row id. Callers must authorize access BEFORE serving the URL.
 */

import { prisma } from "@/lib/db";
import { cloudinary } from "@/lib/cloudinary";
import { presignKycVideoGet } from "@/lib/storage/s3Kyc";

/**
 * Resolve a document id to a fresh, short-lived URL that renders/downloads the
 * private asset. Returns `null` if the document can't be found or has no
 * backing asset. Performs NO authorization — the caller must gate access.
 */
export async function resolveKycDocumentUrl(id: string): Promise<string | null> {
  let publicId: string | null = null;
  let resourceType = "image";
  let format: string | null = null;

  const vr = await prisma.verificationResult.findUnique({ where: { id } });
  if (vr?.requestPayload) {
    const p = vr.requestPayload as Record<string, unknown>;
    // Biometric selfies and onboarding liveness videos live in private S3 (no
    // Cloudinary publicId) — mint a short-lived presigned GET URL. Selfies carry
    // storage:"s3"; onboarding videos are keyed under the kyc-videos/ prefix.
    const s3Key = typeof p.key === "string" ? (p.key as string) : null;
    const isS3 = !!s3Key && (p.storage === "s3" || /^kyc-(videos|selfies)\//.test(s3Key));
    if (isS3 && s3Key) {
      return presignKycVideoGet(s3Key, { expiresInSec: 60 });
    }
    publicId = (p.publicId as string) ?? null;
    resourceType = (p.resourceType as string) ?? "image";
    format = (p.format as string) ?? null;
  } else {
    const doc = await prisma.document.findUnique({ where: { id } });
    if (doc) {
      publicId = doc.publicId;
      resourceType = doc.resourceType ?? "image";
      format = doc.format ?? null;
    }
  }

  if (!publicId) return null;

  const expires = Math.floor(Date.now() / 1000) + 60 * 10; // 10 minutes
  const isPdfOrRaw = format === "pdf" || resourceType === "raw";

  if (isPdfOrRaw) {
    // Download API endpoint — always serves private assets regardless of the
    // account's PDF/ZIP inline-delivery restriction.
    return cloudinary.utils.private_download_url(publicId, format ?? "pdf", {
      resource_type: resourceType === "raw" ? "raw" : "image",
      type: "private",
      expires_at: expires,
    });
  }

  // Signed inline delivery URL for private images (shows in the browser).
  return cloudinary.url(publicId, {
    type: "private",
    resource_type: resourceType || "image",
    sign_url: true,
    secure: true,
    ...(format ? { format } : {}),
  });
}

/**
 * The user id a document belongs to, resolving through the invite when a
 * `VerificationResult` has no backfilled `userId`. Returns `null` if unknown.
 * Used to confirm a document actually belongs to a given applicant before a
 * parent is allowed to view it (defense against IDOR).
 */
export async function getKycDocumentOwnerUserId(id: string): Promise<string | null> {
  const vr = await prisma.verificationResult.findUnique({
    where: { id },
    select: { userId: true, inviteId: true },
  });
  if (vr) {
    if (vr.userId) return vr.userId;
    if (vr.inviteId) {
      const invite = await prisma.invite.findUnique({
        where: { id: vr.inviteId },
        select: { userId: true },
      });
      return invite?.userId ?? null;
    }
    return null;
  }

  const doc = await prisma.document.findUnique({
    where: { id },
    select: { userId: true },
  });
  return doc?.userId ?? null;
}
