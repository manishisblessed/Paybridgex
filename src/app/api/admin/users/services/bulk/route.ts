import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const BulkBody = z.object({
  userIds: z.array(z.string()).min(1).max(500),
  serviceKeys: z.array(z.string()).min(1),
  action: z.enum(["enable", "disable"]),
});

/**
 * Bulk enable/disable services for many users at once. `enable` adds the keys
 * to each user's `enabledServices` allowlist; `disable` removes them.
 */
export async function POST(req: Request) {
  try {
    const admin = await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT");

    const parsed = BulkBody.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const { userIds, serviceKeys, action } = parsed.data;

    // Only known service keys can be assigned.
    const knownRoutes = await prisma.serviceRoute.findMany({
      where: { key: { in: serviceKeys }, type: "SERVICE" },
      select: { key: true },
    });
    const knownKeys = new Set(knownRoutes.map((r) => r.key));
    const unknown = serviceKeys.filter((k) => !knownKeys.has(k));
    if (unknown.length > 0)
      return NextResponse.json(
        { error: `Unknown service keys: ${unknown.join(", ")}` },
        { status: 400 }
      );

    const targets = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, role: true, enabledServices: true },
    });

    if (targets.length === 0)
      return NextResponse.json({ error: "No matching users" }, { status: 404 });

    if (
      admin.role !== "MASTER_ADMIN" &&
      targets.some((u) => ["MASTER_ADMIN", "ADMIN"].includes(u.role))
    )
      return NextResponse.json(
        { error: "Only master-admin can modify admin-level service access" },
        { status: 403 }
      );

    const keySet = new Set(serviceKeys);

    // Strict allowlist: `enable` adds the keys, `disable` removes them. An empty
    // list means NO services (default-disabled) — never expand it to "all".
    await prisma.$transaction([
      ...targets.map((u) => {
        const current = u.enabledServices;
        const next =
          action === "enable"
            ? Array.from(new Set([...current, ...serviceKeys]))
            : current.filter((k) => !keySet.has(k));
        return prisma.user.update({
          where: { id: u.id },
          data: { enabledServices: next },
        });
      }),
      prisma.auditLog.create({
        data: {
          userId: admin.id,
          action: "user.services.bulk-updated",
          entity: "User",
          entityId: null,
          meta: {
            action,
            serviceKeys,
            userIds: targets.map((u) => u.id),
            count: targets.length,
          },
          ip: clientIp(req),
        },
      }),
    ]);

    return NextResponse.json({ ok: true, updated: targets.length, action, serviceKeys });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/users/services/bulk] POST error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
