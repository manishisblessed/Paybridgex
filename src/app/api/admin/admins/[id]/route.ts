import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { bumpTokenVersion } from "@/lib/security/session";
import { generateRandomPassword } from "@/lib/utils";

const PatchBody = z.object({
  action: z.enum(["suspend", "activate", "close", "update-tabs", "reset-password", "reset-2fa"]),
  allowedTabs: z.array(z.string()).optional(),
}).strict();

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  let masterAdmin;
  try {
    masterAdmin = await requireRole("MASTER_ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const target = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, role: true, status: true, name: true },
  });

  if (!target || target.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin not found" }, { status: 404 });
  }

  const parsed = PatchBody.safeParse(await req.json());
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { action, allowedTabs } = parsed.data;

  // Reset actions don't fit the generic update+return pattern — handle early.
  if (action === "reset-password") {
    const password = generateRandomPassword(12);
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.update({ where: { id: params.id }, data: { passwordHash } });
    await bumpTokenVersion(params.id, { swallow: true });
    await prisma.auditLog.create({
      data: {
        userId: masterAdmin.id,
        action: "admin.password_reset",
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
        userId: masterAdmin.id,
        action: "admin.2fa_reset",
        entity: "User",
        entityId: params.id,
        meta: { name: target.name },
        ip: clientIp(req),
      },
    });
    return NextResponse.json({
      ok: true,
      message: "2FA reset. The admin must set up a new authenticator on next login.",
    });
  }

  let update: Record<string, unknown> = {};

  switch (action) {
    case "suspend":
      update = { status: "SUSPENDED" };
      break;
    case "activate":
      update = { status: "ACTIVE" };
      break;
    case "close":
      update = { status: "CLOSED", deletedAt: new Date() };
      break;
    case "update-tabs":
      if (!allowedTabs) {
        return NextResponse.json(
          { error: "allowedTabs required for update-tabs action" },
          { status: 400 }
        );
      }
      update = { allowedTabs };
      break;
  }

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
      userId: masterAdmin.id,
      action: `admin.${action}`,
      entity: "User",
      entityId: params.id,
      meta: { action, allowedTabs },
      ip: clientIp(req),
    },
  });

  // Status/permission change is a privilege change → invalidate target sessions.
  await bumpTokenVersion(params.id, { swallow: true });

  return NextResponse.json({ ok: true, admin: updated });
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  let masterAdmin;
  try {
    masterAdmin = await requireRole("MASTER_ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const target = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, role: true, name: true },
  });

  if (!target || target.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin not found" }, { status: 404 });
  }

  await prisma.user.update({
    where: { id: params.id },
    data: { deletedAt: new Date(), status: "CLOSED" },
  });

  await prisma.auditLog.create({
    data: {
      userId: masterAdmin.id,
      action: "admin.deleted",
      entity: "User",
      entityId: params.id,
      meta: { name: target.name },
      ip: clientIp(req),
    },
  });

  await bumpTokenVersion(params.id, { swallow: true });

  return NextResponse.json({ ok: true });
}
