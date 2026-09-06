import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { requireRole, AuthError } from "@/lib/auth-server";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { getSetting, setSetting } from "@/lib/settings";
import { runT1SettlementSweep, runT1SettlementForUser } from "@/lib/settlement/t1";
import { istDateKey } from "@/lib/settlement/autosweep";
import { dec, toNumber } from "@/lib/money";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET — settlement operations console: T+1 engine state, today's cycle
 * summary, recent runs, and open alerts.
 */
export async function GET(req: Request) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT", "FINANCE");

    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = 25;
    const dayKey = istDateKey(new Date());

    const [t1, todayByStatus, aepsPending, runs, runTotal, alerts] = await Promise.all([
      getSetting("settlement.t1"),
      prisma.settlementRun.groupBy({
        by: ["status"],
        where: { dayKey },
        _count: true,
        _sum: { amount: true },
      }),
      prisma.user.aggregate({
        where: { deletedAt: null, status: "ACTIVE", aepsBalance: { gt: 0 } },
        _sum: { aepsBalance: true },
        _count: true,
      }),
      prisma.settlementRun.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.settlementRun.count(),
      prisma.settlementAlert.findMany({
        where: { readAt: null },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

    // Resolve user labels for the visible runs/alerts in one query.
    const userIds = Array.from(
      new Set([
        ...runs.map((r) => r.userId),
        ...alerts.map((a) => a.userId).filter((v): v is string => Boolean(v)),
      ])
    );
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true, role: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const statusOf = (s: string) => todayByStatus.find((b) => b.status === s);

    return NextResponse.json({
      config: t1,
      today: {
        dayKey,
        settledCount: statusOf("SUCCESS")?._count ?? 0,
        settledAmount: toNumber(dec(statusOf("SUCCESS")?._sum.amount ?? 0)),
        skippedCount: statusOf("SKIPPED")?._count ?? 0,
        failedCount: statusOf("FAILED")?._count ?? 0,
        pendingUsers: aepsPending._count,
        pendingAmount: toNumber(dec(aepsPending._sum.aepsBalance ?? 0)),
      },
      runs: runs.map((r) => ({
        id: r.id,
        dayKey: r.dayKey,
        trigger: r.trigger,
        status: r.status,
        amount: toNumber(dec(r.amount)),
        detail: r.detail,
        createdAt: r.createdAt.toISOString(),
        user: userMap.get(r.userId) ?? { id: r.userId, name: "—", email: "", role: "" },
      })),
      runTotal,
      page,
      pageSize,
      alerts: alerts.map((a) => ({
        id: a.id,
        severity: a.severity,
        title: a.title,
        detail: a.detail,
        createdAt: a.createdAt.toISOString(),
        user: a.userId ? userMap.get(a.userId) ?? null : null,
      })),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/settlement-ops] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const ActionBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("run_sweep") }),
  z.object({ action: z.literal("run_user"), userId: z.string().min(1) }),
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({
    action: z.literal("configure"),
    enabled: z.boolean(),
    hour: z.number().int().min(0).max(23),
    minAmount: z.number().nonnegative(),
  }),
  z.object({ action: z.literal("ack_alert"), alertId: z.string().min(1) }),
]);

/** POST — settlement actions (run now, pause/resume, configure, ack alert). */
export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireAdminActivity(req, {
      action: "settlement.ops",
      roles: ["MASTER_ADMIN", "ADMIN"],
      entity: "Settlement",
    });
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = ActionBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;

  const audit = (action: string, meta: Record<string, unknown>) =>
    prisma.auditLog.create({
      data: {
        userId: admin.id,
        action,
        entity: "Settlement",
        meta: meta as Prisma.InputJsonValue,
        ip: clientIp(req),
      },
    });

  try {
    switch (body.action) {
      case "run_sweep": {
        const r = await runT1SettlementSweep();
        await audit("settlement.sweep_manual", r as unknown as Record<string, unknown>);
        return NextResponse.json({ ok: true, result: r });
      }
      case "run_user": {
        const r = await runT1SettlementForUser(body.userId, admin.id);
        await audit("settlement.run_user", { ...r, userId: body.userId });
        return NextResponse.json({ ok: true, result: r });
      }
      case "pause":
      case "resume": {
        const t1 = await getSetting("settlement.t1");
        await setSetting("settlement.t1", { ...t1, paused: body.action === "pause" }, admin.id);
        await audit(`settlement.${body.action}d`, {});
        return NextResponse.json({ ok: true });
      }
      case "configure": {
        const t1 = await getSetting("settlement.t1");
        await setSetting(
          "settlement.t1",
          { ...t1, enabled: body.enabled, hour: body.hour, minAmount: body.minAmount },
          admin.id
        );
        await audit("settlement.configured", {
          enabled: body.enabled,
          hour: body.hour,
          minAmount: body.minAmount,
        });
        return NextResponse.json({ ok: true });
      }
      case "ack_alert": {
        await prisma.settlementAlert.update({
          where: { id: body.alertId },
          data: { readAt: new Date() },
        });
        return NextResponse.json({ ok: true });
      }
    }
  } catch (e) {
    console.error("[admin/settlement-ops] POST error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
