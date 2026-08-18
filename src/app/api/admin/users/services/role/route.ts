import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const Body = z.object({
  role: z.enum(["RETAILER", "DISTRIBUTOR", "MASTER_DISTRIBUTOR", "SUPER_DISTRIBUTOR"]),
  serviceKeys: z.array(z.string()).min(1),
  action: z.enum(["enable", "disable"]),
});

/**
 * POST /api/admin/users/services/role — enable/disable service keys for EVERY
 * user of a network tier in one shot (e.g. "turn AEPS off for all retailers").
 * Batched so tens of thousands of users don't blow the transaction.
 */
export async function POST(req: Request) {
  try {
    const admin = await requireRole("MASTER_ADMIN", "ADMIN");

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const { role, serviceKeys, action } = parsed.data;

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

    const keySet = new Set(serviceKeys);

    let updated = 0;
    const BATCH = 500;

    // Cursor-paginate through the tier so this works at any network size.
    let cursor: string | undefined;
    for (;;) {
      const users = await prisma.user.findMany({
        where: { role, deletedAt: null },
        select: { id: true, enabledServices: true },
        orderBy: { id: "asc" },
        take: BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (users.length === 0) break;

      // Strict allowlist: `enable` adds the keys, `disable` removes them. An
      // empty list means NO services (default-disabled) — never expand it.
      await prisma.$transaction(
        users.map((u) => {
          const current = u.enabledServices;
          const next =
            action === "enable"
              ? Array.from(new Set([...current, ...serviceKeys]))
              : current.filter((k) => !keySet.has(k));
          return prisma.user.update({
            where: { id: u.id },
            data: { enabledServices: next },
          });
        })
      );

      updated += users.length;
      cursor = users[users.length - 1].id;
      if (users.length < BATCH) break;
    }

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "user.services.role-updated",
        entity: "User",
        meta: { role, action, serviceKeys, updated },
        ip: clientIp(req),
      },
    });

    return NextResponse.json({ ok: true, updated, role, action, serviceKeys });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/users/services/role] POST error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
