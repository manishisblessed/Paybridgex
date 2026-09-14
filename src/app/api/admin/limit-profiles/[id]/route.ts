import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { prisma } from "@/lib/db";
import { serializeProfile, serviceCapsSchema } from "../shared";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const UpdateBody = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  active: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  dailyAmountCap: z.number().positive().max(1_000_000_000).nullable().optional(),
  dailyCountCap: z.number().int().positive().max(100_000).nullable().optional(),
  nightFactor: z.number().gt(0).max(1).nullable().optional(),
  serviceCaps: serviceCapsSchema.optional(),
});

/** PATCH — edit a tier's caps / matrix / default flag. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let data: z.infer<typeof UpdateBody>;
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = UpdateBody.safeParse(raw);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    data = parsed.data;
    await requireAdminActivity(req, {
      action: "limits.tier.update",
      roles: ["MASTER_ADMIN", "ADMIN"],
      entity: "LimitProfile",
      entityId: params.id,
      body: raw,
      meta: data,
    });
  } catch (e) {
    return toErrorResponse(e);
  }

  const target = await prisma.limitProfile.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: "Tier not found" }, { status: 404 });

  // A default tier must always exist as the safety fallback.
  if (target.isDefault && (data.isDefault === false || data.active === false))
    return NextResponse.json(
      { error: "This is the default tier. Mark another tier as default before changing this." },
      { status: 400 }
    );

  const updated = await prisma.$transaction(async (tx) => {
    if (data.isDefault === true) {
      await tx.limitProfile.updateMany({
        where: { isDefault: true, NOT: { id: params.id } },
        data: { isDefault: false },
      });
    }
    return tx.limitProfile.update({
      where: { id: params.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
        ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
        ...(data.dailyAmountCap !== undefined ? { dailyAmountCap: data.dailyAmountCap } : {}),
        ...(data.dailyCountCap !== undefined ? { dailyCountCap: data.dailyCountCap } : {}),
        ...(data.nightFactor !== undefined ? { nightFactor: data.nightFactor } : {}),
        ...(data.serviceCaps !== undefined ? { serviceCaps: data.serviceCaps } : {}),
      },
      include: { _count: { select: { users: true } } },
    });
  });

  return NextResponse.json({ profile: serializeProfile(updated) });
}

/** DELETE — remove a tier. Pinned users fall back to the policy/default tier. */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireAdminActivity(req, {
      action: "limits.tier.delete",
      roles: ["MASTER_ADMIN", "ADMIN"],
      entity: "LimitProfile",
      entityId: params.id,
    });
  } catch (e) {
    return toErrorResponse(e);
  }

  const target = await prisma.limitProfile.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: "Tier not found" }, { status: 404 });
  if (target.isDefault)
    return NextResponse.json(
      { error: "Cannot delete the default tier. Mark another tier as default first." },
      { status: 400 }
    );

  // FK is ON DELETE SET NULL — pinned users simply revert to auto-tiering.
  await prisma.limitProfile.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
