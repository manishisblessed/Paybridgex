import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { ONBOARD_CAPABLE_ROLES } from "@/lib/hierarchy";
import { onboardingLinkFor } from "@/lib/onboarding/inviteNotifications";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * GET — onboarding invites a parent SHARED that have not yet converted into a
 * registered account (userId is still null). Lets a distributor tier see and
 * chase links they sent before the invitee registers. Once the invitee
 * registers, they drop out of this list and appear in the main network list.
 *
 * Scope: strictly `invitedById = caller` — a parent only ever sees links they
 * themselves shared. Returns only the contact details the parent entered plus
 * the link (no PII beyond that).
 */
export async function GET() {
  try {
    const user = await requireAuth();

    if (!(ONBOARD_CAPABLE_ROLES as string[]).includes(user.role)) {
      return NextResponse.json(
        { error: "You cannot view onboarding invites" },
        { status: 403 }
      );
    }

    const invites = await prisma.invite.findMany({
      where: {
        invitedById: user.id,
        userId: null,
        status: { in: ["PENDING", "EXPIRED"] },
      },
      orderBy: { createdAt: "desc" },
    });

    const now = new Date();
    const out = invites.map((inv) => ({
      id: inv.id,
      name: inv.name,
      phone: inv.phone,
      email: inv.email,
      role: inv.role,
      status:
        inv.status === "PENDING" && inv.expiresAt < now ? "EXPIRED" : inv.status,
      createdAt: inv.createdAt.toISOString(),
      expiresAt: inv.expiresAt.toISOString(),
      onboardingLink: onboardingLinkFor(inv.token),
    }));

    return NextResponse.json({ invites: out });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    return toErrorResponse(e);
  }
}
