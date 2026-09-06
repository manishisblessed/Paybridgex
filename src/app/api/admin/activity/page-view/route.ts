import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { recordAdminActivity } from "@/lib/security/adminActivity";
import { toErrorResponse } from "@/lib/security/apiErrors";

/**
 * Records a sensitive admin page view (read access). No step-up prompt — reads
 * are logged, not challenged. Server-side throttling collapses repeated views of
 * the same page by the same operator within a short window so the audit table
 * does not flood on reloads / quick navigation.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const Body = z.object({ path: z.string().min(1).max(300) }).strict();

const THROTTLE_MS = 5 * 60_000; // one row per (user, path) per 5 minutes

export async function POST(req: Request) {
  let admin;
  try {
    // FINANCE has read access to the admin area (see middleware), so include it.
    admin = await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT", "FINANCE");
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: true }); // never fail a page view

  const path = parsed.data.path;

  try {
    const recent = await prisma.auditLog.findFirst({
      where: {
        userId: admin.id,
        action: "admin.page.view",
        entityId: path,
        createdAt: { gte: new Date(Date.now() - THROTTLE_MS) },
      },
      select: { id: true },
    });
    if (recent) return NextResponse.json({ ok: true, throttled: true });

    await recordAdminActivity({
      actor: admin,
      req,
      action: "admin.page.view",
      kind: "read",
      entity: "AdminPage",
      entityId: path,
    });
  } catch {
    // best-effort; a page view must never break navigation
  }

  return NextResponse.json({ ok: true });
}
