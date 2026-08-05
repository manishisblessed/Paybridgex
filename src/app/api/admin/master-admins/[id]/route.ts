import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { bumpTokenVersion } from "@/lib/security/session";
import { generateRandomPassword } from "@/lib/utils";

const PatchBody = z
  .object({
    // Master-admins always have full access, so there is no tab scoping here.
    action: z.enum(["suspend", "activate", "reset-password", "reset-2fa"]),
  })
  .strict();

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  let caller;
  try {
    caller = await requireRole("MASTER_ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  if (caller.id === params.id) {
    return NextResponse.json(
      { error: "You cannot modify your own account from here" },
      { status: 403 }
    );
  }

  const target = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, role: true, status: true, name: true },
  });

  if (!target || target.role !== "MASTER_ADMIN") {
    return NextResponse.json({ error: "Master admin not found" }, { status: 404 });
  }

  const parsed = PatchBody.safeParse(await req.json());
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { action } = parsed.data;

  if (action === "reset-password") {
    const password = generateRandomPassword(14);
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.update({ where: { id: params.id }, data: { passwordHash } });
    await bumpTokenVersion(params.id, { swallow: true });
    await prisma.auditLog.create({
      data: {
        userId: caller.id,
        action: "master_admin.password_reset",
        entity: "User",
        entityId: params.id,
        meta: { name: target.name },
        ip: clientIp(req),
      },
    });
    // Returned once for out-of-band delivery; never stored in plain text.
    return NextResponse.json({ ok: true, password });
  }

  if (action === "reset-2fa") {
    await prisma.user.update({
      where: { id: params.id },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: [],
        twoFactorVerifiedAt: null,
      },
    });
    await bumpTokenVersion(params.id, { swallow: true });
    await prisma.auditLog.create({
      data: {
        userId: caller.id,
        action: "master_admin.2fa_reset",
        entity: "User",
        entityId: params.id,
        meta: { name: target.name },
        ip: clientIp(req),
      },
    });
    return NextResponse.json({
      ok: true,
      message: "2FA reset. The master admin must set up a new authenticator on next login.",
    });
  }

  const update = { status: action === "suspend" ? "SUSPENDED" : "ACTIVE" };

  const updated = await prisma.user.update({
    where: { id: params.id },
    data: update as any,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      allowedTabs: true,
      createdAt: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: caller.id,
      action: `master_admin.${action}`,
      entity: "User",
      entityId: params.id,
      meta: { action },
      ip: clientIp(req),
    },
  });

  await bumpTokenVersion(params.id, { swallow: true });

  return NextResponse.json({ ok: true, masterAdmin: updated });
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  let caller;
  try {
    caller = await requireRole("MASTER_ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  if (caller.id === params.id) {
    return NextResponse.json(
      { error: "You cannot delete your own account" },
      { status: 403 }
    );
  }

  const target = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, role: true, name: true },
  });

  if (!target || target.role !== "MASTER_ADMIN") {
    return NextResponse.json({ error: "Master admin not found" }, { status: 404 });
  }

  await prisma.user.update({
    where: { id: params.id },
    data: { deletedAt: new Date(), status: "CLOSED" },
  });

  await prisma.auditLog.create({
    data: {
      userId: caller.id,
      action: "master_admin.deleted",
      entity: "User",
      entityId: params.id,
      meta: { name: target.name },
      ip: clientIp(req),
    },
  });

  await bumpTokenVersion(params.id, { swallow: true });

  return NextResponse.json({ ok: true });
}
