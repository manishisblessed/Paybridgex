import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { requireRole, AuthError } from "@/lib/auth-server";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { dec, toNumber } from "@/lib/money";
import { runT1SettlementForUser } from "@/lib/settlement/t1";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * GET — AEPS Control Centre. `view` selects the panel:
 *   overview (default) — float, merchant funnel, pending approvals count
 *   merchants          — merchant list with wallet + status
 *   accounts           — settlement-account approval queue
 *   settlements        — settlement history
 */
export async function GET(req: Request) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT", "FINANCE");

    const url = new URL(req.url);
    const view = url.searchParams.get("view") ?? "overview";
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = 25;

    if (view === "merchants") {
      const status = url.searchParams.get("status") ?? "all";
      const where = status !== "all" ? { status: status as never } : {};
      const [rows, total] = await Promise.all([
        prisma.aepsMerchant.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            user: {
              select: { id: true, name: true, email: true, phone: true, role: true, aepsBalance: true, status: true },
            },
          },
        }),
        prisma.aepsMerchant.count({ where }),
      ]);
      return NextResponse.json({
        merchants: rows.map((m) => ({
          id: m.id,
          provider: m.provider,
          providerMerchantId: m.providerMerchantId,
          status: m.status,
          activatedAt: m.activatedAt?.toISOString() ?? null,
          createdAt: m.createdAt.toISOString(),
          user: {
            id: m.user.id,
            name: m.user.name,
            email: m.user.email,
            phone: m.user.phone,
            role: m.user.role,
            accountStatus: m.user.status,
            aepsBalance: toNumber(dec(m.user.aepsBalance)),
          },
        })),
        total,
        page,
        pageSize,
      });
    }

    if (view === "accounts") {
      const status = url.searchParams.get("status") ?? "PENDING_APPROVAL";
      const where = status !== "all" ? { status: status as never } : {};
      const [rows, total] = await Promise.all([
        prisma.aepsSettlementAccount.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { user: { select: { id: true, name: true, email: true } } },
        }),
        prisma.aepsSettlementAccount.count({ where }),
      ]);
      return NextResponse.json({
        accounts: rows.map((a) => ({
          id: a.id,
          holder: a.accountHolderName,
          accountLast4: a.accountLast4,
          ifsc: a.ifsc,
          bankName: a.bankName,
          status: a.status,
          pennyDropVerified: a.pennyDropVerified,
          reviewNote: a.reviewNote,
          createdAt: a.createdAt.toISOString(),
          user: a.user,
        })),
        total,
        page,
        pageSize,
      });
    }

    if (view === "settlements") {
      const [rows, total] = await Promise.all([
        prisma.aepsSettlement.findMany({
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { user: { select: { id: true, name: true, email: true } } },
        }),
        prisma.aepsSettlement.count(),
      ]);
      return NextResponse.json({
        settlements: rows.map((s) => ({
          id: s.id,
          amount: toNumber(dec(s.amount)),
          charge: toNumber(dec(s.charge)),
          mode: s.mode,
          status: s.status,
          utr: s.utr,
          detail: s.detail,
          createdAt: s.createdAt.toISOString(),
          user: s.user,
        })),
        total,
        page,
        pageSize,
      });
    }

    // overview
    const [merchantsByStatus, pendingAccounts, floatAgg, settledToday] = await Promise.all([
      prisma.aepsMerchant.groupBy({ by: ["status"], _count: true }),
      prisma.aepsSettlementAccount.count({ where: { status: "PENDING_APPROVAL" } }),
      prisma.user.aggregate({
        where: { deletedAt: null, aepsBalance: { gt: 0 } },
        _sum: { aepsBalance: true },
        _count: true,
      }),
      prisma.settlementRun.aggregate({
        where: {
          status: "SUCCESS",
          createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) },
        },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    const countOf = (s: string) => merchantsByStatus.find((m) => m.status === s)?._count ?? 0;
    return NextResponse.json({
      overview: {
        merchants: {
          total: merchantsByStatus.reduce((acc, m) => acc + m._count, 0),
          pending: countOf("PENDING"),
          active: countOf("ACTIVE"),
          suspended: countOf("SUSPENDED"),
          rejected: countOf("REJECTED"),
        },
        pendingAccountApprovals: pendingAccounts,
        float: {
          usersWithBalance: floatAgg._count,
          totalAmount: toNumber(dec(floatAgg._sum.aepsBalance ?? 0)),
        },
        settled24h: {
          count: settledToday._count,
          amount: toNumber(dec(settledToday._sum.amount ?? 0)),
        },
      },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/aeps] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const ActionBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("onboard_merchant"), userId: z.string().min(1), provider: z.string().min(2).max(30).default("PAYSPRINT") }),
  z.object({ action: z.literal("merchant_status"), merchantId: z.string().min(1), status: z.enum(["ACTIVE", "SUSPENDED", "REJECTED"]), note: z.string().max(200).optional() }),
  z.object({ action: z.literal("review_account"), accountId: z.string().min(1), decision: z.enum(["APPROVED", "REJECTED"]), note: z.string().max(200).optional() }),
  z.object({ action: z.literal("settle_user"), userId: z.string().min(1) }),
]);

