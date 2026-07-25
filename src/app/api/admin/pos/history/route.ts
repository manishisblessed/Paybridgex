import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import type { Prisma } from "@prisma/client";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const PAGE_SIZE_MAX = 100;
const CSV_ROW_CAP = 5000;

/**
 * GET /api/admin/pos/history
 *
 * POS tracking history report: every assignment / return movement across the
 * fleet, with dispatch milestones (transit / delivered) and return reasons.
 * Filters: q (TID/serial/MID), action, status, userId, from, to.
 * `format=csv` streams the filtered report (capped at 5,000 rows).
 */
export async function GET(req: Request) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT", "FINANCE");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const action = url.searchParams.get("action") || "";
  const status = url.searchParams.get("status") || "";
  const userId = url.searchParams.get("userId") || "";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const format = url.searchParams.get("format");
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number(url.searchParams.get("pageSize")) || 25)
  );

  const where: Prisma.PosAssignmentLogWhereInput = {};
  if (action) where.action = action;
  if (status) where.status = status;
  if (userId) where.OR = [{ toUserId: userId }, { fromUserId: userId }];
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(`${from}T00:00:00.000+05:30`);
    if (to) where.createdAt.lte = new Date(`${to}T23:59:59.999+05:30`);
  }
  if (q) {
    where.machine = {
      OR: [
        { tid: { contains: q, mode: "insensitive" } },
        { serial: { contains: q, mode: "insensitive" } },
        { mid: { contains: q, mode: "insensitive" } },
        { externalId: { contains: q, mode: "insensitive" } },
      ],
    };
  }

  const [total, rows, assignments, returns, reassignments, active] = await Promise.all([
    prisma.posAssignmentLog.count({ where }),
    prisma.posAssignmentLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: format === "csv" ? 0 : (page - 1) * pageSize,
      take: format === "csv" ? CSV_ROW_CAP : pageSize,
      include: {
        machine: { select: { id: true, tid: true, serial: true, mid: true, model: true, externalId: true } },
      },
    }),
    prisma.posAssignmentLog.count({ where: { ...where, action: "assign" } }),
    prisma.posAssignmentLog.count({ where: { ...where, action: "unassign" } }),
    prisma.posAssignmentLog.count({
      where: { ...where, action: "assign", fromUserId: { not: null } },
    }),
    prisma.posAssignmentLog.count({ where: { ...where, status: "ACTIVE" } }),
  ]);

  // Resolve names for every user referenced on this page in one query.
  const userIds = new Set<string>();
  for (const r of rows) {
    if (r.fromUserId) userIds.add(r.fromUserId);
    if (r.toUserId) userIds.add(r.toUserId);
    if (r.byUserId) userIds.add(r.byUserId);
  }
  const users = userIds.size
    ? await prisma.user.findMany({
        where: { id: { in: Array.from(userIds) } },
        select: { id: true, name: true, role: true, userCode: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));
  const missing = (id: string) => ({ id, name: "Removed user", role: "", userCode: null });

  const entries = rows.map((r) => {
    const fromUser = r.fromUserId ? userMap.get(r.fromUserId) ?? missing(r.fromUserId) : null;
    const toUser = r.toUserId ? userMap.get(r.toUserId) ?? missing(r.toUserId) : null;
    const byUser = r.byUserId ? userMap.get(r.byUserId) ?? missing(r.byUserId) : null;
    // The "holder" is whose section this movement is filed under in the report:
    // an assignment lands with the receiver (toUser); a return is filed under the
    // person who gave the machine back (fromUser).
    const holder = r.action === "assign" ? toUser : fromUser;
    return {
      id: r.id,
      machineId: r.machineId,
      tid: r.machine?.tid ?? null,
      serial: r.machine?.serial ?? null,
      mid: r.machine?.mid ?? null,
      model: r.machine?.model ?? null,
      externalId: r.machine?.externalId ?? null,
      action: r.action,
      status: r.status,
      fromUser,
      toUser,
      byUser,
      holder,
      assignedDate: r.assignedDate?.toISOString() ?? null,
      transitDate: r.transitDate?.toISOString() ?? null,
      deliveredDate: r.deliveredDate?.toISOString() ?? null,
      returnedDate: r.returnedDate?.toISOString() ?? null,
      returnReason: r.returnReason,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    };
  });

  if (format === "csv" || format === "zip") {
    const header = [
      "Logged at", "Date", "Holder", "Holder code", "Holder role",
      "Movement", "Status", "TID", "Serial", "MID", "Model", "External ID",
      "From", "From code", "From role", "To", "To code", "To role",
      "Performed by", "By role",
      "Assigned", "In transit", "Delivered", "Returned",
      "Return reason", "Notes",
    ];
    const esc = (v: string | null | undefined) => {
      const s = v ?? "";
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const day = (iso: string) =>
      new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const movement = (e: (typeof entries)[number]) =>
      e.action === "assign" ? (e.fromUser ? "Reassigned" : "Assigned") : "Returned to stock";
    const lines = entries.map((e) =>
      [
        e.createdAt, day(e.createdAt),
        e.holder?.name ?? "Stock", e.holder?.userCode ?? "", e.holder?.role ?? "",
        movement(e), e.status, e.tid, e.serial, e.mid, e.model, e.externalId,
        e.fromUser?.name ?? "", e.fromUser?.userCode ?? "", e.fromUser?.role ?? "",
        e.toUser?.name ?? "", e.toUser?.userCode ?? "", e.toUser?.role ?? "",
        e.byUser?.name ?? "", e.byUser?.role ?? "",
        e.assignedDate ?? "", e.transitDate ?? "", e.deliveredDate ?? "",
        e.returnedDate ?? "", e.returnReason ?? "", e.note ?? "",
      ]
        .map(esc)
        .join(",")
    );
    const csvContent = [header.join(","), ...lines].join("\n");
    const dateStr = new Date().toISOString().slice(0, 10);

    if (format === "zip") {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      zip.file(`pos-tracking-report-${dateStr}.csv`, csvContent);
      const buf = Buffer.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="pos-tracking-report-${dateStr}.zip"`,
        },
      });
    }

    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="pos-tracking-report-${dateStr}.csv"`,
      },
    });
  }

  return NextResponse.json({
    entries,
    summary: { assignments, returns, reassignments, active },
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      hasPrev: page > 1,
      hasNext: page * pageSize < total,
    },
  });
}

