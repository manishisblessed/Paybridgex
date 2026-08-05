import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { assertLivenessReady } from "@/lib/security/livenessGate";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { initiatePgCollect, PgCollectError } from "@/lib/wallet/pgCollect";

const Body = z.object({
  amount: z.number().positive().max(100000),
  vpa: z.string().optional(),
  note: z.string().max(80).optional(),
  customerEmail: z.string().email().optional(),
  customerPhone: z.string().min(10),
  idempotencyKey: z.string().min(8)
}).strict();

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    // Onboarding liveness gate — network users must have a face baseline first.
    await assertLivenessReady(user);
    await assertServiceEnabled(SERVICE_KEYS.UPI, { name: "UPI Collect", userId: user.id, role: user.role });
    await enforceRateLimit(`upi:collect:${user.id}`, RATE_LIMITS.txnCreate);
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // Persist a UPI_COLLECT Transaction (refId `PGC…`) and fire the provider
  // collect. The inbound credit posts to the ledger later — the BulkPe PG
  // webhook / status poll resolve this reference and settle it through the PG
  // engine (net credit + company payin mirror).
  try {
    const collect = await initiatePgCollect({
      userId: user.id,
      amount: parsed.data.amount,
      vpa: parsed.data.vpa,
      note: parsed.data.note,
      customerEmail: parsed.data.customerEmail,
      customerPhone: parsed.data.customerPhone,
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
    });
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "upi.collect_requested",
        entity: "Transaction",
        entityId: collect.refId,
        meta: { amount: parsed.data.amount, orderId: collect.orderId },
      },
    });
    return NextResponse.json(collect);
  } catch (e) {
    const err = e instanceof PgCollectError ? e : null;
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "upi.collect_failed",
        entity: "UpiCollect",
        entityId: parsed.data.idempotencyKey,
        meta: { amount: parsed.data.amount, ok: false, code: err?.code ?? "PG_COLLECT_ERROR" },
      },
    });
    return NextResponse.json(
      { error: err?.message ?? "Collection failed", code: err?.code ?? "PG_COLLECT_ERROR" },
      { status: err?.statusCode ?? 502 }
    );
  }
}
