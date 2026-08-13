import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import {
  placeWalletLien,
  serializeLien,
  canManageLiens,
  canViewLiens,
  WalletLienError,
  LIEN_REASON_CODES,
} from "@/lib/wallet/lien";
import { toNumber, dec } from "@/lib/money";
import { formatNumber } from "@/lib/utils";
import { walletOpMaxAmount, WALLET_OP_ABSOLUTE_MAX } from "@/lib/settings";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const CreateBody = z.object({
  targetUserId: z.string().min(1),
  amount: z
    .number()
    .positive("Enter an amount greater than zero")
    .max(WALLET_OP_ABSOLUTE_MAX, "Amount is too large"),
  reasonCode: z.enum(LIEN_REASON_CODES),
  remarks: z.string().min(3, "Remarks are mandatory (min 3 characters)").max(500),
  refType: z.string().max(64).optional(),
  refId: z.string().max(191).optional(),
});

/** POST — place a lien (freezes funds + eagerly recovers what's available). */
export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }
  if (!canManageLiens(admin))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Please check the amount and details and try again.",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );

  const maxOp = await walletOpMaxAmount();
  if (parsed.data.amount > maxOp)
    return NextResponse.json(
      { error: `Amount cannot exceed ₹${formatNumber(maxOp)} per lien` },
      { status: 400 }
    );

  try {
    const lien = await placeWalletLien({
      actorId: admin.id,
      ...parsed.data,
      ip: clientIp(req),
    });

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "wallet_lien.placed",
        entity: "WalletLien",
        entityId: lien.id,
        meta: {
          targetUserId: lien.targetUserId,
          amount: toNumber(dec(lien.amount)),
          recoveredAmount: toNumber(dec(lien.recoveredAmount)),
          reasonCode: lien.reasonCode,
          refType: lien.refType,
          refId: lien.refId,
          status: lien.status,
        },
        ip: clientIp(req),
      },
    });

    return NextResponse.json({ ok: true, lien: serializeLien(lien) }, { status: 201 });
  } catch (e) {
    if (e instanceof WalletLienError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    console.error("[admin/wallet/liens] POST error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** GET — lien history with filters. */
export async function GET(req: Request) {
  let admin;
  try {
    admin = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }
  if (!canViewLiens(admin))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const q = searchParams.get("q") ?? "";
  const targetUserId = searchParams.get("targetUserId");
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const pageSize = Math.min(100, Math.max(10, Number(searchParams.get("pageSize") ?? 25)));

  const where: Record<string, unknown> = {};
  if (status && status !== "all") where.status = status;
  if (targetUserId) where.targetUserId = targetUserId;
  if (q) {
    where.targetUser = {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { shopName: { contains: q, mode: "insensitive" } },
      ],
    };
  }

  try {
    const [liens, total] = await Promise.all([
      prisma.walletLien.findMany({
        where: where as never,
        include: {
          targetUser: { select: { userCode: true, name: true, email: true, shopName: true, role: true } },
          actor: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.walletLien.count({ where: where as never }),
    ]);

    return NextResponse.json({
      liens: liens.map((l) => ({
        ...serializeLien(l),
        targetUser: l.targetUser,
        actor: l.actor,
      })),
      total,
      page,
      pageSize,
    });
  } catch (e) {
    console.error("[admin/wallet/liens] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
