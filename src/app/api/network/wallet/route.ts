import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { creditWallet, debitWallet, LedgerError } from "@/lib/ledger";
import { toNumber } from "@/lib/money";
import { enforceRateLimit, RATE_LIMITS, RateLimitError } from "@/lib/security/rateLimit";
import { assertLivenessReady, LivenessRequiredError } from "@/lib/security/livenessGate";
import { assertKycCurrent, ReKycRequiredError } from "@/lib/security/kycGate";
import { clientIp } from "@/lib/security/audit";
import { formatNumber } from "@/lib/utils";
import { walletOpMaxAmount, WALLET_OP_ABSOLUTE_MAX } from "@/lib/settings";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const PARENT_ROLES = ["DISTRIBUTOR", "MASTER_DISTRIBUTOR", "SUPER_DISTRIBUTOR"];

const Body = z.object({
  childId: z.string().min(1),
  direction: z.enum(["PUSH", "PULL"]),
  amount: z
    .number()
    .positive("Enter an amount greater than zero")
    .max(WALLET_OP_ABSOLUTE_MAX, "Amount is too large"),
  note: z.string().max(500).optional(),
}).strict();

/**
 * POST /api/network/wallet
 *
 * Parent pushes (credits) or pulls (debits) wallet balance to/from a direct
 * child in the network hierarchy. Push debits the parent and credits the child;
 * pull does the reverse. Audit-logged and recorded in NetworkWalletTransfer.
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    if (!PARENT_ROLES.includes(user.role))
      return NextResponse.json({ error: "Only network parents can transfer funds" }, { status: 403 });
    await enforceRateLimit(`network:wallet:${user.id}`, RATE_LIMITS.sensitiveWrite);
    await assertLivenessReady(user);
    await assertKycCurrent(user);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    if (e instanceof RateLimitError)
      return NextResponse.json({ error: e.message, retryAfterSec: e.result.retryAfterSec }, { status: 429 });
    if (e instanceof LivenessRequiredError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode });
    if (e instanceof ReKycRequiredError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode });
    throw e;
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Please check the amount and details and try again.",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  const { childId, direction, amount, note } = parsed.data;

  const maxOp = await walletOpMaxAmount();
  if (amount > maxOp)
    return NextResponse.json(
      { error: `Amount cannot exceed ₹${formatNumber(maxOp)} per transfer` },
      { status: 400 }
    );

  if (childId === user.id)
    return NextResponse.json({ error: "Cannot transfer to yourself" }, { status: 400 });

  const child = await prisma.user.findFirst({
    where: { id: childId, parentId: user.id, deletedAt: null },
    select: { id: true, name: true, status: true, role: true },
  });
  if (!child)
    return NextResponse.json({ error: "User not found in your direct network" }, { status: 404 });
  if (child.status === "CLOSED")
    return NextResponse.json({ error: "Cannot transfer to a closed account" }, { status: 400 });

  const idempotencyBase = `nw:${user.id}:${childId}:${Date.now()}`;

  try {
    if (direction === "PUSH") {
      await prisma.$transaction(async (tx) => {
        await debitWallet(
          {
            userId: user.id,
            amount,
            reason: "PARENT_PUSH",
            refType: "NetworkWalletTransfer",
            note: `Push to ${child.name}${note ? ` — ${note}` : ""}`,
            idempotencyKey: `${idempotencyBase}:out`,
          },
          tx
        );
        await creditWallet(
          {
            userId: childId,
            amount,
            reason: "PARENT_PUSH",
            refType: "NetworkWalletTransfer",
            note: `Received from ${user.name}${note ? ` — ${note}` : ""}`,
            idempotencyKey: `${idempotencyBase}:in`,
          },
          tx
        );
        await tx.networkWalletTransfer.create({
          data: { fromId: user.id, toId: childId, direction: "PUSH", amount, note },
        });
      });
    } else {
      await prisma.$transaction(async (tx) => {
        await debitWallet(
          {
            userId: childId,
            amount,
            reason: "PARENT_PULL",
            refType: "NetworkWalletTransfer",
            note: `Pulled by ${user.name}${note ? ` — ${note}` : ""}`,
            idempotencyKey: `${idempotencyBase}:out`,
          },
          tx
        );
        await creditWallet(
          {
            userId: user.id,
            amount,
            reason: "PARENT_PULL",
            refType: "NetworkWalletTransfer",
            note: `Pull from ${child.name}${note ? ` — ${note}` : ""}`,
            idempotencyKey: `${idempotencyBase}:in`,
          },
          tx
        );
        await tx.networkWalletTransfer.create({
          data: { fromId: user.id, toId: childId, direction: "PULL", amount, note },
        });
      });
    }
  } catch (e) {
    if (e instanceof LedgerError && e.code === "INSUFFICIENT_FUNDS")
      return NextResponse.json(
        { error: direction === "PUSH" ? "Insufficient balance in your wallet" : `${child.name} has insufficient balance` },
        { status: 400 }
      );
    throw e;
  }

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: `network.wallet.${direction.toLowerCase()}`,
      entity: "NetworkWalletTransfer",
      meta: { childId, childName: child.name, direction, amount, note: note ?? null },
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true, direction, amount, childName: child.name });
}

/**
 * GET /api/network/wallet?childId=xxx
 *
 * View recent wallet transfers between the caller and a specific child, or
 * all transfer history if no childId is specified.
 */
export async function GET(req: Request) {
  let user;
  try {
    user = await requireAuth();
    if (!PARENT_ROLES.includes(user.role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const childId = searchParams.get("childId");
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize")) || 25));

  const where = {
    fromId: user.id,
    ...(childId ? { toId: childId } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.networkWalletTransfer.count({ where }),
    prisma.networkWalletTransfer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { to: { select: { id: true, name: true, role: true } } },
    }),
  ]);

  return NextResponse.json({
    transfers: rows.map((r) => ({
      id: r.id,
      child: { id: r.to.id, name: r.to.name, role: r.to.role },
      direction: r.direction,
      amount: toNumber(r.amount),
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  });
}
