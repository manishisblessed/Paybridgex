import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth-server";
import { resolveKycDocumentUrl } from "@/lib/kyc/documentAccess";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * Admin-only: resolve a KYC document (uploaded during onboarding as a *private*
 * Cloudinary/S3 asset) to a fresh, short-lived signed URL and redirect to it.
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
  const url = await resolveKycDocumentUrl(id);
  if (!url) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  return NextResponse.redirect(url);
}
