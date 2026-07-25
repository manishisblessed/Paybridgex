import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/** GET — all company MDR floor entries. */
export async function GET() {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "FINANCE");
    const floors = await prisma.companyMdrFloor.findMany({
      orderBy: [{ serviceKind: "asc" }, { paymentMode: "asc" }, { minAmount: "asc" }],
    });
    return NextResponse.json({
      floors: floors.map((f) => ({
        id: f.id,
        serviceKind: f.serviceKind,
        paymentMode: f.paymentMode,
        scopeKey: f.scopeKey,
        scopeLabel: f.scopeLabel,
        minAmount: Number(f.minAmount),
        maxAmount: Number(f.maxAmount),
        mdrType: f.mdrType,
        mdrValue: Number(f.mdrValue),
        mdrValueT0: Number(f.mdrValueT0),
        active: f.active,
        createdAt: f.createdAt.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
      })),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/company-charges] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const CreateBody = z.object({
  serviceKind: z.enum(["POS", "PG", "QR"]),
  paymentMode: z.string().trim().min(1).max(30).default("*"),
  // Per-entity scope (PG pipeline / QR provider). Omit/null = platform-wide.
  scopeKey: z.string().trim().min(1).max(60).nullish(),
  scopeLabel: z.string().trim().min(1).max(80).nullish(),
  minAmount: z.number().nonnegative().default(0),
  maxAmount: z.number().positive().default(999999999),
  mdrType: z.enum(["FLAT", "PERCENT"]).default("PERCENT"),
  mdrValue: z.number().nonnegative(),
  mdrValueT0: z.number().nonnegative().default(0),
});

const normMode = (v: string) => (v === "*" ? "*" : v.toUpperCase());
const normScope = (v: string | null | undefined) => {
  const s = (v ?? "").trim();
  return s ? s : null;
};

/** POST — create a company MDR floor entry. */
export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const b = {
    ...parsed.data,
    paymentMode: normMode(parsed.data.paymentMode),
    // POS floors are governed by the approved brand rate, never scoped here.
    scopeKey: parsed.data.serviceKind === "POS" ? null : normScope(parsed.data.scopeKey),
    scopeLabel: parsed.data.serviceKind === "POS" ? null : normScope(parsed.data.scopeLabel),
  };

  if (b.minAmount > b.maxAmount)
    return NextResponse.json({ error: "minAmount must be ≤ maxAmount" }, { status: 400 });

  const overlap = await checkOverlap(b.serviceKind, b.paymentMode, b.scopeKey, b.minAmount, b.maxAmount);
  if (overlap) return NextResponse.json({ error: overlap }, { status: 400 });

  const floor = await prisma.companyMdrFloor.create({ data: b });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "company_mdr_floor.created",
      entity: "CompanyMdrFloor",
      entityId: floor.id,
      meta: b,
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true, floorId: floor.id }, { status: 201 });
}

const UpdateBody = z.object({
  floorId: z.string().min(1),
  paymentMode: z.string().trim().min(1).max(30).optional(),
  scopeKey: z.string().trim().max(60).nullish(),
  scopeLabel: z.string().trim().max(80).nullish(),
  minAmount: z.number().nonnegative().optional(),
  maxAmount: z.number().positive().optional(),
  mdrType: z.enum(["FLAT", "PERCENT"]).optional(),
  mdrValue: z.number().nonnegative().optional(),
  mdrValueT0: z.number().nonnegative().optional(),
  active: z.boolean().optional(),
});

/** PATCH — update a company MDR floor entry. */
export async function PATCH(req: Request) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const parsed = UpdateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { floorId, ...b } = parsed.data;

  const existing = await prisma.companyMdrFloor.findUnique({ where: { id: floorId } });
  if (!existing) return NextResponse.json({ error: "Floor entry not found" }, { status: 404 });

  // POS floors are never scoped (approved brand rate governs POS).
  const nextScopeKey =
    existing.serviceKind === "POS"
      ? null
      : b.scopeKey !== undefined
      ? normScope(b.scopeKey)
      : existing.scopeKey;

  const next = {
    paymentMode: b.paymentMode !== undefined ? normMode(b.paymentMode) : existing.paymentMode,
    minAmount: b.minAmount ?? Number(existing.minAmount),
    maxAmount: b.maxAmount ?? Number(existing.maxAmount),
  };

  if (next.minAmount > next.maxAmount)
    return NextResponse.json({ error: "minAmount must be ≤ maxAmount" }, { status: 400 });

  const overlap = await checkOverlap(
    existing.serviceKind,
    next.paymentMode,
    nextScopeKey,
    next.minAmount,
    next.maxAmount,
    existing.id
  );
  if (overlap) return NextResponse.json({ error: overlap }, { status: 400 });

  const updated = await prisma.companyMdrFloor.update({
    where: { id: existing.id },
    data: {
      ...next,
      scopeKey: nextScopeKey,
      ...(b.scopeLabel !== undefined
        ? { scopeLabel: existing.serviceKind === "POS" ? null : normScope(b.scopeLabel) }
        : {}),
      ...(b.mdrType !== undefined ? { mdrType: b.mdrType } : {}),
      ...(b.mdrValue !== undefined ? { mdrValue: b.mdrValue } : {}),
      ...(b.mdrValueT0 !== undefined ? { mdrValueT0: b.mdrValueT0 } : {}),
      ...(b.active !== undefined ? { active: b.active } : {}),
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "company_mdr_floor.updated",
      entity: "CompanyMdrFloor",
      entityId: updated.id,
      meta: { changes: b },
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true, floorId: updated.id });
}

const DeleteBody = z.object({ floorId: z.string().min(1) });

/** DELETE — remove a company MDR floor entry. */
export async function DELETE(req: Request) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const parsed = DeleteBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const floor = await prisma.companyMdrFloor.findUnique({ where: { id: parsed.data.floorId } });
  if (!floor) return NextResponse.json({ error: "Floor entry not found" }, { status: 404 });

  await prisma.companyMdrFloor.delete({ where: { id: floor.id } });
  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "company_mdr_floor.deleted",
      entity: "CompanyMdrFloor",
      entityId: floor.id,
      meta: { serviceKind: floor.serviceKind, paymentMode: floor.paymentMode },
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true });
}

/**
 * Validate no overlapping bands exist for the same (serviceKind, paymentMode).
 */
async function checkOverlap(
  serviceKind: string,
  paymentMode: string,
  scopeKey: string | null,
  minAmount: number,
  maxAmount: number,
  excludeId?: string
): Promise<string | null> {
  const existing = await prisma.companyMdrFloor.findMany({
    where: {
      serviceKind: serviceKind as "POS" | "PG" | "QR",
      paymentMode,
      scopeKey: scopeKey ?? null,
      active: true,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { minAmount: true, maxAmount: true },
  });
  const scopeSuffix = scopeKey ? `/${scopeKey}` : "";
  for (const r of existing) {
    if (minAmount <= Number(r.maxAmount) && Number(r.minAmount) <= maxAmount) {
      return `Range ₹${minAmount}–₹${maxAmount} overlaps an existing ${serviceKind}/${paymentMode}${scopeSuffix} floor (₹${Number(r.minAmount)}–₹${Number(r.maxAmount)})`;
    }
  }
  return null;
}
