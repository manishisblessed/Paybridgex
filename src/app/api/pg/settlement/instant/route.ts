import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { instantSettlePgEntries } from "@/lib/settlement/pg";
import { isInstantButtonEnabled } from "@/lib/settlement/engine";

/**
 * POST /api/pg/settlement/instant
 *
 * Retailer-driven INSTANT settlement. Settles the chosen PENDING PG entries at
 * the scheme's T0 rate and credits each net immediately; anything not selected
 * stays PENDING for the next-day T+1 sweep. Only the caller's own entries are
 * ever touched, and the engine's ledger idempotency guarantees no double credit
 * even against a racing T+1 run.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    entryIds: z.array(z.string().min(1)).min(1).max(200),
  })
  .strict();

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    await enforceRateLimit(`pg:instant-settle:${user.id}`, RATE_LIMITS.txnCreate);
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (!(await isInstantButtonEnabled("PG")))
    return NextResponse.json(
      { error: "Instant settlement is currently disabled by the admin. Your collections will auto-settle on T+1." },
      { status: 403 }
    );

  try {
    const result = await instantSettlePgEntries(user.id, parsed.data.entryIds);

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "pg.settlement.instant",
        entity: "PgSettlementEntry",
        entityId: user.id,
        meta: {
          requested: result.requested,
          settled: result.settled,
          failed: result.failed,
          skipped: result.skipped,
          totalAmount: result.totalAmount,
        },
        ip: clientIp(req),
      },
    });

    return NextResponse.json(result);
  } catch (e) {
    return toErrorResponse(e);
  }
}
