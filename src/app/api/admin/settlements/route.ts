import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { formatISTDate } from "@/lib/utils";

export const fetchCache = "force-no-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT");

    const now = new Date();
    const days: { id: string; cycle: string; date: string; dateObj: Date }[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      days.push({
        id: `STL-${d.toISOString().slice(0, 10)}`,
        cycle: "T+1",
        date: formatISTDate(d),
        dateObj: d,
      });
    }

    const settlements = await Promise.all(
      days.map(async (day, idx) => {
        const dayStart = new Date(day.dateObj);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(day.dateObj);
        dayEnd.setHours(23, 59, 59, 999);

        const agg = await prisma.transaction.aggregate({
          where: {
            status: "SUCCESS",
            createdAt: { gte: dayStart, lte: dayEnd },
          },
          _sum: { amount: true },
          _count: true,
        });

        const amount = Number(agg._sum.amount ?? 0);
        const txnCount = agg._count;

        let status: "Settled" | "In Bank" | "Reconciling";
        if (idx > 1) status = "Settled";
        else if (idx === 1) status = "In Bank";
        else status = "Reconciling";

        return {
          id: day.id,
          cycle: day.cycle,
          counterparty: "ICICI Nodal",
          amount,
          txnCount,
          status,
          date: day.date,
        };
      })
    );

    return NextResponse.json({ settlements });
  } catch (e: any) {
    if (e?.name === "AuthError") return NextResponse.json({ error: e.message }, { status: 401 });
    console.error("[admin/settlements] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
