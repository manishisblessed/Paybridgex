import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { signedDeliveryUrl } from "@/lib/cloudinary";
import { prisma } from "@/lib/db";

/**
 * Retailer — view the payment screenshot of one of THEIR OWN claims.
 *
 * Ownership is scoped in the query (id + userId), so a retailer can never pull
 * another user's proof. Mints a fresh short-lived signed URL per request and
 * 302-redirects, so the "View" button stays valid for future reference.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    return toErrorResponse(e);
  }

  const claim = await prisma.qrClaim.findFirst({
    where: { id: params.id, userId: user.id },
    select: { screenshotPublicId: true, screenshotFormat: true },
  });
  if (!claim) return NextResponse.json({ error: "Claim not found" }, { status: 404 });

  const url = signedDeliveryUrl(claim.screenshotPublicId, {
    format: claim.screenshotFormat ?? "jpg",
    expiresInSec: 300,
  });
  return NextResponse.redirect(url, 302);
}
