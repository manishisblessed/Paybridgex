import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { bumpTokenVersion } from "@/lib/security/session";
import { generateRandomPassword } from "@/lib/utils";
import { dec, toNumber } from "@/lib/money";
import { istMidnightForDate } from "@/lib/rekyc/dates";
import { isNetworkTier } from "@/lib/security/kycGate";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/** GET — full network-manager detail for one user. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT", "FINANCE");
    const u = await prisma.user.findFirst({
      where: { id: params.id, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        shopName: true,
        city: true,
        state: true,
        walletBalance: true,
        aepsBalance: true,
        heldBalance: true,
        enabledServices: true,
        createdAt: true,
        instantSettlement: true,
        scheme: { select: { id: true, name: true } },
        parent: { select: { id: true, name: true, role: true } },
        kyc: { select: { status: true } },
        userLimit: true,
        settlementConfig: true,
        reKycRequired: true,
        reKycDueAt: true,
        lastReKycAt: true,
        _count: { select: { children: true } },
      },
    });
    if (!u) return NextResponse.json({ error: "User not found" }, { status: 404 });

    return NextResponse.json({
      user: {
        ...u,
        reKycDueAt: u.reKycDueAt?.toISOString() ?? null,
        lastReKycAt: u.lastReKycAt?.toISOString() ?? null,
        walletBalance: toNumber(dec(u.walletBalance)),
        aepsBalance: toNumber(dec(u.aepsBalance)),
        heldBalance: toNumber(dec(u.heldBalance)),
        userLimit: u.userLimit
          ? {
              walletCap: u.userLimit.walletCap != null ? toNumber(dec(u.userLimit.walletCap)) : null,
              dailyTxnAmountCap:
                u.userLimit.dailyTxnAmountCap != null
                  ? toNumber(dec(u.userLimit.dailyTxnAmountCap))
                  : null,
              dailyTxnCountCap: u.userLimit.dailyTxnCountCap,
              settlementDailyCap:
                u.userLimit.settlementDailyCap != null
                  ? toNumber(dec(u.userLimit.settlementDailyCap))
                  : null,
              settlementPerTxnCap:
                u.userLimit.settlementPerTxnCap != null
                  ? toNumber(dec(u.userLimit.settlementPerTxnCap))
                  : null,
              settlementTier: u.userLimit.settlementTier,
              note: u.userLimit.note,
            }
          : null,
        settlementConfig: u.settlementConfig
          ? {
              autoSettleEnabled: u.settlementConfig.autoSettleEnabled,
              pausedUntil: u.settlementConfig.pausedUntil?.toISOString() ?? null,
              pausedReason: u.settlementConfig.pausedReason,
              keepBalance:
                u.settlementConfig.keepBalance != null
                  ? toNumber(dec(u.settlementConfig.keepBalance))
                  : null,
            }
          : null,
      },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/network/:id] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assignScheme"), schemeId: z.string().nullable() }),
  z.object({ action: z.literal("resetPassword") }),
  z.object({ action: z.literal("reset2fa"), reason: z.string().max(300).optional() }),
  z.object({
    action: z.literal("setLimits"),
    walletCap: z.number().positive().nullable().optional(),
    dailyTxnAmountCap: z.number().positive().nullable().optional(),
    dailyTxnCountCap: z.number().int().positive().nullable().optional(),
    settlementDailyCap: z.number().positive().nullable().optional(),
    settlementPerTxnCap: z.number().positive().nullable().optional(),
    settlementTier: z.string().max(40).nullable().optional(),
    note: z.string().max(300).nullable().optional(),
  }),
  z.object({
    action: z.literal("settlementConfig"),
    autoSettleEnabled: z.boolean().optional(),
    pausedUntil: z.string().datetime().nullable().optional(),
    pausedReason: z.string().max(300).nullable().optional(),
    keepBalance: z.number().nonnegative().nullable().optional(),
  }),
  z.object({
    action: z.literal("toggleInstantSettlement"),
    enabled: z.boolean(),
  }),
  z.object({
    action: z.literal("rescheduleReKyc"),
    // "now"      → require re-verification immediately (blocks until done).
    // "postpone" → clear the block now and re-require it on `dueDate`.
    // "clear"    → clear the current block; next requirement falls on the
    //              monthly sweep (or the provided dueDate if given).
    mode: z.enum(["now", "postpone", "clear"]),
    dueDate: z.string().min(1).max(40).optional(),
    reason: z.string().max(300).optional(),
  }),
]);

/** PATCH — network-manager per-user actions (scheme, limits, password, settlement). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const target = await prisma.user.findFirst({
    where: { id: params.id, deletedAt: null },
    select: { id: true, role: true, email: true, parentId: true },
  });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (["ADMIN", "MASTER_ADMIN", "SUPPORT", "FINANCE"].includes(target.role))
    return NextResponse.json({ error: "Not a network user" }, { status: 403 });

  const body = parsed.data;
  const audit = async (action: string, meta: object) =>
    prisma.auditLog.create({
      data: {
        userId: admin.id,
        action,
        entity: "User",
        entityId: target.id,
        meta,
        ip: clientIp(req),
      },
    });

  try {
    switch (body.action) {
      case "assignScheme": {
        if (body.schemeId) {
          // Cascade model: a user's scheme must come from their parent's
          // derived schemes — or be a platform scheme for SUPER_DISTRIBUTORs
          // (who sit directly under admin). Admin can act on the parent's
          // behalf, but never cross-assign another branch's pricing.
          const scheme = await prisma.scheme.findFirst({
            where: { id: body.schemeId, active: true },
            select: { id: true, ownerId: true },
          });
          if (!scheme)
            return NextResponse.json({ error: "Scheme not found or inactive" }, { status: 404 });
          const allowed = scheme.ownerId
            ? scheme.ownerId === target.parentId
            : target.role === "SUPER_DISTRIBUTOR";
          if (!allowed)
            return NextResponse.json(
              {
                error: scheme.ownerId
                  ? "Scheme belongs to a different parent — assign one of this user's parent's schemes"
                  : "Platform schemes can only be assigned to super-distributors; lower tiers get schemes from their parent",
              },
              { status: 400 }
            );
        }
        await prisma.user.update({
          where: { id: target.id },
          data: { schemeId: body.schemeId },
        });
        await audit("network.scheme_assigned", { schemeId: body.schemeId });
        return NextResponse.json({ ok: true });
      }

      case "resetPassword": {
        const password = generateRandomPassword(12);
        const passwordHash = await bcrypt.hash(password, 12);
        await prisma.user.update({ where: { id: target.id }, data: { passwordHash } });
        await bumpTokenVersion(target.id, { swallow: true });
        await audit("network.password_reset", { email: target.email });
        // Returned once to the admin for out-of-band delivery; never stored in plain.
        return NextResponse.json({ ok: true, password });
      }

      case "reset2fa": {
        await prisma.user.update({
          where: { id: target.id },
          data: {
            twoFactorEnabled: false,
            twoFactorSecret: null,
            twoFactorBackupCodes: [],
            twoFactorVerifiedAt: null,
          },
        });
        await bumpTokenVersion(target.id, { swallow: true });
        await audit("network.2fa_reset", { email: target.email, reason: body.reason });
        return NextResponse.json({
          ok: true,
          message: "2FA reset. User will set up a new authenticator on next login.",
        });
      }

      case "setLimits": {
        const { action: _a, ...fields } = body;
        const data = Object.fromEntries(
          Object.entries(fields).filter(([, v]) => v !== undefined)
        );
        await prisma.userLimit.upsert({
          where: { userId: target.id },
          update: { ...data, updatedById: admin.id },
          create: { userId: target.id, ...data, updatedById: admin.id },
        });
        await audit("network.limits_updated", data);
        return NextResponse.json({ ok: true });
      }

      case "settlementConfig": {
        const { action: _a, pausedUntil, ...fields } = body;
        const data: Record<string, unknown> = Object.fromEntries(
          Object.entries(fields).filter(([, v]) => v !== undefined)
        );
        if (pausedUntil !== undefined)
          data.pausedUntil = pausedUntil ? new Date(pausedUntil) : null;
        await prisma.userSettlementConfig.upsert({
          where: { userId: target.id },
          update: { ...data, updatedById: admin.id },
          create: { userId: target.id, ...data, updatedById: admin.id },
        });
        await audit("network.settlement_config_updated", data as object);
        return NextResponse.json({ ok: true });
      }

      case "toggleInstantSettlement": {
        await prisma.user.update({
          where: { id: target.id },
          data: { instantSettlement: body.enabled },
        });
        await audit("network.instant_settlement_toggled", { enabled: body.enabled });
        return NextResponse.json({ ok: true, instantSettlement: body.enabled });
      }

      case "rescheduleReKyc": {
        // Only the four network tiers are subject to the monthly re-KYC gate.
        if (!isNetworkTier(target.role)) {
          return NextResponse.json(
            { error: "Re-KYC does not apply to this role." },
            { status: 400 }
          );
        }

        let reKycRequired: boolean;
        let reKycDueAt: Date | null;

        if (body.mode === "now") {
          // Block immediately.
          reKycRequired = true;
          reKycDueAt = new Date();
        } else {
          // postpone / clear: unblock now; the gate re-blocks when dueDate lands.
          if (body.dueDate) {
            const due = istMidnightForDate(body.dueDate);
            if (!due) {
              return NextResponse.json(
                { error: "Invalid date. Use YYYY-MM-DD." },
                { status: 400 }
              );
            }
            if (body.mode === "postpone" && due.getTime() <= Date.now()) {
              return NextResponse.json(
                { error: "Postpone date must be in the future." },
                { status: 400 }
              );
            }
            reKycDueAt = due;
            // The due-aware gate treats an elapsed dueDate as "required".
            reKycRequired = due.getTime() <= Date.now();
          } else {
            // No date: just clear the current block.
            reKycRequired = false;
            reKycDueAt = null;
          }
        }

        await prisma.user.update({
          where: { id: target.id },
          data: { reKycRequired, reKycDueAt },
        });
        await audit("network.rekyc_rescheduled", {
          mode: body.mode,
          dueDate: body.dueDate ?? null,
          reKycRequired,
          reKycDueAt: reKycDueAt?.toISOString() ?? null,
          reason: body.reason,
        });
        return NextResponse.json({
          ok: true,
          reKycRequired,
          reKycDueAt: reKycDueAt?.toISOString() ?? null,
        });
      }
    }
  } catch (e) {
    console.error("[admin/network/:id] PATCH error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
