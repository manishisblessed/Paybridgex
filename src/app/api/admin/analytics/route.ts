import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { dec, toNumber } from "@/lib/money";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET — business analytics (read-only aggregation over Transaction).
 *
 * Query params:
 *   from, to  — ISO dates (default: trailing 30 days)
 *   format    — "csv" exports the service-wise report
 */
export async function GET(req: Request) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT", "FINANCE");

    const url = new URL(req.url);
    const to = url.searchParams.get("to")
      ? new Date(`${url.searchParams.get("to")}T23:59:59.999Z`)
      : new Date();
    const from = url.searchParams.get("from")
      ? new Date(`${url.searchParams.get("from")}T00:00:00.000Z`)
      : new Date(to.getTime() - 30 * 24 * 3_600_000);

    const range = { createdAt: { gte: from, lte: to } };

    const [byService, byStatus, daily, topUsersRaw] = await Promise.all([
      prisma.transaction.groupBy({
        by: ["service", "status"],
        where: range,
        _count: true,
        _sum: { amount: true, fee: true, commission: true, gst: true },
      }),
      prisma.transaction.groupBy({
        by: ["status"],
        where: range,
        _count: true,
        _sum: { amount: true },
      }),
      // Daily success volume — raw SQL for the date bucket (IST day).
      prisma.$queryRaw<Array<{ day: string; count: bigint; volume: number }>>`
        SELECT to_char("createdAt" + interval '330 minutes', 'YYYY-MM-DD') AS day,
               COUNT(*)::bigint AS count,
               COALESCE(SUM(amount), 0)::float AS volume
        FROM "Transaction"
        WHERE "createdAt" >= ${from} AND "createdAt" <= ${to} AND status = 'SUCCESS'
        GROUP BY 1
        ORDER BY 1
      `,
      prisma.transaction.groupBy({
        by: ["userId"],
        where: { ...range, status: "SUCCESS" },
        _count: true,
        _sum: { amount: true, commission: true },
        orderBy: { _sum: { amount: "desc" } },
        take: 10,
      }),
    ]);

    // Fold per-(service,status) rows into a service report.
    const serviceMap = new Map<
      string,
      { total: number; success: number; failed: number; volume: number; fees: number; commission: number; gst: number }
    >();
    for (const row of byService) {
      const s = serviceMap.get(row.service) ?? {
        total: 0,
        success: 0,
        failed: 0,
        volume: 0,
        fees: 0,
        commission: 0,
        gst: 0,
      };
      s.total += row._count;
      if (row.status === "SUCCESS") {
        s.success += row._count;
        s.volume += toNumber(dec(row._sum.amount ?? 0));
        s.fees += toNumber(dec(row._sum.fee ?? 0));
        s.commission += toNumber(dec(row._sum.commission ?? 0));
        s.gst += toNumber(dec(row._sum.gst ?? 0));
      } else if (row.status === "FAILED") {
        s.failed += row._count;
      }
      serviceMap.set(row.service, s);
    }
    const services = Array.from(serviceMap.entries())
      .map(([service, v]) => ({
        service,
        ...v,
        successRate: v.total > 0 ? Math.round((v.success / v.total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.volume - a.volume);

    // CSV / ZIP export of the service report.
    const exportFormat = url.searchParams.get("format");
    if (exportFormat === "csv" || exportFormat === "zip") {
      const header = "service,total_txns,success,failed,success_rate_pct,volume,fees,commission,gst";
      const lines = services.map(
        (s) => `${s.service},${s.total},${s.success},${s.failed},${s.successRate},${s.volume},${s.fees},${s.commission},${s.gst}`
      );
      const csvContent = [header, ...lines].join("\n");
      const dateRange = `${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}`;

      if (exportFormat === "zip") {
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        zip.file(`service-report-${dateRange}.csv`, csvContent);
        const buf = Buffer.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
        return new NextResponse(buf, {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="service-report-${dateRange}.zip"`,
          },
        });
      }

      return new NextResponse(csvContent, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="service-report-${dateRange}.csv"`,
        },
      });
    }

    const topUserIds = topUsersRaw.map((t) => t.userId);
    const topUserRows = topUserIds.length
      ? await prisma.user.findMany({
          where: { id: { in: topUserIds } },
          select: { id: true, name: true, email: true, role: true, shopName: true },
        })
      : [];
    const userMap = new Map(topUserRows.map((u) => [u.id, u]));

    const statusOf = (s: string) => byStatus.find((b) => b.status === s);
    const totalCount = byStatus.reduce((acc, b) => acc + b._count, 0);

    return NextResponse.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      totals: {
        transactions: totalCount,
        success: statusOf("SUCCESS")?._count ?? 0,
        failed: statusOf("FAILED")?._count ?? 0,
        volume: toNumber(dec(statusOf("SUCCESS")?._sum.amount ?? 0)),
        successRate:
          totalCount > 0
            ? Math.round(((statusOf("SUCCESS")?._count ?? 0) / totalCount) * 1000) / 10
            : 0,
      },
      daily: daily.map((d) => ({ day: d.day, count: Number(d.count), volume: d.volume })),
      services,
      topUsers: topUsersRaw.map((t) => ({
        user: userMap.get(t.userId) ?? { id: t.userId, name: "—", email: "", role: "", shopName: null },
        txns: t._count,
        volume: toNumber(dec(t._sum.amount ?? 0)),
        commission: toNumber(dec(t._sum.commission ?? 0)),
      })),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/analytics] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
