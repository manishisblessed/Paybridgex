import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-server";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { signedDeliveryUrl } from "@/lib/cloudinary";
import { prisma } from "@/lib/db";

/**
 * Admin — view a QR claim's payment screenshot.
 *
 * The screenshots are PRIVATE Cloudinary assets, so this mints a short-lived
 * signed URL on EACH request and 302-redirects to it. Generating it per click
 * (instead of baking a link into the claims list) keeps the "View" button valid
 * for future reference — a page that has been open for a while never hits a
 * stale/expired link.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT");
  } catch (e) {
    return toErrorResponse(e);
  }

  const claim = await prisma.qrClaim.findUnique({
    where: { id: params.id },
    select: { screenshotPublicId: true, screenshotFormat: true },
  });
  if (!claim) return NextResponse.json({ error: "Claim not found" }, { status: 404 });

  const url = signedDeliveryUrl(claim.screenshotPublicId, {
    format: claim.screenshotFormat ?? "jpg",
    expiresInSec: 300,
  });
  return NextResponse.redirect(url, 302);
}
