import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { getPartner, partnerStatus } from "@/lib/partners";
import { flags } from "@/lib/env";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { add, dec, toNumber } from "@/lib/money";

export const fetchCache = "force-no-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT");

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    // Rolling 30-day window used for the payout success-rate KPI.
    const last30Start = new Date(now);
    last30Start.setDate(last30Start.getDate() - 30);
    last30Start.setHours(0, 0, 0, 0);

    const [
      userCounts,
      pendingKyc,
      todayTxns,
      monthlyGmv,
      recentAudit,
      partners,
      serviceRoutes,
      payoutToday,
      payoutMonth,
      payoutStatusCounts,
      payoutInflight,
    ] = await Promise.all([
      prisma.user.groupBy({
        by: ["status"],
        _count: true,
        where: { role: { notIn: ["ADMIN", "SUPPORT"] } },
      }),
      prisma.kyc.count({ where: { status: "PENDING_REVIEW" } }),
      prisma.transaction.aggregate({
        where: { status: "SUCCESS", createdAt: { gte: todayStart } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.transaction.aggregate({
        where: { status: "SUCCESS", createdAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      prisma.auditLog.findMany({
        include: { user: { select: { email: true } } },
        orderBy: { createdAt: "desc" },
        take: 6,
      }),
      Promise.resolve(partnerStatus()),
      prisma.serviceRoute.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      prisma.payoutRequest.aggregate({
        where: { status: "SUCCESS", completedAt: { gte: todayStart } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.payoutRequest.aggregate({
        where: { status: "SUCCESS", completedAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      // Terminal payout outcomes over the last 30 days (for success-rate KPI).
      prisma.payoutRequest.groupBy({
        by: ["status"],
        where: {
          status: { in: ["SUCCESS", "FAILED", "REJECTED", "REVERSED"] },
          createdAt: { gte: last30Start },
        },
        _count: true,
      }),
      // In-flight payouts awaiting a terminal state.
      prisma.payoutRequest.count({
        where: { status: { in: ["PENDING_APPROVAL", "APPROVED", "PROCESSING"] } },
      }),
    ]);

    // The payout rail balance refresh is intentionally NOT awaited here — it
    // can take several seconds and was blocking the admin home. Cached route
    // balance is shown immediately; a background refresh updates next load.
    const payoutRoute = serviceRoutes.find((r) => r.key === SERVICE_KEYS.PAYOUT);
    if (payoutRoute && flags.payout) {
      void (async () => {
        try {
          const provider = getPartner("payout");
          if (typeof provider.fetchBalance === "function") {
            const bal = await provider.fetchBalance();
            if (bal.ok) {
              await prisma.serviceRoute.update({
                where: { id: payoutRoute.id },
                data: { balance: dec(bal.data) },
              });
            }
          }
        } catch (err) {
          console.warn("[admin/stats] payout rail fetchBalance failed (non-fatal):", err);
        }
      })();
    }

    const activeUsers =
      userCounts.find((c) => c.status === "ACTIVE")?._count ?? 0;
    const totalUsers = userCounts.reduce((sum, c) => sum + c._count, 0);

    // Daily GMV + payout sparklines: one query each for 14 days (not 28 loops).
    const sparkStart = new Date(now);
    sparkStart.setDate(sparkStart.getDate() - 13);
    sparkStart.setHours(0, 0, 0, 0);

    const [gmvRows, payoutRows] = await Promise.all([
      prisma.$queryRaw<Array<{ day: Date; total: unknown }>>`
        SELECT date_trunc('day', "createdAt") AS day, COALESCE(SUM(amount), 0) AS total
        FROM "Transaction"
        WHERE status = 'SUCCESS' AND "createdAt" >= ${sparkStart}
        GROUP BY 1
        ORDER BY 1
      `,
      prisma.$queryRaw<Array<{ day: Date; total: unknown }>>`
        SELECT date_trunc('day', "completedAt") AS day, COALESCE(SUM(amount), 0) AS total
        FROM "PayoutRequest"
        WHERE status = 'SUCCESS' AND "completedAt" >= ${sparkStart}
        GROUP BY 1
        ORDER BY 1
      `,
    ]);

    const gmvMap = new Map(
      gmvRows.map((r) => [
        new Date(r.day).toISOString().slice(0, 10),
        Number(r.total ?? 0),
      ])
    );
    const payoutMap = new Map(
      payoutRows.map((r) => [
        new Date(r.day).toISOString().slice(0, 10),
        Number(r.total ?? 0),
      ])
    );

    const dailyGmv: number[] = [];
    const dailyPayout: number[] = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date(now);
      day.setDate(day.getDate() - i);
      day.setHours(0, 0, 0, 0);
      const key = day.toISOString().slice(0, 10);
      dailyGmv.push(gmvMap.get(key) ?? 0);
      dailyPayout.push(payoutMap.get(key) ?? 0);
    }

    // ---- Service Overview + Vendor Balances (from ServiceRoute registry) ----
    const services = serviceRoutes.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      type: r.type,
      kind: r.kind,
      provider: r.provider,
      enabled: r.enabled,
      balance: r.balance == null ? null : toNumber(dec(r.balance)),
    }));

    // Vendor balances = SERVICE rails that carry a tracked vendor wallet balance.
    const vendorBalances = services
      .filter((s) => s.type === "SERVICE" && s.balance != null)
      .map((s) => ({
        id: s.id,
        key: s.key,
        name: s.name,
        kind: s.kind,
        provider: s.provider,
        enabled: s.enabled,
        balance: s.balance as number,
      }));
    const vendorBalanceTotal = toNumber(
      vendorBalances.reduce((acc, v) => add(acc, v.balance), dec(0))
    );

    // ---- Payout KPIs ----
    const payoutCountByStatus = payoutStatusCounts.reduce<Record<string, number>>(
      (acc, row) => {
        acc[row.status] = row._count;
        return acc;
      },
      {}
    );
    const payoutSuccess30 = payoutCountByStatus.SUCCESS ?? 0;
    const payoutTerminal30 =
      (payoutCountByStatus.SUCCESS ?? 0) +
      (payoutCountByStatus.FAILED ?? 0) +
      (payoutCountByStatus.REJECTED ?? 0) +
      (payoutCountByStatus.REVERSED ?? 0);
    const payoutSuccessRate =
      payoutTerminal30 === 0
        ? null
        : Math.round((payoutSuccess30 / payoutTerminal30) * 1000) / 10;

    // Service health from partner status
    const serviceHealth = Object.entries(partners).map(([key, val]) => ({
      service: key.toUpperCase(),
      live: val.live,
      provider: val.provider,
    }));

    const severityMap = (action: string) => {
      if (["user.suspend", "user.close", "kyc.reject"].includes(action)) return "danger";
      if (["commission.update", "commission.deactivate", "fund_request.reject"].includes(action)) return "warn";
      return "info";
    };

    const auditEvents = recentAudit.map((l) => ({
      id: l.id,
      actor: l.user?.email ?? "system",
      action: l.action,
      target: [l.entity, l.entityId].filter(Boolean).join(" · ") || "—",
      severity: severityMap(l.action),
      ts: l.createdAt.toLocaleString("en-IN", {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }),
    }));

    return NextResponse.json({
      activeUsers,
      totalUsers,
      pendingKyc,
      settledToday: Number(todayTxns._sum.amount ?? 0),
      txnsToday: todayTxns._count,
      monthlyGmv: Number(monthlyGmv._sum.amount ?? 0),
      dailyGmv,
      serviceHealth,
      auditEvents,
      // --- additive: Service Overview + Vendor Balances ---
      services,
      vendorBalances,
      vendorBalanceTotal,
      // --- additive: Payout KPIs ---
      payout: {
        volumeToday: toNumber(dec(payoutToday._sum.amount ?? 0)),
        countToday: payoutToday._count,
        volumeMonth: toNumber(dec(payoutMonth._sum.amount ?? 0)),
        successRate: payoutSuccessRate,
        successCount30: payoutSuccess30,
        terminalCount30: payoutTerminal30,
        inflight: payoutInflight,
        daily: dailyPayout,
      },
    });
  } catch (e: any) {
    if (e?.name === "AuthError") return NextResponse.json({ error: e.message }, { status: 401 });
    console.error("[admin/stats] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
