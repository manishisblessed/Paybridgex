import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { generateNextUserCode } from "@/lib/userCode";
import { uplineInclude, flattenUpline } from "@/lib/hierarchy";
import { buildInviteDataForUser } from "@/lib/onboarding/inviteBackfill";
import { defaultServicesForRole } from "@/lib/settings";

export const fetchCache = "force-no-store";

export const dynamic = "force-dynamic";

const CreateUserBody = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  phone: z.string().min(10).max(15),
  password: z.string().min(6).max(72),
  role: z.enum(["RETAILER", "DISTRIBUTOR", "MASTER_DISTRIBUTOR", "SUPER_DISTRIBUTOR"]),
  shopName: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  parentId: z.string().optional(),
  status: z.enum(["ACTIVE", "PENDING_KYC"]).default("ACTIVE"),
});

export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const parsed = CreateUserBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { name, email, phone, password, role, shopName, city, state, pincode, parentId, status } = parsed.data;

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: email.toLowerCase() }, { phone }], deletedAt: null },
  });
  if (existing) {
    const field = existing.email === email.toLowerCase() ? "email" : "phone";
    return NextResponse.json(
      { error: `A user with this ${field} already exists` },
      { status: 409 }
    );
  }

  if (shopName) {
    const dupShop = await prisma.user.findFirst({
      where: { shopName: shopName.trim() },
      select: { id: true },
    });
    if (dupShop) {
      return NextResponse.json(
        { error: "Another account is already registered with this shop name" },
        { status: 409 }
      );
    }
  }

  if (parentId) {
    const parent = await prisma.user.findUnique({ where: { id: parentId } });
    if (!parent)
      return NextResponse.json({ error: "Parent user not found" }, { status: 404 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const userCode = await generateNextUserCode(role);
  // New network users start with only the tier's configured default services
  // (empty = none). Admins grant the rest per user afterwards.
  const enabledServices = await defaultServicesForRole(role);

  // Create the user AND a linked onboarding invite in one transaction. The
  // Onboarding Invites page reads from the Invite table, so without this a
  // directly-created user would be invisible there (only visible in Network).
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        passwordHash,
        role,
        status,
        userCode,
        shopName: shopName?.trim(),
        city: city?.trim(),
        state: state?.trim(),
        pincode: pincode?.trim(),
        parentId: parentId ?? undefined,
        enabledServices,
      },
      select: {
        id: true,
        userCode: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        shopName: true,
        city: true,
        state: true,
        parentId: true,
        phoneVerifiedAt: true,
        emailVerifiedAt: true,
        createdAt: true,
      },
    });

    // invitedById = the acting admin ("Shared By" on the invites page).
    await tx.invite.create({
      data: buildInviteDataForUser(created, admin.id),
    });

    return created;
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "user.created",
      entity: "User",
      entityId: user.id,
      meta: { role, email, phone, createdBy: admin.email },
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true, user }, { status: 201 });
}

export async function GET(req: Request) {
  try {
    const session = await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT");
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") ?? "";
    const role = searchParams.get("role");
    const status = searchParams.get("status");
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(100, Math.max(10, Number(searchParams.get("pageSize") ?? 50)));

    const where: Record<string, unknown> = {};

    if (role && role !== "all") {
      const roleMap: Record<string, string> = {
        retailer: "RETAILER",
        distributor: "DISTRIBUTOR",
        "master-distributor": "MASTER_DISTRIBUTOR",
        "super-distributor": "SUPER_DISTRIBUTOR",
        admin: "ADMIN",
        "master-admin": "MASTER_ADMIN",
      };
      if (roleMap[role]) where.role = roleMap[role];
    }

    if (status && status !== "all") {
      const statusMap: Record<string, string> = {
        Active: "ACTIVE",
        "Pending KYC": "PENDING_KYC",
        Suspended: "SUSPENDED",
      };
      if (statusMap[status]) where.status = statusMap[status];
    }

    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { shopName: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { id: { contains: q, mode: "insensitive" } },
        { userCode: { contains: q, mode: "insensitive" } },
      ];
    }

    // Exclude ADMIN, SUPPORT, and MASTER_ADMIN from default user list unless explicitly filtered
    where.role = where.role ?? { notIn: ["ADMIN", "SUPPORT", "MASTER_ADMIN"] };

    // Never surface soft-deleted accounts in the operator console (list + count).
    where.deletedAt = null;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: where as any,
        select: {
          id: true,
          userCode: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          status: true,
          shopName: true,
          city: true,
          state: true,
          walletBalance: true,
          createdAt: true,
          _count: { select: { children: true } },
          ...uplineInclude,
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.user.count({ where: where as any }),
    ]);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const monthlyTurnovers = await prisma.transaction.groupBy({
      by: ["userId"],
      where: {
        userId: { in: users.map((u) => u.id) },
        status: "SUCCESS",
        createdAt: { gte: monthStart },
      },
      _sum: { amount: true },
    });

    const turnoverMap = new Map(
      monthlyTurnovers.map((t) => [t.userId, Number(t._sum.amount ?? 0)])
    );

    const displayRole = (r: string) => {
      const map: Record<string, string> = {
        RETAILER: "retailer",
        DISTRIBUTOR: "distributor",
        MASTER_DISTRIBUTOR: "master-distributor",
        SUPER_DISTRIBUTOR: "super-distributor",
        ADMIN: "admin",
        MASTER_ADMIN: "master-admin",
        SUPPORT: "sub-admin",
      };
      return map[r] ?? r.toLowerCase();
    };

    const displayStatus = (s: string) => {
      const map: Record<string, string> = {
        ACTIVE: "Active",
        PENDING_KYC: "Pending KYC",
        SUSPENDED: "Suspended",
        CLOSED: "Closed",
      };
      return map[s] ?? s;
    };

    const mapped = users.map((u) => ({
      id: u.id,
      userCode: u.userCode ?? "—",
      name: u.name,
      shop: u.shopName ?? "—",
      role: displayRole(u.role),
      city: u.city ?? "—",
      state: u.state ?? "—",
      joined: u.createdAt.toLocaleDateString("en-IN", {
        month: "short",
        day: "2-digit",
        year: "numeric",
      }),
      status: displayStatus(u.status),
      walletBalance: Number(u.walletBalance),
      monthlyTurnover: turnoverMap.get(u.id) ?? 0,
      retailers: u._count.children,
      upline: flattenUpline(u).map((n) => ({
        role: n.role,
        name: n.name,
        userCode: n.userCode,
      })),
    }));

    return NextResponse.json({ users: mapped, total, page, pageSize });
  } catch (e: any) {
    if (e?.name === "AuthError") return NextResponse.json({ error: e.message }, { status: 401 });
    console.error("[admin/users] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
