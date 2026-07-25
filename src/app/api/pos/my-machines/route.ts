import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { assertServiceEnabled, ServiceDisabledError } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { scopeDirectUserIdFilter, canAccessUser, getDescendantIds } from "@/lib/security/ownership";
import { prisma } from "@/lib/db";
import { flags } from "@/lib/env";
import { posMachineSelect, serializePosMachine } from "@/lib/pos/assignments";
import type { Prisma } from "@prisma/client";

export const fetchCache = "force-no-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/pos/my-machines
 *
 * User-facing list of POS machines assigned to the caller (and, for parents,
 * their DIRECT children only — SD→MDs, MD→DTs, DT→RTs). Scoped via
 * `scopeDirectUserIdFilter` so a user only ever sees their own and their
 * immediate children's terminals. Admins see the whole assigned fleet.
 */
export async function GET(req: Request) {
  let user;
  try {
    user = await requireAuth();
    // Admin kill-switch + per-user allowlist (default-disabled) for this rail.
    await assertServiceEnabled(SERVICE_KEYS.POS, { name: "POS Terminals", userId: user.id, role: user.role });
  } catch (e) {
    if (e instanceof AuthError || e instanceof ServiceDisabledError)
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
  const pageSize = Math.min(200, Math.max(10, Number(searchParams.get("pageSize") ?? 50)));

  // Optional `forChild` scoping: the POS Rental page uses this to list machines
  // it may rent to a specific downline member. A machine can be rented to a
  // child even after it has flowed further down the chain (MD → DT → RT), so
  // we scope to the child's whole subtree (child + descendants), not just
  // machines the child holds directly.
  const forChild = searchParams.get("forChild");
  let where: Prisma.PosMachineWhereInput;
  if (forChild) {
    if (!(await canAccessUser(forChild, user)))
      return NextResponse.json({ error: "User not in your network" }, { status: 403 });
    const subtreeIds = [forChild, ...(await getDescendantIds(forChild))];
    where = { assignedUserId: { in: subtreeIds } };
  } else {
    // scopeDirectUserIdFilter returns { userId: { in: [self + direct children] } }
    // for non-admins, {} for admins. The machine's owner column is
    // `assignedUserId`, so remap it.
    const scope = await scopeDirectUserIdFilter(user);
    where = scope.userId
      ? { assignedUserId: scope.userId }
      : { assignedUserId: { not: null } };
  }

  const [rows, total] = await Promise.all([
    prisma.posMachine.findMany({
      where,
      select: posMachineSelect,
      orderBy: [{ assignedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.posMachine.count({ where }),
  ]);

  const active = await prisma.posMachine.count({
    where: { ...where, status: "active" },
  });

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
    stats: { total, active },
  });
}
