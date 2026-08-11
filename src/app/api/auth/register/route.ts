import { NextResponse } from "next/server";

/**
 * Public self-serve account creation is DISABLED.
 *
 * Prospective agents now submit the public Join Form (POST /api/join), and the
 * support team converts qualified leads into onboarding invites. Accounts are
 * only ever created through the invite → /onboard flow, never directly here.
 *
 * This route is intentionally kept (returning 410 Gone) so any old client,
 * bookmark, or bot hitting it gets a clear, non-500 response instead of
 * silently creating an account.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Self-serve signup is no longer available. Please submit the Join Form and our team will onboard you.",
      joinUrl: "/register",
    },
    { status: 410 }
  );
}
