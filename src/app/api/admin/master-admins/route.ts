import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { requireRole, AuthError } from "@/lib/auth-server";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const CreateBody = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(10).max(15),
  password: z.string().min(8),
  // Accepted for backward compatibility but ignored — master-admins always
  // have full access and are never tab-scoped.
  allowedTabs: z.array(z.string()).max(100).optional(),
});

export async function GET(req: Request) {
  try {
    await requireRole("MASTER_ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";

  const where: Record<string, unknown> = { role: "MASTER_ADMIN", deletedAt: null };

  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
    ];
  }

  const admins = await prisma.user.findMany({
    where: where as any,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      allowedTabs: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ masterAdmins: admins });
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAdminActivity(req, {
      action: "master_admin.create",
      roles: ["MASTER_ADMIN"],
      entity: "User",
    });
  } catch (e) {
    return toErrorResponse(e);
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid or empty request body" }, { status: 400 });
  }

  const parsed = CreateBody.safeParse(rawBody);
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { name, email, phone, password } = parsed.data;
  const normEmail = email.trim().toLowerCase();
  const normPhone = phone.trim();

  // Include soft-deleted users: the DB unique constraint on email/phone ignores
  // `deletedAt`, so a deleted account still reserves its email/phone. Surfacing
  // this as a clean 409 avoids a P2002 → empty 500 → "Unexpected end of JSON input".
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: normEmail }, { phone: normPhone }] },
    select: { id: true, deletedAt: true, email: true },
  });
  if (existing) {
    const clash = existing.email === normEmail ? "email" : "phone";
    if (existing.deletedAt) {
      return NextResponse.json(
        {
          error: `A previously deleted account still holds this ${clash}. Use a different ${clash}, or fully purge the old account first (scripts/removeRetailer.ts) to free it for reuse.`,
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: `A user with this ${clash} already exists` },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  let admin;
  try {
    admin = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normEmail,
        phone: normPhone,
        passwordHash,
        role: "MASTER_ADMIN",
        status: "ACTIVE",
        allowedTabs: [],
      },
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
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const fields = (e.meta?.target as string[] | undefined)?.join(", ") ?? "email or phone";
      return NextResponse.json(
        { error: `A user with this ${fields} already exists (it may belong to a deleted account).` },
        { status: 409 }
      );
    }
    return toErrorResponse(e);
  }

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "master_admin.created",
      entity: "User",
      entityId: admin.id,
      meta: { name, email: normEmail, phone: normPhone },
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true, masterAdmin: admin }, { status: 201 });
}
