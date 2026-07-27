import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { validateRailRate } from "@/lib/rail/mdr";
import { validateMdrAgainstFloor } from "@/lib/mdr/floor";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

function parseRail(kind: string): "PG" | "QR" | null {
  const k = kind.toUpperCase();
  return k === "PG" || k === "QR" ? k : null;
}

const norm = (v: string) => (v === "*" ? "*" : v.toUpperCase());
const normDim = (v: string | null | undefined) => {
  const s = (v ?? "").trim();
  return s ? s.toUpperCase() : null;
};

const RateBody = z.object({
  scopeKey: z.string().trim().min(1).max(60),
  scopeLabel: z.string().trim().min(1).max(80).nullish(),
  provider: z.string().trim().min(1).max(40).default("*"),
  paymentMode: z.string().trim().min(1).max(30).default("*"),
  cardType: z.string().trim().min(1).max(30).nullish(),
  brandType: z.string().trim().min(1).max(40).nullish(),
  classification: z.string().trim().min(1).max(40).nullish(),
  minAmount: z.number().nonnegative(),
  maxAmount: z.number().positive(),
  mdrType: z.enum(["FLAT", "PERCENT"]).default("PERCENT"),
  mdrValue: z.number().nonnegative(),
  mdrValueT0: z.number().nonnegative().default(0),
});

/** POST — add a rail (PG/QR) MDR rate for a provider (band-overlap validated). */
export async function POST(req: Request, { params }: { params: { kind: string } }) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const rail = parseRail(params.kind);
  if (!rail) return NextResponse.json({ error: "Unknown rail" }, { status: 404 });

  const parsed = RateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const b = {
    ...parsed.data,
    provider: norm(parsed.data.provider),
    paymentMode: norm(parsed.data.paymentMode),
    cardType: normDim(parsed.data.cardType),
    brandType: normDim(parsed.data.brandType),
    classification: normDim(parsed.data.classification),
    scopeKey: parsed.data.scopeKey.trim(),
    scopeLabel: parsed.data.scopeLabel?.trim() || null,
  };

  const overlap = await validateRailRate(
    rail,
    b.scopeKey,
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

  // Defense-in-depth: a rail rate may not sit below any configured company floor.
  const floorErr = await validateMdrAgainstFloor(
    {
      serviceKind: rail,
      paymentMode: b.paymentMode,
      mdrType: b.mdrType,
      mdrValue: b.mdrValue,
      mdrValueT0: b.mdrValueT0,
    },
    { matchAllScopes: true }
  );
  if (floorErr) return NextResponse.json({ error: floorErr }, { status: 400 });

  const rate = await prisma.railMdrRate.create({
    data: { serviceKind: rail, ...b },
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "rail_rate.created",
      entity: "RailMdrRate",
      entityId: rate.id,
      meta: { rail, ...b },
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
  mdrType: z.enum(["FLAT", "PERCENT"]).optional(),
  mdrValue: z.number().nonnegative().optional(),
  mdrValueT0: z.number().nonnegative().optional(),
  active: z.boolean().optional(),
});

/** PATCH — edit a rail MDR rate (band-overlap revalidated). */
export async function PATCH(req: Request, { params }: { params: { kind: string } }) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const rail = parseRail(params.kind);
  if (!rail) return NextResponse.json({ error: "Unknown rail" }, { status: 404 });

  const parsed = UpdateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { rateId, ...b } = parsed.data;

  const existing = await prisma.railMdrRate.findFirst({ where: { id: rateId, serviceKind: rail } });
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

  const overlap = await validateRailRate(
    rail,
    existing.scopeKey,
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
      serviceKind: rail,
      paymentMode: next.paymentMode,
      mdrType: b.mdrType ?? existing.mdrType,
      mdrValue: b.mdrValue ?? Number(existing.mdrValue),
      mdrValueT0: b.mdrValueT0 ?? Number(existing.mdrValueT0),
    },
    { matchAllScopes: true }
  );
  if (floorErr) return NextResponse.json({ error: floorErr }, { status: 400 });

  const updated = await prisma.railMdrRate.update({
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
      action: "rail_rate.updated",
      entity: "RailMdrRate",
      entityId: updated.id,
      meta: { rail, changes: b },
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true, rateId: updated.id });
}

const DeleteBody = z.object({ rateId: z.string().min(1) });

/** DELETE — remove a rail MDR rate. */
export async function DELETE(req: Request, { params }: { params: { kind: string } }) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const rail = parseRail(params.kind);
  if (!rail) return NextResponse.json({ error: "Unknown rail" }, { status: 404 });

  const parsed = DeleteBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const rate = await prisma.railMdrRate.findFirst({
    where: { id: parsed.data.rateId, serviceKind: rail },
  });
  if (!rate) return NextResponse.json({ error: "Rate not found" }, { status: 404 });

  await prisma.railMdrRate.delete({ where: { id: rate.id } });
  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "rail_rate.deleted",
      entity: "RailMdrRate",
      entityId: rate.id,
      meta: { rail, scopeKey: rate.scopeKey },
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true });
}
