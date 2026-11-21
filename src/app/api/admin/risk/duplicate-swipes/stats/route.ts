import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { isAdminRole } from "@/lib/security/ownership";
import { getDuplicateSwipeStats } from "@/lib/risk/duplicateSwipe";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET() {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }
  if (!isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const stats = await getDuplicateSwipeStats();
  return NextResponse.json(stats);
}
