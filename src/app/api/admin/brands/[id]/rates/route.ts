import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { validateBrandRate } from "@/lib/brand/mdr";
import { validateMdrAgainstFloor } from "@/lib/mdr/floor";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const RateBody = z.object({
  provider: z.string().trim().min(1).max(40).default("*"),
  paymentMode: z.string().trim().min(1).max(30).default("*"),
  minAmount: z.number().nonnegative(),
  maxAmount: z.number().positive(),
  mdrType: z.enum(["FLAT", "PERCENT"]).default("PERCENT"),
  mdrValue: z.number().nonnegative(),
  // Instant (T+0) rate; 0 = unset, falls back to mdrValue.
  mdrValueT0: z.number().nonnegative().default(0),
});

const norm = (v: string) => (v === "*" ? "*" : v.toUpperCase());

/** POST — add an MDR rate to a brand (band-overlap validated per provider+mode). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const parsed = RateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const brand = await prisma.brand.findUnique({ where: { id: params.id } });
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  const b = { ...parsed.data, provider: norm(parsed.data.provider), paymentMode: norm(parsed.data.paymentMode) };

  const overlap = await validateBrandRate(params.id, b.provider, b.paymentMode, {
    minAmount: b.minAmount,
    maxAmount: b.maxAmount,
  });
  if (overlap) return NextResponse.json({ error: overlap }, { status: 400 });

  const floorErr = await validateMdrAgainstFloor(
    {
      serviceKind: "POS",
      paymentMode: b.paymentMode,
      mdrType: b.mdrType,
      mdrValue: b.mdrValue,
      mdrValueT0: b.mdrValueT0,
    },
    { matchAllScopes: true }
  );
  if (floorErr) return NextResponse.json({ error: floorErr }, { status: 400 });

  const rate = await prisma.brandMdrRate.create({
    data: { brandId: params.id, ...b },
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "brand_rate.created",
      entity: "BrandMdrRate",
      entityId: rate.id,
      meta: { brandId: params.id, ...b },
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true, rateId: rate.id }, { status: 201 });
}

const UpdateBody = z.object({
  rateId: z.string().min(1),
  provider: z.string().trim().min(1).max(40).optional(),
  paymentMode: z.string().trim().min(1).max(30).optional(),
  minAmount: z.number().nonnegative().optional(),
  maxAmount: z.number().positive().optional(),
  mdrType: z.enum(["FLAT", "PERCENT"]).optional(),
  mdrValue: z.number().nonnegative().optional(),
  mdrValueT0: z.number().nonnegative().optional(),
  active: z.boolean().optional(),
});

/** PATCH — edit a brand rate (band-overlap revalidated). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const parsed = UpdateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { rateId, ...b } = parsed.data;

  const existing = await prisma.brandMdrRate.findFirst({ where: { id: rateId, brandId: params.id } });
  if (!existing) return NextResponse.json({ error: "Rate not found" }, { status: 404 });

  const next = {
    provider: b.provider !== undefined ? norm(b.provider) : existing.provider,
    paymentMode: b.paymentMode !== undefined ? norm(b.paymentMode) : existing.paymentMode,
    minAmount: b.minAmount ?? Number(existing.minAmount),
    maxAmount: b.maxAmount ?? Number(existing.maxAmount),
  };

  const overlap = await validateBrandRate(
    params.id,
    next.provider,
    next.paymentMode,
    { minAmount: next.minAmount, maxAmount: next.maxAmount },
    existing.id
  );
  if (overlap) return NextResponse.json({ error: overlap }, { status: 400 });

  const floorErr = await validateMdrAgainstFloor(
    {
      serviceKind: "POS",
      paymentMode: next.paymentMode,
      mdrType: b.mdrType ?? existing.mdrType,
      mdrValue: b.mdrValue ?? Number(existing.mdrValue),
      mdrValueT0: b.mdrValueT0 ?? Number(existing.mdrValueT0),
    },
    { matchAllScopes: true }
  );
  if (floorErr) return NextResponse.json({ error: floorErr }, { status: 400 });

  const updated = await prisma.brandMdrRate.update({
    where: { id: existing.id },
    data: {
      ...next,
      ...(b.mdrType !== undefined ? { mdrType: b.mdrType } : {}),
      ...(b.mdrValue !== undefined ? { mdrValue: b.mdrValue } : {}),
      ...(b.mdrValueT0 !== undefined ? { mdrValueT0: b.mdrValueT0 } : {}),
      ...(b.active !== undefined ? { active: b.active } : {}),
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "brand_rate.updated",
      entity: "BrandMdrRate",
      entityId: updated.id,
      meta: { brandId: params.id, changes: b },
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true, rateId: updated.id });
}

const DeleteBody = z.object({ rateId: z.string().min(1) });

/** DELETE — remove a brand rate. */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const parsed = DeleteBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const rate = await prisma.brandMdrRate.findFirst({
    where: { id: parsed.data.rateId, brandId: params.id },
  });
  if (!rate) return NextResponse.json({ error: "Rate not found" }, { status: 404 });

  await prisma.brandMdrRate.delete({ where: { id: rate.id } });
  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "brand_rate.deleted",
      entity: "BrandMdrRate",
      entityId: rate.id,
      meta: { brandId: params.id },
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true });
}
