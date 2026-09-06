import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/pos/machines/brand
 *
 * Link machines to a Brand (or clear it with brandId = null) so their POS
 * captures are priced against that brand's MDR rate card. Target machines by
 * local id and/or terminal id (tid). Optionally set the acquiring provider used
 * for settlement in the same call.
 */
const Body = z.object({
  brandId: z.string().min(1).nullable(),
  machineIds: z.array(z.string().min(1)).default([]),
  tids: z.array(z.string().min(1)).default([]),
  provider: z.string().trim().min(1).max(40).optional(),
});

export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireAdminActivity(req, {
      action: "pos.machines_brand_set",
      roles: ["MASTER_ADMIN", "ADMIN"],
      entity: "PosMachine",
    });
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { brandId, machineIds, tids, provider } = parsed.data;
  if (machineIds.length === 0 && tids.length === 0)
    return NextResponse.json({ error: "Provide machineIds and/or tids" }, { status: 400 });

  if (brandId) {
    const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } });
    if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }

  const where =
    machineIds.length && tids.length
      ? { OR: [{ id: { in: machineIds } }, { tid: { in: tids } }] }
      : machineIds.length
      ? { id: { in: machineIds } }
      : { tid: { in: tids } };

  const result = await prisma.posMachine.updateMany({
    where,
    data: {
      brandId,
      ...(provider ? { provider: provider.toUpperCase() } : {}),
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "pos.machines_brand_set",
      entity: "PosMachine",
      meta: { brandId, provider: provider ?? null, count: result.count, machineIds, tids },
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true, updated: result.count });
}
