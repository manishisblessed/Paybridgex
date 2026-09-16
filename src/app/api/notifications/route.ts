import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * GET /api/notifications
 *
 * The signed-in user's recent in-app notifications (newest first) plus the
 * count of unread ones — powers the topbar bell dropdown + unread badge.
 */
export async function GET() {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id, channel: "INAPP" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, title: true, body: true, href: true, readAt: true, createdAt: true },
    }),
    prisma.notification.count({ where: { userId: user.id, channel: "INAPP", readAt: null } }),
  ]);

  return NextResponse.json({
    unread,
    notifications: items.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      href: n.href,
      read: n.readAt !== null,
      createdAt: n.createdAt.toISOString(),
    })),
  });
}

const PatchBody = z.object({
  id: z.string().min(1).optional(),
  all: z.boolean().optional(),
});

/**
 * PATCH /api/notifications
 *
 * Mark a single notification (`{ id }`) or every unread one (`{ all: true }`)
 * as read. Scoped to the caller's own notifications.
 */
export async function PATCH(req: Request) {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { id, all } = parsed.data;

  if (all) {
    await prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
  } else if (id) {
    await prisma.notification.updateMany({
      where: { id, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
  } else {
    return NextResponse.json({ error: "Pass an id or all:true" }, { status: 400 });
  }

  const unread = await prisma.notification.count({
    where: { userId: user.id, channel: "INAPP", readAt: null },
  });
  return NextResponse.json({ ok: true, unread });
}
