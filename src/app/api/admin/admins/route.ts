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
  allowedTabs: z.array(z.string()).default([]),
  // FINANCE = read-only staff for money tabs (dashboard, ledger, reports).
  role: z.enum(["ADMIN", "FINANCE"]).default("ADMIN"),
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

  const where: Record<string, unknown> = { role: { in: ["ADMIN", "FINANCE"] }, deletedAt: null };

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
      role: true,
      status: true,
      allowedTabs: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ admins });
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAdminActivity(req, {
      action: "admin.create",
      roles: ["MASTER_ADMIN"],
      entity: "User",
    });
  } catch (e) {
    return toErrorResponse(e);
  }

  // Parse the JSON body defensively — a missing/invalid body must return a clean
  // 400, never an unhandled throw (which would produce an empty 500 body and the
  // client's confusing "Unexpected end of JSON input").
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid or empty request body" }, { status: 400 });
  }

  const parsed = CreateBody.safeParse(rawBody);
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { name, email, phone, password, allowedTabs, role } = parsed.data;
  const normEmail = email.trim().toLowerCase();
  const normPhone = phone.trim();

  // Uniqueness pre-check that INCLUDES soft-deleted users. The DB enforces a hard
  // unique constraint on email/phone regardless of `deletedAt`, so a soft-deleted
  // account still "owns" its email/phone. Without this branch, creating an admin
  // whose email/phone matches a deleted user throws a P2002 → empty 500 →
  // "Unexpected end of JSON input" in the UI. Give a clear, actionable message.
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
        role,
        status: "ACTIVE",
        allowedTabs,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        allowedTabs: true,
        createdAt: true,
      },
    });
  } catch (e) {
    // P2002 = unique constraint violation. This can still happen on a race
    // (two creates in flight) or a soft-deleted collision that slipped past the
    // pre-check. Return a clean 409 instead of letting it bubble to an empty 500.
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
      action: role === "FINANCE" ? "finance_user.created" : "admin.created",
      entity: "User",
      entityId: admin.id,
      meta: { name, email: normEmail, phone: normPhone, allowedTabs, role },
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true, admin }, { status: 201 });
}
