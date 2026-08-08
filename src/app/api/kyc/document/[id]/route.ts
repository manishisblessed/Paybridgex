import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { cloudinary } from "@/lib/cloudinary";
import { presignKycVideoGet } from "@/lib/storage/s3Kyc";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * Admin-only: resolve a KYC document (uploaded during onboarding as a *private*
 * Cloudinary asset) to a fresh, short-lived signed URL and redirect to it.
 *
 * Private images deliver fine via their stored secure_url, but private PDFs are
 * blocked from inline delivery — so we mint a signed download URL here that
 * bypasses the delivery restriction. Works for both `VerificationResult`
 * (onboarding docs) and `Document` (direct) records by id.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const { id } = await params;

  let publicId: string | null = null;
  let resourceType = "image";
  let format: string | null = null;

  const vr = await prisma.verificationResult.findUnique({ where: { id } });
  if (vr?.requestPayload) {
    const p = vr.requestPayload as Record<string, unknown>;
    // Biometric selfies and onboarding liveness videos live in private S3 (no
    // Cloudinary publicId) — mint a short-lived presigned GET URL and redirect
    // straight to it. Selfies carry storage:"s3"; onboarding videos are keyed
    // under the kyc-videos/ prefix.
    const s3Key = typeof p.key === "string" ? (p.key as string) : null;
    const isS3 =
      !!s3Key && (p.storage === "s3" || /^kyc-(videos|selfies)\//.test(s3Key));
    if (isS3 && s3Key) {
      const signedUrl = await presignKycVideoGet(s3Key, { expiresInSec: 60 });
      return NextResponse.redirect(signedUrl);
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

  if (!publicId) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const expires = Math.floor(Date.now() / 1000) + 60 * 10; // 10 minutes
  const isPdfOrRaw = format === "pdf" || resourceType === "raw";

  let url: string;
  if (isPdfOrRaw) {
    // Download API endpoint — always serves private assets regardless of the
    // account's PDF/ZIP inline-delivery restriction.
    url = cloudinary.utils.private_download_url(publicId, format ?? "pdf", {
      resource_type: resourceType === "raw" ? "raw" : "image",
      type: "private",
      expires_at: expires,
    });
  } else {
    // Signed inline delivery URL for private images (shows in the browser).
    url = cloudinary.url(publicId, {
      type: "private",
      resource_type: resourceType || "image",
      sign_url: true,
      secure: true,
      ...(format ? { format } : {}),
    });
  }

  return NextResponse.redirect(url);
}
