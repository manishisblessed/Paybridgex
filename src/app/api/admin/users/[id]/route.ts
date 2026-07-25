import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireRole } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { bumpTokenVersion } from "@/lib/security/session";
import { generateRandomPassword } from "@/lib/utils";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("suspend"), reason: z.string().optional() }),
  z.object({ action: z.literal("activate"), reason: z.string().optional() }),
  z.object({ action: z.literal("close"), reason: z.string().optional() }),
  z.object({ action: z.literal("resetPassword") }),
  z.object({ action: z.literal("reset2fa"), reason: z.string().optional() }),
]);

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await requireRole("MASTER_ADMIN", "ADMIN");
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const body = parsed.data;
    const targetUser = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true, role: true, status: true, email: true },
    });

    if (!targetUser)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    if (targetUser.role === "ADMIN")
      return NextResponse.json({ error: "Cannot modify admin users" }, { status: 403 });

    if (body.action === "resetPassword") {
      const password = generateRandomPassword(12);
      const passwordHash = await bcrypt.hash(password, 12);
      await prisma.$transaction([
        prisma.user.update({ where: { id: params.id }, data: { passwordHash } }),
        prisma.auditLog.create({
          data: {
            userId: admin.id,
            action: "user.password_reset",
            entity: "User",
            entityId: params.id,
            meta: { email: targetUser.email },
            ip: clientIp(req),
          },
        }),
      ]);
      await bumpTokenVersion(params.id, { swallow: true });
      return NextResponse.json({ ok: true, password });
    }

    if (body.action === "reset2fa") {
      await prisma.$transaction([
        prisma.user.update({
          where: { id: params.id },
          data: {
            twoFactorEnabled: false,
            twoFactorSecret: null,
            twoFactorBackupCodes: [],
            twoFactorVerifiedAt: null,
          },
        }),
        prisma.auditLog.create({
          data: {
            userId: admin.id,
            action: "user.2fa_reset",
            entity: "User",
            entityId: params.id,
            meta: { email: targetUser.email, reason: body.reason },
            ip: clientIp(req),
          },
        }),
      ]);
      await bumpTokenVersion(params.id, { swallow: true });
      return NextResponse.json({ ok: true, message: "2FA has been reset. User will need to set up a new authenticator on next login." });
    }

    const { action, reason } = body;
    const statusMap = {
      suspend: "SUSPENDED" as const,
      activate: "ACTIVE" as const,
      close: "CLOSED" as const,
    };

    const newStatus = statusMap[action];

    await prisma.$transaction([
      prisma.user.update({
        where: { id: params.id },
        data: { status: newStatus },
      }),
      prisma.auditLog.create({
        data: {
          userId: admin.id,
          action: `user.${action}`,
          entity: "User",
          entityId: params.id,
          meta: { reason, previousStatus: targetUser.status },
          ip: clientIp(req),
        },
      }),
    ]);

    await bumpTokenVersion(params.id, { swallow: true });

    return NextResponse.json({ ok: true, status: newStatus });
  } catch (e: any) {
    if (e?.name === "AuthError") return NextResponse.json({ error: e.message }, { status: 401 });
    console.error("[admin/users/id] PATCH error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
