import { NextResponse } from "next/server";
import { z } from "zod";
import { getPartner } from "@/lib/partners";
import { runTransaction } from "@/lib/services/transaction";
import { requireAuth } from "@/lib/auth-server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireStepUp, readStepUpCode } from "@/lib/security/stepUp";
import { requireTxnPin } from "@/lib/security/txnPin";
import { assertLivenessReady } from "@/lib/security/livenessGate";
import { clientIp } from "@/lib/security/audit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";

const Body = z.object({
  aadhaar: z.string().min(12).max(14),
  bankIin: z.string().min(3),
  amount: z.number().positive().max(10000),
  biometric: z.object({ type: z.enum(["FMR", "FIR"]), data: z.string().min(8) }).strict(),
  idempotencyKey: z.string().min(8),
  stepUpCode: z.string().max(20).optional(),
  stepUpType: z.enum(["totp", "backup"]).optional()
}).strict();

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    // Admin kill-switch + per-user allowlist (default-disabled) for this rail.
    await assertServiceEnabled(SERVICE_KEYS.AEPS, { name: "AePS", userId: user.id, role: user.role });
    // Onboarding liveness gate — network users must have a face baseline first.
    await assertLivenessReady(user);
    await enforceRateLimit(`txn:create:${user.id}`, RATE_LIMITS.txnCreate);
    // Transaction PIN — required on every money-moving action (x-txn-pin header).
    await requireTxnPin(user, req, { action: "aeps.withdraw", ip: clientIp(req), userAgent: req.headers.get("user-agent") });
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // Step-up 2FA on cash withdrawal (no-op unless SECURITY_STEPUP_ENABLED).
  try {
    const { code, type } = readStepUpCode(req, parsed.data);
    await requireStepUp(user, {
      action: "aeps.withdraw",
      code: code ?? parsed.data.stepUpCode,
      type: parsed.data.stepUpType ?? type,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent")
    });
  } catch (e) {
    return toErrorResponse(e);
  }

  const aeps = getPartner("aeps");
  try {
    const result = await runTransaction({
      userId: user.id,
      service: "AEPS_WITHDRAW",
      amount: parsed.data.amount,
      fee: 0,
      // No commission is set here. AePS withdrawal is not a commission-eligible
      // service in the distribution engine (only PG/POS/QR earn), so the runner
      // already resolves + persists the real credited commission (₹0) on success.
      // The previous hardcoded "min(₹12, 0.5%)" was a placeholder that was never
      // actually paid out and corrupted the analytics/earnings reports.
      idempotencyKey: parsed.data.idempotencyKey,
      customer: parsed.data.aadhaar.slice(-4),
      operator: parsed.data.bankIin,
      partner: aeps.name,
      request: parsed.data,
      ip: clientIp(req),
      call: () =>
        aeps.withdraw({
          userId: user.id,
          idempotencyKey: parsed.data.idempotencyKey,
          aadhaar: parsed.data.aadhaar,
          bankIin: parsed.data.bankIin,
          amount: parsed.data.amount,
          biometric: parsed.data.biometric
        })
    });

    return NextResponse.json(result, { status: result.status === "SUCCESS" ? 200 : 502 });
  } catch (e) {
    return toErrorResponse(e);
  }
}
