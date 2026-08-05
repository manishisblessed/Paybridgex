import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import {
  createReversal,
  reversalInputFromTransaction,
  canManageReversals,
  canViewReversals,
  ReversalError,
} from "@/lib/reversal/service";
import { dec, toNumber } from "@/lib/money";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/** GET — reversal history with status filter + lookup helper. */
export async function GET(req: Request) {
  try {
    const admin = await requireAuth();
    if (!canViewReversals(admin))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const url = new URL(req.url);

    // Lookup mode: resolve a transaction refId into prefill values.
    const lookup = url.searchParams.get("lookup");
    if (lookup) {
      const prefill = await reversalInputFromTransaction(lookup.trim());
      if (!prefill)
        return NextResponse.json({ error: "No transaction found for that reference" }, { status: 404 });
      const owner = await prisma.user.findUnique({
        where: { id: prefill.targetUserId },
        select: { name: true, email: true },
      });
      return NextResponse.json({ prefill: { ...prefill, owner } });
    }

    const status = url.searchParams.get("status") ?? "all";
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = 25;

    const where = status !== "all" ? { status: status as never } : {};
    const [rows, total] = await Promise.all([
      prisma.reversal.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.reversal.count({ where }),
    ]);

    const userIds = Array.from(
      new Set(rows.flatMap((r) => [r.targetUserId, r.actorId, r.approvedById]).filter((v): v is string => Boolean(v)))
    );
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    return NextResponse.json({
      reversals: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        refType: r.refType,
        refId: r.refId,
        refLabel: r.refLabel,
        direction: r.direction,
        walletType: r.walletType,
        amount: toNumber(dec(r.amount)),
        reason: r.reason,
        status: r.status,
        rejectedNote: r.rejectedNote,
        createdAt: r.createdAt.toISOString(),
        target: userMap.get(r.targetUserId) ?? { id: r.targetUserId, name: "—", email: "" },
        maker: userMap.get(r.actorId) ?? null,
        checker: r.approvedById ? userMap.get(r.approvedById) ?? null : null,
      })),
      total,
      page,
      pageSize,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/reversals] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const CreateBody = z.object({
  kind: z.enum(["TRANSACTION", "SETTLEMENT", "AEPS", "WALLET_ENTRY"]),
  refType: z.string().min(1).max(40),
  refId: z.string().min(1),
  refLabel: z.string().max(60).optional(),
  targetUserId: z.string().min(1),
  direction: z.enum(["CREDIT", "DEBIT"]),
  walletType: z.enum(["PRIMARY", "AEPS"]).default("PRIMARY"),
  amount: z.number().positive(),
  reason: z.string().min(5).max(300),
});

/** POST — raise a reversal (executes immediately for the actor). */
export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }
  if (!canManageReversals(admin))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const rev = await createReversal({ actorId: admin.id, ...parsed.data });
    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "reversal.created",
        entity: "Reversal",
        entityId: rev.id,
        meta: {
          kind: rev.kind,
          refId: rev.refId,
          targetUserId: rev.targetUserId,
          direction: rev.direction,
          amount: toNumber(dec(rev.amount)),
          status: rev.status,
        },
        ip: clientIp(req),
      },
    });
    return NextResponse.json({ ok: true, reversal: { id: rev.id, status: rev.status } }, { status: 201 });
  } catch (e) {
    if (e instanceof ReversalError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[admin/reversals] POST error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
