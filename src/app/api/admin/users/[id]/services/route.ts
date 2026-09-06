import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, AuthError } from "@/lib/auth-server";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const UpdateBody = z.object({
  enabledServices: z.array(z.string()),
});

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT");

    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, role: true, enabledServices: true },
    });

    if (!user)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    const allServices = await prisma.serviceRoute.findMany({
      where: { type: "SERVICE" },
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
      select: { id: true, key: true, name: true, kind: true, enabled: true },
    });

    return NextResponse.json({
      user: { id: user.id, name: user.name, role: user.role },
      allServices,
      enabledServices: user.enabledServices,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/users/id/services] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await requireAdminActivity(req, {
      action: "user.services.update",
      roles: ["MASTER_ADMIN", "ADMIN", "SUPPORT"],
      entity: "User",
      entityId: params.id,
    });

    const parsed = UpdateBody.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const { enabledServices } = parsed.data;

    const targetUser = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true, role: true, enabledServices: true },
    });

    if (!targetUser)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    if (["MASTER_ADMIN", "ADMIN"].includes(targetUser.role) && admin.role !== "MASTER_ADMIN")
      return NextResponse.json(
        { error: "Only master-admin can modify admin-level service access" },
        { status: 403 }
      );

    await prisma.$transaction([
      prisma.user.update({
        where: { id: params.id },
        data: { enabledServices },
      }),
      prisma.auditLog.create({
        data: {
          userId: admin.id,
          action: "user.services.updated",
          entity: "User",
          entityId: params.id,
          meta: {
            previous: targetUser.enabledServices,
            updated: enabledServices,
          },
          ip: clientIp(req),
        },
      }),
    ]);

    return NextResponse.json({ ok: true, enabledServices });
  } catch (e) {
    return toErrorResponse(e);
  }
}
