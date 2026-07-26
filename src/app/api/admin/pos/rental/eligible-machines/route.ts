import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth-server";
import { isAdminRole, getDescendantIds } from "@/lib/security/ownership";
import { prisma } from "@/lib/db";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/admin/pos/rental/eligible-machines?userId=<id>
 *
 * Returns the full fleet a user holds (their own machines + downline), each
 * annotated with whether that user already has an ACTIVE rental subscription
 * for it. This is the single source of truth for the admin "Assign
 * Subscription" picker — computed server-side and UN-paginated, so it never
 * disagrees with the batch endpoint's duplicate check (the old UI derived
 * subscription status from a 25-row paginated list and wrongly showed
 * already-subscribed machines as available).
 */
export async function GET(req: Request) {
  try {
    const admin = await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT", "FINANCE");
    if (!isAdminRole(admin.role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const userId = new URL(req.url).searchParams.get("userId")?.trim();
    if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // Fleet = machines assigned to this user OR anyone in their downline.
    const descendantIds = await getDescendantIds(userId);
    const fleetUserIds = [userId, ...descendantIds];

    const [machines, activeSubs] = await Promise.all([
      prisma.posMachine.findMany({
        where: { assignedUserId: { in: fleetUserIds } },
        select: { id: true, serial: true, tid: true, model: true, status: true },
        orderBy: [{ assignedAt: "desc" }, { createdAt: "desc" }],
      }),
      prisma.posSubscription.findMany({
        where: { userId, status: "ACTIVE" },
        select: { machineId: true },
      }),
    ]);

    const subbed = new Set(activeSubs.map((s) => s.machineId));
    const serialized = machines.map((m) => ({
      id: m.id,
      serial: m.serial,
      tid: m.tid,
      model: m.model,
      status: m.status,
      hasSub: subbed.has(m.id),
    }));

    return NextResponse.json({
      machines: serialized,
      eligibleMachineIds: serialized.filter((m) => !m.hasSub).map((m) => m.id),
      total: serialized.length,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/pos/rental/eligible-machines] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
