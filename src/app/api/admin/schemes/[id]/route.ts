import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, AuthError } from "@/lib/auth-server";
import { isAdminRole } from "@/lib/security/ownership";
import { prisma } from "@/lib/db";
import { serializeScheme, serializeSlab } from "@/lib/scheme/serialize";
import { resolveServiceVendorInfo } from "@/lib/scheme/serviceVendor";
import { requireStepUp, readStepUpCode } from "@/lib/security/stepUp";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { clientIp } from "@/lib/security/audit";
import { toErrorResponse } from "@/lib/security/apiErrors";

export const fetchCache = "force-no-store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT");

    const scheme = await prisma.scheme.findUnique({
      where: { id: params.id },
      include: {
        _count: { select: { slabs: true, users: true, mdrSlabs: true } },
        slabs: { orderBy: [{ service: "asc" }, { minAmount: "asc" }] },
        mdrSlabs: { orderBy: [{ serviceKind: "asc" }, { minAmount: "asc" }] },
      },
    });
    if (!scheme) return NextResponse.json({ error: "Scheme not found" }, { status: 404 });

    const assignedUsers = await prisma.user.findMany({
      where: { schemeId: scheme.id },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: "asc" },
      take: 200,
    });

    // Resolve the CURRENT vendor cost + minimum per BBPS/Payout slab live from
    // the rate cards, so the slab table's revenue always reflects the latest
    // card (the stored vendorCharge is a save-time snapshot and can be stale).
    const serialized = serializeScheme(scheme);
    const slabsWithLive = await Promise.all(
      scheme.slabs.map(async (s) => {
        const info = await resolveServiceVendorInfo({
          service: s.service,
          provider: s.provider,
          amount: Number(s.minAmount),
        });
        return {
          ...serializeSlab(s),
          vendorChargeLive: info?.vendorCharge ?? null,
          minChargeLive: info?.minCharge ?? null,
        };
      })
    );

    return NextResponse.json({
      scheme: { ...serialized, slabs: slabsWithLive },
      assignedUsers,
    });
  } catch (e: unknown) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/schemes/:id] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const UpdateBody = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  stepUpCode: z.string().max(20).optional(),
  stepUpType: z.enum(["totp", "backup"]).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN");
    if (!isAdminRole(admin.role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    await enforceRateLimit(`scheme:write:${admin.id}`, RATE_LIMITS.sensitiveWrite);
  } catch (e: unknown) {
    return toErrorResponse(e);
  }

  const parsed = UpdateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;

  // Step-up 2FA: pricing/scheme changes are high-impact config mutations.
  try {
    const { code, type } = readStepUpCode(req, parsed.data);
    await requireStepUp(admin, {
      action: "scheme.update",
      code: code ?? body.stepUpCode,
      type: body.stepUpType ?? type,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });
  } catch (e) {
    return toErrorResponse(e);
  }

  const existing = await prisma.scheme.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "Scheme not found" }, { status: 404 });

  if (body.name && body.name !== existing.name) {
    const dupe = await prisma.scheme.findUnique({ where: { name: body.name } });
    if (dupe) return NextResponse.json({ error: `A scheme named "${body.name}" already exists` }, { status: 409 });
  }

  // A default scheme must stay active; refuse to deactivate it.
  if (existing.isDefault && body.active === false)
    return NextResponse.json({ error: "Cannot deactivate the default scheme. Set another scheme as default first." }, { status: 400 });

  const updated = await prisma.$transaction(async (tx) => {
    if (body.isDefault === true) {
      await tx.scheme.updateMany({ where: { isDefault: true, id: { not: params.id } }, data: { isDefault: false } });
    }
    return tx.scheme.update({
      where: { id: params.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
      },
      include: { _count: { select: { slabs: true, users: true } } },
    });
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "scheme.update",
      entity: "Scheme",
      entityId: params.id,
      meta: { changes: body },
    },
  });

  return NextResponse.json({ ok: true, scheme: serializeScheme(updated) });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN");
    if (!isAdminRole(admin.role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    await enforceRateLimit(`scheme:write:${admin.id}`, RATE_LIMITS.sensitiveWrite);
    const { code, type } = readStepUpCode(req);
    await requireStepUp(admin, {
      action: "scheme.delete",
      code,
      type,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }

  const existing = await prisma.scheme.findUnique({
    where: { id: params.id },
    include: { _count: { select: { users: true } } },
  });
  if (!existing) return NextResponse.json({ error: "Scheme not found" }, { status: 404 });
  if (existing.isDefault)
    return NextResponse.json({ error: "Cannot delete the default scheme." }, { status: 400 });
  if (existing._count.users > 0)
    return NextResponse.json(
      { error: `Scheme is assigned to ${existing._count.users} user(s). Reassign them before deleting.` },
      { status: 400 }
    );

  // Soft delete: deactivate rather than hard-removing financial config.
  await prisma.scheme.update({ where: { id: params.id }, data: { active: false } });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "scheme.deactivate",
      entity: "Scheme",
      entityId: params.id,
      meta: { name: existing.name },
    },
  });

  return NextResponse.json({ ok: true });
}