/** POST — AEPS admin actions. */
export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireAdminActivity(req, {
      action: "aeps.action",
      roles: ["MASTER_ADMIN", "ADMIN"],
      entity: "Aeps",
    });
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = ActionBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;

  const audit = (action: string, meta: Record<string, unknown>) =>
    prisma.auditLog.create({
      data: {
        userId: admin.id,
        action,
        entity: "Aeps",
        meta: meta as Prisma.InputJsonValue,
        ip: clientIp(req),
      },
    });

  try {
    switch (body.action) {
      case "onboard_merchant": {
        const user = await prisma.user.findFirst({
          where: {
            id: body.userId,
            deletedAt: null,
            role: { in: ["RETAILER", "DISTRIBUTOR", "MASTER_DISTRIBUTOR", "SUPER_DISTRIBUTOR"] },
          },
          select: { id: true, name: true },
        });
        if (!user) return NextResponse.json({ error: "Network user not found" }, { status: 404 });
        const existing = await prisma.aepsMerchant.findUnique({ where: { userId: user.id } });
        if (existing)
          return NextResponse.json(
            { error: `User already has an AEPS merchant record (${existing.status})` },
            { status: 409 }
          );
        const merchant = await prisma.aepsMerchant.create({
          data: { userId: user.id, provider: body.provider, status: "PENDING" },
        });
        await audit("aeps.merchant_onboarded", { merchantId: merchant.id, userId: user.id, provider: body.provider });
        return NextResponse.json({ ok: true, merchantId: merchant.id }, { status: 201 });
      }

      case "merchant_status": {
        const merchant = await prisma.aepsMerchant.findUnique({ where: { id: body.merchantId } });
        if (!merchant) return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
        await prisma.aepsMerchant.update({
          where: { id: merchant.id },
          data: {
            status: body.status,
            ...(body.status === "ACTIVE" ? { activatedAt: merchant.activatedAt ?? new Date(), suspendedAt: null } : {}),
            ...(body.status === "SUSPENDED" ? { suspendedAt: new Date() } : {}),
            ...(body.note ? { meta: { ...(merchant.meta as object ?? {}), lastNote: body.note } } : {}),
          },
        });
        await audit("aeps.merchant_status", { merchantId: merchant.id, status: body.status, note: body.note ?? null });
        return NextResponse.json({ ok: true });
      }

      case "review_account": {
        const account = await prisma.aepsSettlementAccount.findUnique({ where: { id: body.accountId } });
        if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
        if (account.status !== "PENDING_APPROVAL")
          return NextResponse.json({ error: `Account is already ${account.status}` }, { status: 409 });
        await prisma.aepsSettlementAccount.update({
          where: { id: account.id },
          data: {
            status: body.decision,
            reviewedById: admin.id,
            reviewedAt: new Date(),
            reviewNote: body.note?.trim() || null,
          },
        });
        await audit("aeps.account_reviewed", { accountId: account.id, decision: body.decision, note: body.note ?? null });
        return NextResponse.json({ ok: true });
      }

      case "settle_user": {
        const r = await runT1SettlementForUser(body.userId, admin.id);
        await audit("aeps.settle_user_manual", { ...r, userId: body.userId });
        if (r.status === "FAILED")
          return NextResponse.json({ error: r.detail ?? "Settlement failed" }, { status: 400 });
        return NextResponse.json({ ok: true, result: r });
      }
    }
  } catch (e) {
    console.error("[admin/aeps] POST error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