const PatchBody = z
  .object({
    id: z.string().min(1),
    transitDate: z.string().datetime().nullable().optional(),
    deliveredDate: z.string().datetime().nullable().optional(),
    returnReason: z.string().max(300).nullable().optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .strict();

/**
 * PATCH /api/admin/pos/history
 *
 * Update dispatch milestones on a tracking entry (courier picked up /
 * delivered) or record a return reason after the fact. Audit-logged.
 */
export async function PATCH(req: Request) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { id, ...fields } = parsed.data;

  const existing = await prisma.posAssignmentLog.findUnique({
    where: { id },
    select: { id: true, machineId: true },
  });
  if (!existing)
    return NextResponse.json({ error: "Tracking entry not found" }, { status: 404 });

  const data: Prisma.PosAssignmentLogUpdateInput = {};
  if ("transitDate" in fields)
    data.transitDate = fields.transitDate ? new Date(fields.transitDate) : null;
  if ("deliveredDate" in fields)
    data.deliveredDate = fields.deliveredDate ? new Date(fields.deliveredDate) : null;
  if ("returnReason" in fields) data.returnReason = fields.returnReason;
  if ("note" in fields) data.note = fields.note;
  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  await prisma.posAssignmentLog.update({ where: { id }, data });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "pos.tracking.update",
      entity: "PosAssignmentLog",
      entityId: id,
      meta: { ...fields, by: admin.email, machineId: existing.machineId } as Prisma.InputJsonValue,
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true });
}
