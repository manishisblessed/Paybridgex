import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { formatISTDate } from "@/lib/utils";

export const fetchCache = "force-no-store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await requireAuth();

    // Admins and distributor tiers can list accounts directly under them.
    // The where clause below is always scoped to parentId = caller, so a
    // distributor can only ever see their own network.
    const allowed = [
      "MASTER_ADMIN",
      "ADMIN",
      "SUPER_DISTRIBUTOR",
      "MASTER_DISTRIBUTOR",
      "DISTRIBUTOR",
    ];
    if (!allowed.includes(user.role)) {
      return NextResponse.json(
        { error: "You cannot view network data" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") ?? "";
    const status = searchParams.get("status");
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(100, Math.max(10, Number(searchParams.get("pageSize") ?? 50)));

    const where: Record<string, unknown> = {
      parentId: user.id,
    };

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
        { shopName: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { id: { contains: q, mode: "insensitive" } },
      ];
    }

    const [total, children] = await Promise.all([
      prisma.user.count({ where: where as any }),
      prisma.user.findMany({
        where: where as any,
        select: {
          id: true,
          userCode: true,
          name: true,
          role: true,
          status: true,
          shopName: true,
          city: true,
          state: true,
          walletBalance: true,
          createdAt: true,
          schemeId: true,
          scheme: { select: { id: true, name: true } },
          _count: { select: { children: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const turnovers = await prisma.transaction.groupBy({
      by: ["userId"],
      where: {
        userId: { in: children.map((c) => c.id) },
        status: "SUCCESS",
        createdAt: { gte: monthStart },
      },
      _sum: { amount: true },
    });

    const turnoverMap = new Map(
      turnovers.map((t) => [t.userId, Number(t._sum.amount ?? 0)])
    );

    const displayRole = (r: string) => {
      const map: Record<string, string> = {
        RETAILER: "retailer",
        DISTRIBUTOR: "distributor",
        MASTER_DISTRIBUTOR: "master-distributor",
        SUPER_DISTRIBUTOR: "super-distributor",
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

    const mapped = children.map((u) => ({
      id: u.id,
      userCode: u.userCode,
      name: u.name,
      shop: u.shopName ?? "—",
      role: displayRole(u.role),
      city: u.city ?? "—",
      state: u.state ?? "—",
      joined: formatISTDate(u.createdAt),
      status: displayStatus(u.status),
      walletBalance: Number(u.walletBalance),
      monthlyTurnover: turnoverMap.get(u.id) ?? 0,
      retailers: u._count.children,
      schemeId: u.schemeId,
      schemeName: u.scheme?.name ?? null,
    }));

    return NextResponse.json({ users: mapped, total, page, pageSize });
  } catch (e: any) {
    if (e?.name === "AuthError") return NextResponse.json({ error: e.message }, { status: 401 });
    console.error("[network] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
