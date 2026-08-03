import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { dec, toNumber } from "@/lib/money";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const TIERS = ["RETAILER", "DISTRIBUTOR", "MASTER_DISTRIBUTOR", "SUPER_DISTRIBUTOR"] as const;

/**
 * GET /api/admin/network — per-tier network manager listing with wallet
 * snapshot, scheme assignment, service count and hierarchy context.
 */
export async function GET(req: Request) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT", "FINANCE");
    const { searchParams } = new URL(req.url);
    const tierParam = searchParams.get("tier") ?? "RETAILER";
    const tier = (TIERS as readonly string[]).includes(tierParam) ? tierParam : "RETAILER";
    const q = searchParams.get("q") ?? "";
    const status = searchParams.get("status");
    const rekyc = searchParams.get("rekyc");
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(100, Math.max(10, Number(searchParams.get("pageSize") ?? 25)));

    const where: Record<string, unknown> = { role: tier, deletedAt: null };
    if (status && status !== "all") where.status = status;
    // Monthly re-KYC filter: exempt users, or users with an open requirement.
    if (rekyc === "exempt") where.reKycExempt = true;
    else if (rekyc === "due") {
      where.reKycRequired = true;
      where.reKycExempt = false;
    }
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { shopName: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { city: { contains: q, mode: "insensitive" } },
      ];
    }

    const [users, total, tierCounts] = await Promise.all([
      prisma.user.findMany({
        where: where as never,
        select: {
          id: true,
          userCode: true,
          name: true,
          email: true,
          phone: true,
          shopName: true,
          city: true,
          state: true,
          status: true,
          walletBalance: true,
          aepsBalance: true,
          heldBalance: true,
          enabledServices: true,
          createdAt: true,
          reKycRequired: true,
          reKycExempt: true,
          scheme: { select: { id: true, name: true } },
          parent: { select: { id: true, name: true, role: true, userCode: true } },
          userLimit: {
            select: { settlementTier: true, settlementDailyCap: true, walletCap: true },
          },
          settlementConfig: { select: { autoSettleEnabled: true, pausedUntil: true } },
          _count: { select: { children: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.user.count({ where: where as never }),
      prisma.user.groupBy({
        by: ["role"],
        where: { role: { in: [...TIERS] }, deletedAt: null },
        _count: true,
      }),
    ]);

    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id,
        userCode: u.userCode,
        name: u.name,
        email: u.email,
        phone: u.phone,
        shopName: u.shopName,
        city: u.city,
        state: u.state,
        status: u.status,
        primary: toNumber(dec(u.walletBalance)),
        aeps: toNumber(dec(u.aepsBalance)),
        held: toNumber(dec(u.heldBalance)),
        servicesEnabled: u.enabledServices.length,
        reKycRequired: u.reKycRequired,
        reKycExempt: u.reKycExempt,
        scheme: u.scheme,
        parent: u.parent,
        settlementTier: u.userLimit?.settlementTier ?? null,
        walletCap: u.userLimit?.walletCap != null ? toNumber(dec(u.userLimit.walletCap)) : null,
        autoSettle: u.settlementConfig?.autoSettleEnabled ?? true,
        settlementPaused:
          !!u.settlementConfig?.pausedUntil && u.settlementConfig.pausedUntil > new Date(),
        children: u._count.children,
        joined: u.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
      tierCounts: Object.fromEntries(
        TIERS.map((t) => [t, tierCounts.find((c) => c.role === t)?._count ?? 0])
      ),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/network] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
