import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-server";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { rechargekitStatus } from "@/lib/partners/sameday-rechargekit";
import { friendlyPartnerError } from "@/lib/partners/friendlyError";
import { AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { finalizeServiceTransaction, FINALIZABLE_TXN_SELECT } from "@/lib/services/finalize";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "rechargekit/status" });

const Body = z
  .object({
    txnId: z.string().min(1).optional(),
    requestId: z.string().min(1).optional(),
  })
  .strict()
  .refine((d) => d.txnId || d.requestId, {
    message: "Either txnId or requestId is required",
  });

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * POST /api/services/rechargekit/status
 *
 * Polls the status of a RechargeKit CC-2 payment. Use this:
 *   - When pay returns PENDING (poll every 30s, max 10 retries)
 *   - When pay times out or has a network error (immediately, with request_id)
 *   - NEVER retry pay on timeout — use this endpoint instead
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    if (user.role !== "RETAILER") throw new AuthError("Credit Card Bill Payment-2 is available for retailers only", 403);
    await enforceRateLimit(`rk:status:${user.id}`, RATE_LIMITS.default);
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const result = await rechargekitStatus(parsed.data);

  if (!result.ok) {
    return NextResponse.json(
      { error: friendlyPartnerError(result.code, result.message, "fetch"), code: result.code },
      { status: 502 }
    );
  }

  // Self-heal: the poll above is an AUTHORITATIVE provider read, so if it reports
  // a terminal state, finalize this retailer's own stuck PROCESSING row NOW
  // (settle → book margin, or FAILED/REFUNDED → auto-refund the reserve) instead
  // of only reporting it back. Without this a retailer who "checked status" saw
  // the money released nowhere and the row stayed PROCESSING until the sweep.
  // finalizeServiceTransaction is idempotent (status-claim + keyed ledger), so a
  // race with the webhook/sweep is a safe no-op.
  const st = result.data.status;
  if (st === "SUCCESS" || st === "FAILED" || st === "REFUNDED") {
    try {
      const refs = Array.from(
        new Set(
          [parsed.data.txnId, parsed.data.requestId, result.data.txnId, result.data.requestId]
            .map((v) => (typeof v === "string" ? v.trim() : ""))
            .filter((v) => v.length > 0)
        )
      );
      if (refs.length > 0) {
        const row = await prisma.transaction.findFirst({
          // Scope to THIS retailer's RechargeKit row — a retailer can only ever
          // finalize their own transaction.
          where: {
            userId: user.id,
            partner: "SAMEDAY_RECHARGEKIT",
            partnerTxnId: { in: refs },
          },
          select: FINALIZABLE_TXN_SELECT,
        });
        if (row && (row.status === "INITIATED" || row.status === "PROCESSING")) {
          await finalizeServiceTransaction({
            txn: row,
            status: st,
            partnerTxnId: result.data.txnId || refs[0],
            raw: result.raw,
            source: "retailer_status",
          });
        }
      }
    } catch (e) {
      // Never fail the status response on a finalize hiccup — the sweep/webhook
      // remain the safety net and will settle it on the next trigger.
      log.warn({ userId: user.id, err: String(e) }, "retailer status self-heal finalize failed");
    }
  }

  return NextResponse.json(result.data);
}
