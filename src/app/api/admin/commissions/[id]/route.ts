import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { prisma } from "@/lib/db";

const UpdateBody = z.object({
  minAmount: z.number().min(0).optional(),
  maxAmount: z.number().min(0).optional(),
  flat: z.number().nullable().optional(),
  percent: z.number().nullable().optional(),
  active: z.boolean().optional(),
});

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await requireAdminActivity(req, {
      action: "commission.update",
      roles: ["MASTER_ADMIN", "ADMIN"],
      entity: "CommissionSlab",
      entityId: params.id,
    });
    const parsed = UpdateBody.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const existing = await prisma.commissionSlab.findUnique({
      where: { id: params.id },
    });
    if (!existing)
      return NextResponse.json({ error: "Slab not found" }, { status: 404 });

    const updated = await prisma.commissionSlab.update({
      where: { id: params.id },
      data: parsed.data as any,
    });

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "commission.update",
        entity: "CommissionSlab",
        entityId: params.id,
        meta: { previous: { flat: Number(existing.flat), percent: Number(existing.percent) }, updated: parsed.data },
      },
    });

    return NextResponse.json({
      ok: true,
      slab: {
        ...updated,
        minAmount: Number(updated.minAmount),
        maxAmount: Number(updated.maxAmount),
        flat: updated.flat ? Number(updated.flat) : null,
        percent: updated.percent ? Number(updated.percent) : null,
      },
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await requireAdminActivity(req, {
      action: "commission.deactivate",
      roles: ["MASTER_ADMIN", "ADMIN"],
      entity: "CommissionSlab",
      entityId: params.id,
    });

    const existing = await prisma.commissionSlab.findUnique({
      where: { id: params.id },
    });
    if (!existing)
      return NextResponse.json({ error: "Slab not found" }, { status: 404 });

    await prisma.commissionSlab.update({
      where: { id: params.id },
      data: { active: false, effectiveTo: new Date() },
    });

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "commission.deactivate",
        entity: "CommissionSlab",
        entityId: params.id,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
