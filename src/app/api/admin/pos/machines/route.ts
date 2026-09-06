import { NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { requireRole, AuthError } from "@/lib/auth-server";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { isAdminRole } from "@/lib/security/ownership";
import { prisma } from "@/lib/db";
import { flags } from "@/lib/env";
import { clientIp } from "@/lib/security/audit";
import {
  posMachineSelect,
  serializePosMachine,
  syncPosMachines,
} from "@/lib/pos/assignments";
import { getDescendantIds } from "@/lib/security/ownership";
import type { Prisma } from "@prisma/client";

export const fetchCache = "force-no-store";

export const dynamic = "force-dynamic";

/** First-load auto-sync can pull hundreds of terminals from the partner. */
export const maxDuration = 120;

/**
 * GET /api/admin/pos/machines
 *
 * Admin view of the locally-synced POS inventory, including each machine's
 * assignee. Supports status / search / assignee filters and pagination.
 */
export async function GET(req: Request) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT");
    if (!isAdminRole(admin.role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  if (!flags.pos)
    return NextResponse.json(
      { error: "POS service is not enabled" },
      { status: 503 }
    );

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const pageSize = Math.min(100, Math.max(10, Number(searchParams.get("pageSize") ?? 50)));
  const status = searchParams.get("status") ?? "";
  const search = (searchParams.get("search") ?? "").trim();
  // assignee: "all" | "assigned" | "unassigned" | "user:<id>" | plain userId
  const rawAssignee = searchParams.get("assignee") ?? "all";
  const includeDownline = searchParams.get("includeDownline") === "true";
  const assignee = rawAssignee.startsWith("user:") ? rawAssignee.slice(5) : rawAssignee;

  const where: Prisma.PosMachineWhereInput = {};

  if (status) where.status = status;

  if (assignee === "assigned") {
    where.assignedUserId = { not: null };
  } else if (assignee === "unassigned") {
    where.assignedUserId = null;
  } else if (assignee && assignee !== "all") {
    if (includeDownline) {
      const descendantIds = await getDescendantIds(assignee);
      where.assignedUserId = { in: [assignee, ...descendantIds] };
    } else {
      where.assignedUserId = assignee;
    }
  }

  if (search) {
    where.OR = [
      { tid: { contains: search, mode: "insensitive" } },
      { mid: { contains: search, mode: "insensitive" } },
      { serial: { contains: search, mode: "insensitive" } },
      { externalId: { contains: search, mode: "insensitive" } },
    ];
  }

  // First visit: local mirror is empty until someone clicks Sync. Pull once
  // automatically so the Machines tab isn't blank while Live Transactions work.
  const existingCount = await prisma.posMachine.count();
  if (existingCount === 0 && flags.pos) {
    try {
      await syncPosMachines();
    } catch (e) {
      return NextResponse.json(
        {
          error: e instanceof Error ? e.message : "Failed to sync POS machines from provider",
          data: [],
          pagination: {
            page: 1,
            pageSize,
            total: 0,
            totalPages: 1,
            hasPrev: false,
            hasNext: false,
          },
          stats: { total: 0, assigned: 0, unassigned: 0 },
        },
        { status: 502 }
      );
    }
  }

  const [rows, total, assigned, totalAll, byAssignee, failedInvoices] = await Promise.all([
    prisma.posMachine.findMany({
      where,
      select: posMachineSelect,
      orderBy: [{ assignedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.posMachine.count({ where }),
    prisma.posMachine.count({ where: { assignedUserId: { not: null } } }),
    prisma.posMachine.count(),
    // Per-user fleet breakdown (direct assignments only).
    prisma.posMachine.groupBy({
      by: ["assignedUserId"],
      where: { assignedUserId: { not: null } },
      _count: { _all: true },
    }),
    // FAILED invoices are outstanding dues: billing retries update the same
    // row to PAID once recovered, so remaining FAILED rows are still owed.
    prisma.posRentalInvoice.findMany({
      where: { status: "FAILED" },
      select: {
        totalAmount: true,
        subscription: { select: { userId: true } },
      },
    }),
  ]);

  const assigneeIds = byAssignee
    .map((g) => g.assignedUserId)
    .filter((id): id is string => Boolean(id));
  const users = assigneeIds.length
    ? await prisma.user.findMany({
        where: { id: { in: assigneeIds } },
        select: { id: true, name: true, email: true, role: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const duesByUser = new Map<string, number>();
  for (const inv of failedInvoices) {
    const uid = inv.subscription.userId;
    duesByUser.set(uid, (duesByUser.get(uid) ?? 0) + Number(inv.totalAmount));
  }

  const byUser = byAssignee
    .map((g) => {
      const u = g.assignedUserId ? userById.get(g.assignedUserId) : null;
      return {
        userId: g.assignedUserId as string,
        name: u?.name ?? "Unknown user",
        email: u?.email ?? null,
        role: u?.role ?? null,
        machineCount: g._count._all,
        outstandingDues: Math.round((duesByUser.get(g.assignedUserId as string) ?? 0) * 100) / 100,
      };
    })
    .sort((a, b) => b.machineCount - a.machineCount);

  return NextResponse.json({
    data: rows.map(serializePosMachine),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      hasPrev: page > 1,
      hasNext: page * pageSize < total,
    },
    stats: {
      total: totalAll,
      assigned,
      unassigned: totalAll - assigned,
    },
    byUser,
  });
}

const MachineInput = z.object({
  serial: z.string().min(3).max(60),
  tid: z.string().max(40).optional(),
  mid: z.string().max(40).optional(),
  model: z.string().max(60).optional(),
  brand: z.string().max(60).optional(),
  company: z.string().max(80).optional(),
  condition: z.enum(["NEW", "REFURBISHED", "DAMAGED"]).default("NEW"),
  status: z.enum(["active", "inactive", "maintenance", "decommissioned"]).default("active"),
  location: z.string().max(120).optional(),
  city: z.string().max(60).optional(),
  state: z.string().max(60).optional(),
  // Brand tenancy that owns this terminal's MDR pricing (optional at intake).
  brandId: z.string().min(1).optional(),
  // Acquiring/service provider used for settlement (RAZORPAY | PAYTM | PINELAB | ...).
  provider: z.string().max(40).optional(),
});

const CreateBody = z.object({ machines: z.array(MachineInput).min(1).max(500) });

/**
 * POST /api/admin/pos/machines
 *
 * Manual inventory intake — one machine or a bulk batch (CSV parsed client
 * side). Duplicate serials are reported per-row rather than failing the batch.
 */
export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireAdminActivity(req, {
      action: "pos.machines_add",
      roles: ["MASTER_ADMIN", "ADMIN"],
      entity: "PosMachine",
    });
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  let created = 0;
  const errors: Array<{ serial: string; error: string }> = [];

  // Validate any referenced brands up-front (one lookup for the whole batch).
  const brandIds = Array.from(
    new Set(parsed.data.machines.map((m) => m.brandId).filter((v): v is string => Boolean(v)))
  );
  const validBrandIds = brandIds.length
    ? new Set(
        (await prisma.brand.findMany({ where: { id: { in: brandIds } }, select: { id: true } })).map(
          (b) => b.id
        )
      )
    : new Set<string>();

  for (const m of parsed.data.machines) {
    const dup = await prisma.posMachine.findFirst({
      where: { serial: { equals: m.serial, mode: "insensitive" } },
      select: { id: true },
    });
    if (dup) {
      errors.push({ serial: m.serial, error: "serial already exists" });
      continue;
    }
    if (m.brandId && !validBrandIds.has(m.brandId)) {
      errors.push({ serial: m.serial, error: "unknown brandId" });
      continue;
    }
    await prisma.posMachine.create({
      data: {
        externalId: `MANUAL-${nanoid(12)}`,
        source: "MANUAL",
        serial: m.serial.trim(),
        tid: m.tid?.trim() || null,
        mid: m.mid?.trim() || null,
        model: m.model?.trim() || null,
        brand: m.brand?.trim() || null,
        company: m.company?.trim() || null,
        condition: m.condition,
        status: m.status,
        location: m.location?.trim() || null,
        city: m.city?.trim() || null,
        state: m.state?.trim() || null,
        provider: m.provider?.trim().toUpperCase() || "MANUAL",
        brandId: m.brandId ?? null,
      },
    });
    created++;
  }

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "pos.machines_added",
      entity: "PosMachine",
      meta: { created, failed: errors.length, batch: parsed.data.machines.length },
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true, created, errors }, { status: 201 });
}
