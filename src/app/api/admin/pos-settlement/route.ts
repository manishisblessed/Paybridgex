import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { getSetting, setSetting } from "@/lib/settings";
import { runPosT1SettlementSweep, runPosInstantSettlementSweep } from "@/lib/settlement/pos";
import { runPosMirrorSettleSweep } from "@/lib/settlement/pos-mirror-settle";
import { clientIp } from "@/lib/security/audit";
import type { Prisma } from "@prisma/client";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/pos-settlement
 *
 * Dashboard overview of POS settlement entries — counts by status,
 * recent entries, and configuration.
 */
export async function GET(req: Request) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "FINANCE");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const status = url.searchParams.get("status");
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 25));

  const where: Record<string, unknown> = {};
  if (userId) where.userId = userId;
  if (status) where.status = status;

  const [total, entries, config, t1Config, ingestConfig, instantButton, counts] = await Promise.all([
    prisma.posSettlementEntry.count({ where }),
    prisma.posSettlementEntry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
    }),
    getSetting("settlement.pos_instant"),
    getSetting("settlement.pos_t1"),
    getSetting("settlement.pos_ingest"),
    getSetting("settlement.instant_button"),
    prisma.posSettlementEntry.groupBy({
      by: ["status"],
      _count: true,
      _sum: { netAmount: true },
    }),
  ]);

  return NextResponse.json({
    config: { posInstant: config, posT1: t1Config, posIngest: ingestConfig, instantButton },
    summary: counts.map((c) => ({
      status: c.status,
      count: c._count,
      totalNet: toNumber(c._sum.netAmount ?? 0),
    })),
    entries: entries.map((e) => ({
      id: e.id,
      transactionRef: e.transactionRef,
      user: { id: e.user.id, name: e.user.name, role: e.user.role },
      grossAmount: toNumber(e.grossAmount),
      mdrAmount: toNumber(e.mdrAmount),
      netAmount: toNumber(e.netAmount),
      mode: e.mode,
      status: e.status,
      paymentMode: e.paymentMode,
      settledAt: e.settledAt?.toISOString() ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  });
}

const ActionBody = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("run_t1_sweep"),
  }),
  z.object({
    action: z.literal("run_instant_sweep"),
  }),
  z.object({
    action: z.literal("run_ingest"),
    // Optional explicit window (ISO). Omit to use the configured lookback.
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
  }),
  z.object({
    action: z.literal("configure"),
    key: z.enum([
      "settlement.pos_instant",
      "settlement.pos_t1",
      "settlement.pos_ingest",
      "settlement.instant_button",
    ]),
    value: z.record(z.unknown()),
  }),
]);

export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const parsed = ActionBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { action } = parsed.data;

  if (action === "run_t1_sweep") {
    const result = await runPosT1SettlementSweep();
    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "pos.settlement.manual_sweep",
        entity: "PosSettlementEntry",
        meta: result as unknown as Prisma.InputJsonValue,
        ip: clientIp(req),
      },
    });
    return NextResponse.json({ ok: true, ...result });
  }

  if (action === "run_instant_sweep") {
    const result = await runPosInstantSettlementSweep();
    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "pos.settlement.manual_instant_sweep",
        entity: "PosSettlementEntry",
        meta: result as unknown as Prisma.InputJsonValue,
        ip: clientIp(req),
      },
    });
    return NextResponse.json({ ok: true, ...result });
  }

  if (action === "run_ingest") {
    // Mirror-driven: create settlement entries from CAPTURED mirror rows for
    // assigned + schemed terminals. Used for backfills and on-demand runs.
    const result = await runPosMirrorSettleSweep({
      dateFrom: parsed.data.dateFrom,
      dateTo: parsed.data.dateTo,
    });
    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "pos.settlement.manual_ingest",
        entity: "PosSettlementEntry",
        meta: result as unknown as Prisma.InputJsonValue,
        ip: clientIp(req),
      },
    });
    return NextResponse.json({ ok: true, ...result });
  }

  if (action === "configure") {
    const { key, value } = parsed.data;
    const stored = await setSetting(
      key as
        | "settlement.pos_instant"
        | "settlement.pos_t1"
        | "settlement.pos_ingest"
        | "settlement.instant_button",
      value,
      admin.id
    );
    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "pos.settlement.config",
        entity: "PlatformSetting",
        meta: { key, value: stored } as unknown as Prisma.InputJsonValue,
        ip: clientIp(req),
      },
    });
    return NextResponse.json({ ok: true, key, value: stored });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
