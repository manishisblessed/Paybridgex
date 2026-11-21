import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth-server";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { settleTopup, type VerifiedPayin } from "@/lib/wallet/topup";
import { sendOpsAlert } from "@/lib/monitoring/alerts";
import { logger } from "@/lib/logger";
import { toNumber } from "@/lib/money";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/** GET — look up a WALLET_TOPUP by refId for the admin UI. */
export async function GET(req: Request) {
  try {
    await requireRole("MASTER_ADMIN");
    const { searchParams } = new URL(req.url);
    const refId = searchParams.get("refId")?.trim();
    if (!refId) return NextResponse.json({ error: "refId is required" }, { status: 400 });

    const txn = await prisma.transaction.findUnique({
      where: { refId },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!txn || txn.service !== "WALLET_TOPUP")
      return NextResponse.json({ error: "Wallet top-up not found" }, { status: 404 });

    const reqObj = (txn.request && typeof txn.request === "object" ? txn.request : {}) as Record<string, unknown>;
    return NextResponse.json({
      txn: {
        refId: txn.refId,
        status: txn.status,
        amount: toNumber(txn.amount),
        partner: txn.partner,
        partnerTxnId: txn.partnerTxnId,
        customer: txn.customer,
        createdAt: txn.createdAt.toISOString(),
        errorCode: txn.errorCode,
        user: txn.user,
        gatewayId: typeof reqObj.gatewayId === "string" ? reqObj.gatewayId : null,
      },
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}

const Body = z.object({
  refId: z.string().min(1),
  verifiedStatus: z.enum(["PAID", "FAILED"]),
  verifiedAmount: z.number().positive().optional(),
  utr: z.string().optional(),
  paymentMode: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = Body.safeParse(body);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const { refId, verifiedStatus, verifiedAmount, utr, paymentMode } = parsed.data;

    const txn = await prisma.transaction.findUnique({ where: { refId } });
    if (!txn || txn.service !== "WALLET_TOPUP")
      return NextResponse.json({ error: "Top-up not found" }, { status: 404 });
    if (txn.status === "SUCCESS")
      return NextResponse.json({ error: "Already settled", refId, status: "SUCCESS" }, { status: 409 });
    if (txn.status !== "FAILED")
      return NextResponse.json(
        { error: `Transaction is ${txn.status}, not FAILED — use the normal settle path` },
        { status: 400 },
      );

    const admin = await requireAdminActivity(req, {
      action: "topup.force_resettle",
      roles: ["MASTER_ADMIN"],
      entity: "Transaction",
      entityId: txn.id,
      body,
      meta: { refId, verifiedStatus, verifiedAmount, utr },
    });

    await enforceRateLimit(`topup:resettle:${admin.id}`, RATE_LIMITS.sensitiveWrite);

    const verified: VerifiedPayin = {
      status: verifiedStatus,
      amount: verifiedAmount ?? 0,
      reference: utr,
      paymentMode,
    };

    const result = await settleTopup(refId, verified, { forceResettle: true });

    logger.info({
      action: "admin.topup_force_resettle",
      adminId: admin.id,
      adminEmail: admin.email,
      refId,
      verifiedStatus,
      verifiedAmount,
      result: result.status,
    });

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "topup.force_resettle",
        entity: "Transaction",
        entityId: txn.id,
        meta: {
          refId,
          verifiedStatus,
          verifiedAmount,
          utr,
          resultStatus: result.status,
          resultAmount: result.amount,
        },
      },
    });

    if (result.status === "SUCCESS") {
      await sendOpsAlert({
        title: `Admin force-resettled top-up ${refId}`,
        severity: "info",
        details: {
          refId,
          amount: result.amount,
          admin: admin.email,
          verifiedStatus,
          utr,
        },
      });
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return toErrorResponse(e);
  }
}
