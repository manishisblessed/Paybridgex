import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
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
  // Tab slugs this sub-admin may access. Empty/omitted = full sub-admin menu.
  allowedTabs: z.array(z.string()).optional(),
});

export async function GET(req: Request) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";

  const where: Record<string, unknown> = { role: "SUPPORT", deletedAt: null };

  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
    ];
  }

  const subAdmins = await prisma.user.findMany({
    where: where as any,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      allowedTabs: true,
      twoFactorEnabled: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ subAdmins });
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAdminActivity(req, {
      action: "sub-admin.create",
      roles: ["MASTER_ADMIN", "ADMIN"],
      entity: "User",
    });
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = CreateBody.safeParse(await req.json());
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { name, email, phone, password, allowedTabs } = parsed.data;

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: email.toLowerCase() }, { phone }], deletedAt: null },
  });
  if (existing) {
    return NextResponse.json(
      { error: "A user with this email or phone already exists" },
      { status: 409 },
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const subAdmin = await prisma.user.create({
    data: {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      passwordHash,
      role: "SUPPORT",
      status: "ACTIVE",
      parentId: user.id,
      allowedTabs: allowedTabs ?? [],
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      allowedTabs: true,
      twoFactorEnabled: true,
      createdAt: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "sub-admin.created",
      entity: "User",
      entityId: subAdmin.id,
      meta: { name, email, phone, allowedTabs: allowedTabs ?? [] },
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true, subAdmin }, { status: 201 });
}
