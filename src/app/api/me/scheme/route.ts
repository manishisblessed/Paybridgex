import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { serializeSchemeForRole } from "@/lib/scheme/serialize";
import { isSelfOrDirectChild } from "@/lib/security/ownership";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * GET /api/me/scheme
 *   (no params)        → the caller's own scheme
 *   ?userId=<childId>  → a DIRECT child's scheme (parent view)
 *
 * Returns a scheme (service + MDR slabs) redacted to a role-scoped view: the
 * target's charges, their own commission, and their own MDR rate only. The
 * other tiers' commission columns and the platform's vendor cost are NEVER
 * serialized, so a child can never see any parent tier's MDR%/commission.
 *
 * Parents may view only their IMMEDIATE children (SD→MDs, MD→DTs, DT→RTs);
 * requesting a deeper descendant or an unrelated user is forbidden.
 */
export async function GET(req: Request) {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const targetUserId = (searchParams.get("userId") ?? "").trim() || user.id;

  // A parent may only view a direct child's scheme (or their own).
  if (targetUserId !== user.id && !(await isSelfOrDirectChild(targetUserId, user)))
    return NextResponse.json(
      { error: "You can only view a direct child's scheme" },
      { status: 403 }
    );

  const target = await prisma.user.findFirst({
    where: { id: targetUserId, deletedAt: null },
    select: { id: true, name: true, role: true, schemeId: true },
  });

  if (!target)
    return NextResponse.json({ error: "User not found" }, { status: 404 });

  const forUser =
    targetUserId === user.id
      ? null
      : { id: target.id, name: target.name, role: target.role };

  if (!target.schemeId)
    return NextResponse.json({ scheme: null, role: target.role, forUser });

  const scheme = await prisma.scheme.findFirst({
    where: { id: target.schemeId, active: true },
    include: {
      slabs: { where: { active: true }, orderBy: [{ service: "asc" }, { minAmount: "asc" }] },
      mdrSlabs: { where: { active: true }, orderBy: [{ serviceKind: "asc" }, { minAmount: "asc" }] },
      _count: { select: { slabs: true, users: true, mdrSlabs: true } },
    },
  });

  return NextResponse.json({
    scheme: scheme ? serializeSchemeForRole(scheme, target.role) : null,
    role: target.role,
    forUser,
  });
}
