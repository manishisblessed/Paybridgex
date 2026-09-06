import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-server";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

/**
 * AML alert queue (Phase 5).
 *   GET   — list alerts (?status=open|review|cleared|reported|all, ?rule=)
 *   PATCH — review action: UNDER_REVIEW / CLEARED / REPORTED (+ note)
 *
 * Review is compliance-only: MASTER_ADMIN and ADMIN. SUPPORT may view.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const STATUS_FILTER: Record<string, string[] | undefined> = {
  open: ["OPEN", "UNDER_REVIEW"],
  review: ["UNDER_REVIEW"],
  cleared: ["CLEARED"],
  reported: ["REPORTED"],
  all: undefined,
};

const PatchBody = z.object({
  id: z.string().min(1),
  action: z.enum(["UNDER_REVIEW", "CLEARED", "REPORTED"]),
  note: z.string().trim().max(1000).optional(),
}).strict();

export async function GET(req: Request) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT");
  } catch (e) {
    return toErrorResponse(e);
  }

  const url = new URL(req.url);
  const statusKey = url.searchParams.get("status") ?? "open";
  const rule = url.searchParams.get("rule");
  const statuses = STATUS_FILTER[statusKey] ?? STATUS_FILTER.open;

  const where: Prisma.AmlAlertWhereInput = {};
  if (statuses) where.status = { in: statuses };
  if (rule) where.rule = rule;

  const alerts = await prisma.amlAlert.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      user: { select: { id: true, name: true, email: true, phone: true, role: true } },
      reviewedBy: { select: { name: true } },
    },
  });

  return NextResponse.json({
    alerts: alerts.map((a) => ({
      id: a.id,
      rule: a.rule,
      severity: a.severity,
      status: a.status,
      dateKey: a.dateKey,
      details: a.details,
      user: a.user,
      reviewNote: a.reviewNote,
      reviewedByName: a.reviewedBy?.name ?? null,
      reviewedAt: a.reviewedAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
    })),
  });
}

export async function PATCH(req: Request) {
  let admin;
  try {
    admin = await requireAdminActivity(req, {
      action: "aml.alert_review",
      roles: ["MASTER_ADMIN", "ADMIN"],
      entity: "AmlAlert",
    });
    await enforceRateLimit(`aml:review:${admin.id}`, RATE_LIMITS.sensitiveWrite);
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = PatchBody.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { id, action, note } = parsed.data;

  const alert = await prisma.amlAlert.findUnique({ where: { id } });
  if (!alert) return NextResponse.json({ error: "Alert not found" }, { status: 404 });

  // Terminal review states require a note (the STR/CTR paper trail).
  if ((action === "CLEARED" || action === "REPORTED") && !note?.trim()) {
    return NextResponse.json({ error: "A review note is required to clear or report an alert" }, { status: 400 });
  }

  const updated = await prisma.amlAlert.update({
    where: { id },
    data: {
      status: action,
      reviewNote: note?.trim() || alert.reviewNote,
      reviewedById: admin.id,
      reviewedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: `aml.alert_${action.toLowerCase()}`,
      entity: "AmlAlert",
      entityId: id,
      meta: { rule: alert.rule, subjectUserId: alert.userId, dateKey: alert.dateKey, note: note ?? null },
    },
  });

  return NextResponse.json({ alert: { id: updated.id, status: updated.status } });
}
