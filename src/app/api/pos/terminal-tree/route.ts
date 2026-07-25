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

  // Fetch all terminals assigned to the caller or their direct children.
  const terminals = await prisma.posMachine.findMany({
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
  });

  // Members for the filter dropdown = direct children who actually hold a
  // terminal (no deeper path to walk in the one-level model).
  const owners = new Set(terminals.map((t) => t.assignedUserId).filter(Boolean));
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
      ownerId: t.assignedUserId,
      assignedAt: t.assignedAt?.toISOString() ?? null,
    })),
  });
}
