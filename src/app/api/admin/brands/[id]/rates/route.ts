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
  // Card dimensions (null = any). Enables per instrument / network / tier MDR.
  cardType: z.string().trim().min(1).max(30).nullish(),
  brandType: z.string().trim().min(1).max(40).nullish(),
  classification: z.string().trim().min(1).max(40).nullish(),
  minAmount: z.number().nonnegative(),
  maxAmount: z.number().positive(),
  // POS acquiring MDR is always a percentage of the transaction (never flat).
  mdrType: z.literal("PERCENT").default("PERCENT"),
  // Vendor/acquirer cost the company pays upstream.
  mdrValue: z.number().nonnegative(),
  // Instant (T+0) vendor cost; 0 = unset, falls back to mdrValue.
  mdrValueT0: z.number().nonnegative().default(0),
  // Minimum MDR the company will offer downstream (vendor cost + company
  // margin). A scheme POS service charge can never be below this.
  minMdrValue: z.number().nonnegative().default(0),
  minMdrValueT0: z.number().nonnegative().default(0),
});

const norm = (v: string) => (v === "*" ? "*" : v.toUpperCase());
const normDim = (v: string | null | undefined) => {
  const s = (v ?? "").trim();
  return s ? s.toUpperCase() : null;
};

/**
 * Guardrail so the company never books a loss: the Minimum MDR (what we offer
 * downstream) must be at least the vendor cost, on both the T+1 and T+0 legs.
 * A zero minimum is allowed (unset) and skipped. T0 values fall back to their
 * T+1 counterpart when unset.
 */
function validateMinMdrVsVendor(v: {
  mdrValue: number;
  mdrValueT0: number;
  minMdrValue: number;
  minMdrValueT0: number;
}): string | null {
  const EPS = 1e-9;
  if (v.minMdrValue > 0 && v.minMdrValue - v.mdrValue < -EPS)
    return `Minimum MDR (${(v.minMdrValue * 100).toFixed(2)}%) cannot be below the vendor cost (${(v.mdrValue * 100).toFixed(2)}%). It must cover the acquirer cost plus the company margin.`;
  const minT0 = v.minMdrValueT0 > 0 ? v.minMdrValueT0 : v.minMdrValue;
  const venT0 = v.mdrValueT0 > 0 ? v.mdrValueT0 : v.mdrValue;
  if (minT0 > 0 && minT0 - venT0 < -EPS)
    return `T+0 Minimum MDR (${(minT0 * 100).toFixed(2)}%) cannot be below the T+0 vendor cost (${(venT0 * 100).toFixed(2)}%).`;
  return null;
}

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

  const b = {
    ...parsed.data,
    provider: norm(parsed.data.provider),
    paymentMode: norm(parsed.data.paymentMode),
    cardType: normDim(parsed.data.cardType),
    brandType: normDim(parsed.data.brandType),
    classification: normDim(parsed.data.classification),
  };

  const overlap = await validateBrandRate(
    params.id,
    {
      provider: b.provider,
      paymentMode: b.paymentMode,
      cardType: b.cardType,
      brandType: b.brandType,
      classification: b.classification,
    },
    { minAmount: b.minAmount, maxAmount: b.maxAmount }
  );
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

  const minErr = validateMinMdrVsVendor(b);
  if (minErr) return NextResponse.json({ error: minErr }, { status: 400 });

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
  cardType: z.string().trim().max(30).nullish(),
  brandType: z.string().trim().max(40).nullish(),
  classification: z.string().trim().max(40).nullish(),
  minAmount: z.number().nonnegative().optional(),
  maxAmount: z.number().positive().optional(),
  mdrType: z.literal("PERCENT").optional(),
  mdrValue: z.number().nonnegative().optional(),
  mdrValueT0: z.number().nonnegative().optional(),
  minMdrValue: z.number().nonnegative().optional(),
  minMdrValueT0: z.number().nonnegative().optional(),
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
    cardType: b.cardType !== undefined ? normDim(b.cardType) : existing.cardType,
    brandType: b.brandType !== undefined ? normDim(b.brandType) : existing.brandType,
    classification: b.classification !== undefined ? normDim(b.classification) : existing.classification,
    minAmount: b.minAmount ?? Number(existing.minAmount),
    maxAmount: b.maxAmount ?? Number(existing.maxAmount),
  };

  const overlap = await validateBrandRate(
    params.id,
    {
      provider: next.provider,
      paymentMode: next.paymentMode,
      cardType: next.cardType,
      brandType: next.brandType,
      classification: next.classification,
    },
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

  const minErr = validateMinMdrVsVendor({
    mdrValue: b.mdrValue ?? Number(existing.mdrValue),
    mdrValueT0: b.mdrValueT0 ?? Number(existing.mdrValueT0),
    minMdrValue: b.minMdrValue ?? Number(existing.minMdrValue),
    minMdrValueT0: b.minMdrValueT0 ?? Number(existing.minMdrValueT0),
  });
  if (minErr) return NextResponse.json({ error: minErr }, { status: 400 });

  const updated = await prisma.brandMdrRate.update({
    where: { id: existing.id },
    data: {
      ...next,
      ...(b.mdrType !== undefined ? { mdrType: b.mdrType } : {}),
      ...(b.mdrValue !== undefined ? { mdrValue: b.mdrValue } : {}),
      ...(b.mdrValueT0 !== undefined ? { mdrValueT0: b.mdrValueT0 } : {}),
      ...(b.minMdrValue !== undefined ? { minMdrValue: b.minMdrValue } : {}),
      ...(b.minMdrValueT0 !== undefined ? { minMdrValueT0: b.minMdrValueT0 } : {}),
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
