import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { isSelfOrDirectChild, isAdminRole } from "@/lib/security/ownership";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { clientIp, logSecurityEvent } from "@/lib/security/audit";
import {
  resolveKycDocumentUrl,
  getKycDocumentOwnerUserId,
} from "@/lib/kyc/documentAccess";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * GET — serve a single KYC document belonging to a DIRECT downline member,
 * resolved to a fresh short-lived signed URL (redirect).
 *
 * Two-layer object-level authorization (defense against IDOR):
 *   1. the caller must be the direct parent (or an admin) of `[id]`, and
 *   2. the document `[docId]` must actually belong to `[id]`.
 */
export async function GET(
  req: Request,
  { params }: { params: { id: string; docId: string } }
) {
  try {
    const user = await requireAuth();

    if (!(await isSelfOrDirectChild(params.id, user))) {
      return NextResponse.json(
        { error: "This account is not in your direct network" },
        { status: 403 }
      );
    }

    // The document must belong to the member being viewed — never trust the
    // document id alone.
    const ownerId = await getKycDocumentOwnerUserId(params.docId);
    if (!ownerId || ownerId !== params.id) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const url = await resolveKycDocumentUrl(params.docId);
    if (!url) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Audit trail: record which downline member's document a parent opened.
    // Skip admins' own views. Best-effort — never blocks the response.
    if (!isAdminRole(user.role)) {
      await logSecurityEvent({
        action: "network.kyc_document_viewed",
        userId: user.id,
        entity: "Document",
        entityId: params.docId,
        ip: clientIp(req),
        userAgent: req.headers.get("user-agent"),
        meta: { targetUserId: params.id, viewerRole: user.role },
      });
    }

    return NextResponse.redirect(url);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    return toErrorResponse(e);
  }
}
