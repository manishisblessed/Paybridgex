import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { assertServiceEnabled, ServiceDisabledError } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { isAdminRole } from "@/lib/security/ownership";
import { prisma } from "@/lib/db";
import { flags } from "@/lib/env";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * GET /api/pos/terminal-tree
 *
 * Returns the caller's DIRECT children who hold assigned POS terminals, plus
 * the terminals owned by the caller or those direct children. POS visibility is
 * one level only (SD→MDs, MD→DTs, DT→RTs), so the cascading filter shows just
 * the caller's own + immediate children's terminals — matching exactly what the
 * caller may actually query in the transactions feed.
 */
export async function GET(req: Request) {
  let user;
  try {
    user = await requireAuth();
    await assertServiceEnabled(SERVICE_KEYS.POS, {
      name: "POS Terminals",
      userId: user.id,
      role: user.role,
    });
  } catch (e) {
    if (e instanceof AuthError || e instanceof ServiceDisabledError)
      return NextResponse.json(
        { error: e.message },
        { status: e.statusCode }
      );
    throw e;
  }

  if (!flags.pos)
    return NextResponse.json(
      { error: "POS service is not enabled" },
      { status: 503 }
    );

  // Admins see everything — skip hierarchy scoping.
  if (isAdminRole(user.role)) {
    const terminals = await prisma.posMachine.findMany({
      where: { assignedUserId: { not: null }, tid: { not: null } },
      select: {
        tid: true,
        mid: true,
        model: true,
        location: true,
        city: true,
        assignedUserId: true,
        assignedAt: true,
        assignedUser: {
          select: { id: true, name: true, role: true, parentId: true },
        },
      },
    });

    return NextResponse.json({
      callerRole: user.role,
      members: [],
      terminals: terminals.map((t) => ({
        tid: t.tid,
        mid: t.mid,
        model: t.model,
        location: t.location,
        city: t.city,
        ownerId: t.assignedUserId,
        ownerName: t.assignedUser?.name ?? null,
        ownerRole: t.assignedUser?.role ?? null,
        assignedAt: t.assignedAt?.toISOString() ?? null,
      })),
    });
  }

  // Direct children only (one hierarchy level) — POS visibility never spans the
  // full subtree, so we only consider the caller's immediate children.
  const children = await prisma.user.findMany({
    where: { parentId: user.id, deletedAt: null },
    select: { id: true, name: true, role: true, parentId: true },
  });

  const allIds = [user.id, ...children.map((c) => c.id)];

  // A terminal a holder USED to own must keep appearing here even after it is
  // unassigned/reassigned — otherwise the dashboard hides the whole feed
  // ("No POS terminals yet") and never queries the transactions that still
  // belong to that holder. So we surface BOTH:
  //   • CURRENT holdings — the live `assignedUserId` column.
  //   • PAST holdings — closed `PosAssignmentLog` windows (returnedDate set).
  // This mirrors `scopePosTerminals`, so the UI shows exactly the terminals the
  // transactions feed will actually return rows for.
  const [current, pastLogs] = await Promise.all([
    prisma.posMachine.findMany({
      where: { assignedUserId: { in: allIds }, tid: { not: null } },
      select: {
        tid: true,
        mid: true,
        model: true,
        location: true,
        city: true,
        assignedUserId: true,
        assignedAt: true,
      },
    }),
    prisma.posAssignmentLog.findMany({
      where: {
        action: "assign",
        toUserId: { in: allIds },
        returnedDate: { not: null },
        machine: { tid: { not: null } },
      },
      select: {
        toUserId: true,
        assignedDate: true,
        createdAt: true,
        machine: {
          select: { tid: true, mid: true, model: true, location: true, city: true },
        },
      },
    }),
  ]);

  type TerminalEntry = {
    tid: string;
    mid: string | null;
    model: string | null;
    location: string | null;
    city: string | null;
    ownerId: string | null;
    assignedAt: Date | null;
  };

  // Dedupe by tid. When the caller held a terminal across several windows we
  // keep the EARLIEST assignment date so the dashboard's `dateFrom` clamp never
  // hides an older holding period; the backend still bounds each window exactly.
  const byTid = new Map<string, TerminalEntry>();
  const upsert = (e: TerminalEntry) => {
    const prev = byTid.get(e.tid);
    if (!prev) {
      byTid.set(e.tid, e);
      return;
    }
    const earliest =
      prev.assignedAt && (!e.assignedAt || prev.assignedAt <= e.assignedAt)
        ? prev.assignedAt
        : e.assignedAt;
    // Prefer a current owner (open holding) for the ownerId label.
    byTid.set(e.tid, { ...prev, assignedAt: earliest });
  };

  for (const t of current) {
    if (!t.tid) continue;
    upsert({
      tid: t.tid,
      mid: t.mid,
      model: t.model,
      location: t.location,
      city: t.city,
      ownerId: t.assignedUserId,
      assignedAt: t.assignedAt,
    });
  }
  for (const p of pastLogs) {
    const m = p.machine;
    if (!m?.tid) continue;
    upsert({
      tid: m.tid,
      mid: m.mid,
      model: m.model,
      location: m.location,
      city: m.city,
      ownerId: p.toUserId,
      assignedAt: p.assignedDate ?? p.createdAt,
    });
  }

  const terminals = [...byTid.values()];

  // Members for the filter dropdown = direct children who hold (or held) a
  // terminal (no deeper path to walk in the one-level model).
  const owners = new Set(terminals.map((t) => t.ownerId).filter(Boolean));
  const members = children
    .filter((c) => owners.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role,
      parentId: c.parentId,
    }));

  return NextResponse.json({
    callerRole: user.role,
    members,
    terminals: terminals.map((t) => ({
      tid: t.tid,
      mid: t.mid,
      model: t.model,
      location: t.location,
      city: t.city,
      ownerId: t.ownerId,
      assignedAt: t.assignedAt?.toISOString() ?? null,
    })),
  });
}
