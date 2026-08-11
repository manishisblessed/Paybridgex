import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireRole } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { bumpTokenVersion } from "@/lib/security/session";
import { generateRandomPassword } from "@/lib/utils";
import { NETWORK_TIERS } from "@/lib/hierarchy";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("suspend"), reason: z.string().optional() }),
  z.object({ action: z.literal("activate"), reason: z.string().optional() }),
  z.object({ action: z.literal("close"), reason: z.string().optional() }),
  z.object({ action: z.literal("resetPassword") }),
  z.object({ action: z.literal("reset2fa"), reason: z.string().optional() }),
  // Admin override of a network user's approval status, in ANY direction
  // (Pending ↔ Approved ↔ Rejected). Keeps Kyc.status, User.status and the
  // onboarding Invite in sync. Rejected fully locks the account (no login, no
  // transactions) by moving User.status to SUSPENDED.
  z.object({
    action: z.literal("setApprovalStatus"),
    target: z.enum(["APPROVED", "PENDING", "REJECTED"]),
    reason: z.string().max(500).optional(),
  }),
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

    if (body.action === "setApprovalStatus") {
      // Approval status only applies to the four network tiers (RT/DT/MD/SD).
      if (!NETWORK_TIERS.includes(targetUser.role as (typeof NETWORK_TIERS)[number])) {
        return NextResponse.json(
          { error: "Approval status can only be set for network users." },
          { status: 400 }
        );
      }

      const now = new Date();
      const rejReason = body.reason?.trim() || null;
      // target → (User.status, Kyc.status). Rejected fully locks the account.
      const STATUS_MAP = {
        APPROVED: { user: "ACTIVE" as const, kyc: "APPROVED" as const },
        PENDING: { user: "PENDING_KYC" as const, kyc: "PENDING_REVIEW" as const },
        REJECTED: { user: "SUSPENDED" as const, kyc: "REJECTED" as const },
      };
      const next = STATUS_MAP[body.target];

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: params.id },
          data: { status: next.user },
        });

        await tx.kyc.upsert({
          where: { userId: params.id },
          update: {
            status: next.kyc,
            reviewedById: admin.id,
            reviewedAt: now,
            rejectedReason: body.target === "REJECTED" ? rejReason : null,
          },
          create: {
            userId: params.id,
            status: next.kyc,
            reviewedById: admin.id,
            reviewedAt: now,
            rejectedReason: body.target === "REJECTED" ? rejReason : null,
          },
        });

        // Keep the onboarding invite consistent with the new approval state.
        if (body.target === "APPROVED") {
          await tx.invite.updateMany({
            where: {
              userId: params.id,
              status: { in: ["PENDING", "REGISTERED", "VERIFIED", "RESUBMIT", "REJECTED"] },
            },
            data: { status: "APPROVED", approvedAt: now, rejectedAt: null, rejectedReason: null },
          });
        } else if (body.target === "REJECTED") {
          await tx.invite.updateMany({
            where: {
              userId: params.id,
              status: { in: ["PENDING", "REGISTERED", "VERIFIED", "RESUBMIT", "APPROVED"] },
            },
            data: { status: "REJECTED", rejectedAt: now, rejectedReason: rejReason ?? "Rejected by admin" },
          });
        } else {
          // PENDING — send any already-decided invite back to "under review".
          await tx.invite.updateMany({
            where: { userId: params.id, status: { in: ["APPROVED", "REJECTED"] } },
            data: { status: "VERIFIED", approvedAt: null, rejectedAt: null, rejectedReason: null },
          });
        }

        await tx.auditLog.create({
          data: {
            userId: admin.id,
            action: "user.approval_status_set",
            entity: "User",
            entityId: params.id,
            meta: {
              target: body.target,
              userStatus: next.user,
              previousStatus: targetUser.status,
              reason: rejReason,
            },
            ip: clientIp(req),
          },
        });
      });

      // Invalidate any live session — critical when downgrading to Pending or
      // Rejected so the user is signed out immediately.
      await bumpTokenVersion(params.id, { swallow: true });

      try {
        const title =
          body.target === "APPROVED"
            ? "Your account has been approved"
            : body.target === "REJECTED"
            ? "Your account has been rejected"
            : "Your account is under review";
        const bodyText =
          body.target === "APPROVED"
            ? "Your account is now active. You can log in and start transacting."
            : body.target === "REJECTED"
            ? `Your account has been rejected and access is suspended.${rejReason ? ` Reason: ${rejReason}` : ""}`
            : "Your account has been moved back to pending review. Access is paused until it is approved again.";
        await prisma.notification.create({
          data: { userId: params.id, title, body: bodyText, channel: "INAPP" },
        });
      } catch {}

      return NextResponse.json({ ok: true, status: body.target, userStatus: next.user });
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
