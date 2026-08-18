import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { isSelfOrDirectChild, isAdminRole } from "@/lib/security/ownership";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { clientIp, logSecurityEvent } from "@/lib/security/audit";
import {
  buildKycDetail,
  kycDetailInclude,
  kycDetailVerificationSelect,
} from "@/lib/kyc/detail";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * GET — full KYC details + documents for a DIRECT downline member.
 *
 * A parent sees their own onboardees: SD → their MDs, MD → their DTs, DT → their
 * RTs (direct children only, enforced by `isSelfOrDirectChild`). Admins are
 * unrestricted. This mirrors the admin KYC review payload (same `buildKycDetail`
 * assembly) but is READ-ONLY — approve/reject stays with admins.
 *
 * Document/asset previews are re-pointed at the parent-scoped, ownership-checked
 * document endpoint so private S3 selfies/videos resolve without the admin route.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth();

    if (!(await isSelfOrDirectChild(params.id, user))) {
      return NextResponse.json(
        { error: "This account is not in your direct network" },
        { status: 403 }
      );
    }

    const kyc = await prisma.kyc.findFirst({
      where: { userId: params.id },
      include: kycDetailInclude,
    });
    if (!kyc) {
      return NextResponse.json(
        { error: "This member hasn't started their KYC yet." },
        { status: 404 }
      );
    }

    // Audit trail: a parent opened a downline member's KYC/documents. Skip
    // admins' own views (they have the dedicated KYC console). Best-effort —
    // never blocks the response.
    if (!isAdminRole(user.role)) {
      await logSecurityEvent({
        action: "network.kyc_viewed",
        userId: user.id,
        entity: "Kyc",
        entityId: kyc.id,
        ip: clientIp(req),
        userAgent: req.headers.get("user-agent"),
        meta: {
          targetUserId: params.id,
          targetUserCode: kyc.user.userCode,
          viewerRole: user.role,
        },
      });
    }

    // Verifications are created against the invite; their userId is only
    // backfilled at registration. Resolve by userId OR the user's invite ids so
    // the full PAN/Aadhaar/bank/document picture is visible.
    const invites = await prisma.invite.findMany({
      where: { userId: params.id },
      select: { id: true },
    });
    const inviteIds = invites.map((i) => i.id);

    const vResults = await prisma.verificationResult.findMany({
      where: {
        OR: [{ userId: params.id }, { inviteId: { in: inviteIds } }],
      },
      orderBy: { createdAt: "desc" },
      select: kycDetailVerificationSelect,
    });

    const detail = buildKycDetail(kyc, vResults);

    // Route private previews through the parent-scoped document endpoint. Only
    // internal (`/api/...`) urls need rewriting; public Cloudinary secure_urls
    // render directly.
    const docBase = `/api/network/${params.id}/documents`;
    detail.onboardingDocs = detail.onboardingDocs.map((d) => ({
      ...d,
      url: d.url && d.url.startsWith("/api/") ? `${docBase}/${d.id}` : d.url,
    }));

    return NextResponse.json({ kyc: detail });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    return toErrorResponse(e);
  }
}
