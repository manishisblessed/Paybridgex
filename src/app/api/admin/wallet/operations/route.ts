import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import {
  createWalletOperation,
  canManageWalletOps,
  canViewWalletOps,
  WalletOpError,
  WALLET_OP_REASON_CODES,
} from "@/lib/wallet/operations";
import { toNumber, dec } from "@/lib/money";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const CreateBody = z.object({
  targetUserId: z.string().min(1),
  type: z.enum(["PUSH", "PULL"]),
  walletType: z.enum(["PRIMARY", "AEPS"]).default("PRIMARY"),
  amount: z.number().positive().max(10_000_000),
  reasonCode: z.enum(WALLET_OP_REASON_CODES),
  remarks: z.string().min(3).max(500),
});

/** POST — create a wallet PUSH/PULL (executes immediately for the actor). */
export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }
  if (!canManageWalletOps(admin))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const op = await createWalletOperation({
      actorId: admin.id,
      ...parsed.data,
      ip: clientIp(req),
    });

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action:
          op.status === "PENDING_APPROVAL" ? "wallet_op.staged" : "wallet_op.executed",
        entity: "WalletOperation",
        entityId: op.id,
        meta: {
          type: op.type,
          walletType: op.walletType,
          amount: toNumber(dec(op.amount)),
          reasonCode: op.reasonCode,
          targetUserId: op.targetUserId,
          status: op.status,
        },
        ip: clientIp(req),
      },
    });

    return NextResponse.json({ ok: true, operation: serialize(op) }, { status: 201 });
  } catch (e) {
    if (e instanceof WalletOpError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    console.error("[admin/wallet/operations] POST error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** GET — operation history with filters. */
export async function GET(req: Request) {
  try {
    const admin = await requireAuth();
    if (!canViewWalletOps(admin))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const type = searchParams.get("type");
    const q = searchParams.get("q") ?? "";
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(100, Math.max(10, Number(searchParams.get("pageSize") ?? 25)));

    const where: Record<string, unknown> = {};
    if (status && status !== "all") where.status = status;
    if (type && type !== "all") where.type = type;
    if (q) {
      where.targetUser = {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { shopName: { contains: q, mode: "insensitive" } },
        ],
      };
    }

    const [ops, total] = await Promise.all([
      prisma.walletOperation.findMany({
        where: where as never,
        include: {
          targetUser: { select: { userCode: true, name: true, email: true, shopName: true, role: true } },
          actor: { select: { name: true, email: true } },
          approvedBy: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.walletOperation.count({ where: where as never }),
    ]);

    return NextResponse.json({
      operations: ops.map((op) => ({
        ...serialize(op),
        targetUser: op.targetUser,
        actor: op.actor,
        approvedBy: op.approvedBy,
      })),
      total,
      page,
      pageSize,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/wallet/operations] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function serialize(op: {
  id: string;
  targetUserId: string;
  actorId: string;
  type: string;
  walletType: string;
  amount: unknown;
  reasonCode: string;
  remarks: string;
  status: string;
  approvedById: string | null;
  approvedAt: Date | null;
  rejectedNote: string | null;
  walletTxnId: string | null;
  createdAt: Date;
}) {
  return {
    id: op.id,
    targetUserId: op.targetUserId,
    actorId: op.actorId,
    type: op.type,
    walletType: op.walletType,
    amount: toNumber(dec(op.amount as never)),
    reasonCode: op.reasonCode,
    remarks: op.remarks,
    status: op.status,
    approvedById: op.approvedById,
    approvedAt: op.approvedAt?.toISOString() ?? null,
    rejectedNote: op.rejectedNote,
    walletTxnId: op.walletTxnId,
    createdAt: op.createdAt.toISOString(),
  };
}
