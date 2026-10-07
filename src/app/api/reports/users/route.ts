import { NextResponse } from "next/server";
import { z } from "zod";
import { Role, Prisma } from "@prisma/client";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { isAdminRole, getDescendantIds } from "@/lib/security/ownership";

export const fetchCache = "force-no-store";

export const dynamic = "force-dynamic";

/** Hard cap so a broad role (e.g. all RETAILERs on an admin account) can't blow up the picker. */
const MAX_USERS = 500;

const QuerySchema = z.object({
  role: z.nativeEnum(Role).optional(),
  q: z.string().trim().max(80).optional(),
});

/**
 * Lightweight user list for report filter pickers.
 *
 * Returns `{ id, name, userCode, role }` for users the caller is allowed to see
 * (admins → everyone; otherwise self + full downline), optionally narrowed by
 * `role` and a name/userCode search `q`. Used by the Push/Pull report to let the
 * operator pick a specific sender/recipient after choosing a From/To role.
 */
export async function GET(req: Request) {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { role, q } = parsed.data;

  // Ownership scope: admins see everyone, otherwise self + downline.
  const allowedIds = isAdminRole(user.role)
    ? null
    : [user.id, ...(await getDescendantIds(user.id))];

  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(allowedIds ? { id: { in: allowedIds } } : {}),
    ...(role ? { role } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { userCode: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  try {
    const users = await prisma.user.findMany({
      where,
      select: { id: true, name: true, userCode: true, role: true },
      orderBy: { name: "asc" },
      take: MAX_USERS,
    });
    return NextResponse.json({ users });
  } catch (e) {
    console.error("[reports/users] query error:", e);
    return NextResponse.json({ error: "Failed to list users" }, { status: 500 });
  }
}
