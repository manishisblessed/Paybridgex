import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-server";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { signedDeliveryUrl } from "@/lib/cloudinary";
import { prisma } from "@/lib/db";

/**
 * GET /api/admin/pos/manual-slips/[id]/slip
 *
 * View a manual POS slip's uploaded evidence. The slip is a PRIVATE Cloudinary
 * asset (jpg/jpeg/png/pdf), so this mints a short-lived signed URL per request
 * and 302-redirects — a stale/expired link never happens on an old open page.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT", "FINANCE");
  } catch (e) {
    return toErrorResponse(e);
  }

  const slip = await prisma.posManualSlip.findUnique({
    where: { id: params.id },
    select: { slipPublicId: true, slipFormat: true },
  });
  if (!slip) return NextResponse.json({ error: "Slip not found" }, { status: 404 });

  const url = signedDeliveryUrl(slip.slipPublicId, {
    format: slip.slipFormat ?? "jpg",
    expiresInSec: 300,
  });
  return NextResponse.redirect(url, 302);
}
