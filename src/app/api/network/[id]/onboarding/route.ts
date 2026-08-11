import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { canAccessUser } from "@/lib/security/ownership";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { getOnboardingProgress } from "@/lib/onboarding/status";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * GET — onboarding / KYC progress for a member the caller owns (self + downline).
 * Lets a parent (DT/MD/SD) see exactly where their onboardee is stuck and what
 * is pending, WITHOUT exposing any documents or raw KYC PII (status-only).
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth();

    if (!(await canAccessUser(params.id, user))) {
      return NextResponse.json(
        { error: "This account is not in your network" },
        { status: 403 }
      );
    }

    const target = await prisma.user.findFirst({
      where: { id: params.id, deletedAt: null },
      select: {
        id: true,
        name: true,
        userCode: true,
        phone: true,
        role: true,
        status: true,
        createdAt: true,
        hasLivenessVideo: true,
      },
    });
    if (!target)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    const progress = await getOnboardingProgress({
      id: target.id,
      role: target.role,
      status: target.status,
      hasLivenessVideo: target.hasLivenessVideo,
    });

    return NextResponse.json({
      user: {
        id: target.id,
        name: target.name,
        userCode: target.userCode,
        phone: target.phone,
        role: target.role,
        createdAt: target.createdAt.toISOString(),
      },
      ...progress,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    return toErrorResponse(e);
  }
}
