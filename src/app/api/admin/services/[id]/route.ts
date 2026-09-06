import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { isAdminRole } from "@/lib/security/ownership";
import { prisma } from "@/lib/db";

export const fetchCache = "force-no-store";

export const dynamic = "force-dynamic";

const UpdateBody = z
  .object({
    enabled: z.boolean().optional(),
    note: z.string().trim().max(500).nullable().optional(),
    name: z.string().trim().min(2).max(120).optional(),
    provider: z.string().trim().max(60).nullable().optional(),
    sortOrder: z.number().int().min(0).max(100000).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireAdminActivity(req, {
      action: "service.update",
      roles: ["MASTER_ADMIN", "ADMIN", "SUPPORT"],
      entity: "ServiceRoute",
      entityId: params.id,
    });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }

  if (!isAdminRole(admin.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = UpdateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;

  const existing = await prisma.serviceRoute.findUnique({ where: { id: params.id } });
  if (!existing)
    return NextResponse.json({ error: "Service not found" }, { status: 404 });

  const updated = await prisma.serviceRoute.update({
    where: { id: params.id },
    data: {
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.provider !== undefined ? { provider: body.provider } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
    },
  });

  // Audit — a toggle gets its own action so it's easy to filter in the log.
  const isToggle =
    body.enabled !== undefined && body.enabled !== existing.enabled;
  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: isToggle
        ? body.enabled
          ? "service.enable"
          : "service.disable"
        : "service.update",
      entity: "ServiceRoute",
      entityId: updated.id,
      meta: {
        key: updated.key,
        before: {
          enabled: existing.enabled,
          note: existing.note,
          name: existing.name,
          provider: existing.provider,
          sortOrder: existing.sortOrder,
        },
        after: {
          enabled: updated.enabled,
          note: updated.note,
          name: updated.name,
          provider: updated.provider,
          sortOrder: updated.sortOrder,
        },
      },
    },
  });

  return NextResponse.json({
    ok: true,
    service: {
      id: updated.id,
      key: updated.key,
      name: updated.name,
      type: updated.type,
      kind: updated.kind,
      provider: updated.provider,
      enabled: updated.enabled,
      note: updated.note,
      balance: updated.balance == null ? null : Number(updated.balance),
      sortOrder: updated.sortOrder,
      meta: updated.meta ?? null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
}
