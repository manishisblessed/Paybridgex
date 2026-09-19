import { NextResponse } from "next/server";
import { z } from "zod";
import { getPartner } from "@/lib/partners";
import { runTransaction } from "@/lib/services/transaction";
import { requireAuth } from "@/lib/auth-server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertLivenessReady } from "@/lib/security/livenessGate";
import { requireTxnPin } from "@/lib/security/txnPin";
import { clientIp } from "@/lib/security/audit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";

const Body = z.object({
  type: z.enum(["MOBILE", "DTH", "BROADBAND"]),
  operatorCode: z.string().min(2),
  number: z.string().min(6),
  amount: z.number().positive().max(10000),
  circle: z.string().optional(),
  idempotencyKey: z.string().min(8)
}).strict();

const SERVICE = { MOBILE: "RECHARGE_MOBILE", DTH: "RECHARGE_DTH", BROADBAND: "RECHARGE_BROADBAND" } as const;

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    // Admin kill-switch + per-user allowlist (default-disabled) for this rail.
    await assertServiceEnabled(SERVICE_KEYS.RECHARGE, { name: "Recharges", userId: user.id, role: user.role });
    // Onboarding liveness gate — network users must have a face baseline first.
    await assertLivenessReady(user);
    await enforceRateLimit(`txn:create:${user.id}`, RATE_LIMITS.txnCreate);
    // Transaction PIN — required on every money-moving action (x-txn-pin header).
    await requireTxnPin(user, req, { action: "recharge", ip: clientIp(req), userAgent: req.headers.get("user-agent") });
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const partner = getPartner("recharge");
  try {
    const result = await runTransaction({
      userId: user.id,
      service: SERVICE[parsed.data.type],
      amount: parsed.data.amount,
      // No commission is set here. Recharge is not a commission-eligible service
      // in the distribution engine (only PG/POS/QR earn), so the runner already
      // resolves + persists the real credited commission (₹0) on success. The
      // previous hardcoded "3% of amount" was a placeholder that was never
      // actually paid out and corrupted the analytics/earnings reports.
      idempotencyKey: parsed.data.idempotencyKey,
      customer: parsed.data.number,
      operator: parsed.data.operatorCode,
      partner: partner.name,
      request: parsed.data,
      call: () => partner.recharge({ userId: user.id, ...parsed.data })
    });

    return NextResponse.json(result, { status: result.status === "SUCCESS" ? 200 : 502 });
  } catch (e) {
    return toErrorResponse(e);
  }
}
