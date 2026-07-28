import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { dec, toNumber } from "@/lib/money";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/** GET — one brand with its MDR rate card. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT", "FINANCE");
    const brand = await prisma.brand.findUnique({
      where: { id: params.id },
      include: {
        rates: { orderBy: [{ provider: "asc" }, { paymentMode: "asc" }, { minAmount: "asc" }] },
        _count: { select: { machines: true } },
      },
    });
    if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

    return NextResponse.json({
      brand: {
        id: brand.id,
        key: brand.key,
        name: brand.name,
        description: brand.description,
        active: brand.active,
        settlementMode: brand.settlementMode,
        machines: brand._count.machines,
        rates: brand.rates.map((r) => ({
          id: r.id,
          provider: r.provider,
          paymentMode: r.paymentMode,
          cardType: r.cardType,
          brandType: r.brandType,
          classification: r.classification,
          minAmount: toNumber(dec(r.minAmount)),
          maxAmount: toNumber(dec(r.maxAmount)),
          mdrType: r.mdrType,
          mdrValue: toNumber(dec(r.mdrValue)),
          mdrValueT0: toNumber(dec(r.mdrValueT0)),
          minMdrValue: toNumber(dec(r.minMdrValue)),
          minMdrValueT0: toNumber(dec(r.minMdrValueT0)),
          active: r.active,
        })),
      },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/brands/:id] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const PatchBody = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  active: z.boolean().optional(),
  settlementMode: z.enum(["INSTANT", "T1", "BOTH"]).optional(),
});

/** PATCH — update brand metadata / active / settlement mode. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const brand = await prisma.brand.findUnique({ where: { id: params.id } });
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  await prisma.brand.update({
    where: { id: params.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description ?? null }
        : {}),
      ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
      ...(parsed.data.settlementMode !== undefined
        ? { settlementMode: parsed.data.settlementMode }
        : {}),
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "brand.updated",
      entity: "Brand",
      entityId: params.id,
      meta: parsed.data as object,
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true });
}

/** DELETE — remove a brand with no linked machines (rates cascade). */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const brand = await prisma.brand.findUnique({
    where: { id: params.id },
    include: { _count: { select: { machines: true } } },
  });
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  if (brand._count.machines > 0)
    return NextResponse.json(
      { error: `Cannot delete — ${brand._count.machines} machine(s) are linked to this brand` },
      { status: 409 }
    );

  await prisma.brand.delete({ where: { id: params.id } });
  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "brand.deleted",
      entity: "Brand",
      entityId: params.id,
      meta: { key: brand.key, name: brand.name },
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true });
}
