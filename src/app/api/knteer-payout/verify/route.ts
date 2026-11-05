/**
 * POST /api/knteer-payout/verify
 *
 * eKYC Hub penny-less bank account verification (₹4.72 on success).
 * Called BEFORE registering a beneficiary so the user gets the verified name
 * and can confirm the account holder matches their intent.
 *
 * Body: { accountNumber, ifscCode, bankName? }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { assertAccountActive, AccountSuspendedError } from "@/lib/security/accountGate";
import { assertKycCurrent, ReKycRequiredError } from "@/lib/security/kycGate";
import { assertLivenessReady, LivenessRequiredError } from "@/lib/security/livenessGate";
import { enforceRateLimit, RATE_LIMITS, RateLimitError } from "@/lib/security/rateLimit";
import { flags } from "@/lib/env";
import { verifyKnteerAccount } from "@/lib/knteer-payout/service";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["RETAILER", "DISTRIBUTOR", "MASTER_DISTRIBUTOR", "SUPER_DISTRIBUTOR", "ADMIN"]);

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_RE = /^\d{9,18}$/;

const VerifyBody = z
  .object({
    accountNumber: z.string().trim().regex(ACCOUNT_RE, "Account number must be 9–18 digits"),
    ifscCode: z.string().trim().toUpperCase().regex(IFSC_RE, "Invalid IFSC code"),
    bankName: z.string().trim().optional(),
  })
  .strict();

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    if (!ALLOWED_ROLES.has(user.role))
      throw new AuthError("Bank Transfer is available for network users only", 403);
    await assertAccountActive(user.id);
    await assertLivenessReady(user);
    await assertKycCurrent(user);
    await enforceRateLimit(
      `knteer_payout:verify:${user.id}`,
      RATE_LIMITS.payoutCreate
    );
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    if (e instanceof AccountSuspendedError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode });
    if (e instanceof LivenessRequiredError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode });
    if (e instanceof ReKycRequiredError)
      return NextResponse.json({ error: e.message, code: e.code, reKycDueAt: e.dueAt }, { status: e.statusCode });
    if (e instanceof RateLimitError)
      return NextResponse.json({ error: e.message, retryAfterSec: e.result.retryAfterSec }, { status: 429 });
    throw e;
  }

  if (!flags.knteerPayout) {
    return NextResponse.json({ error: "Bank Transfer is not enabled" }, { status: 503 });
  }

  const parsed = VerifyBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const result = await verifyKnteerAccount(parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.code === "INVALID_ACCOUNT" ? 422 : 502 }
    );
  }

  return NextResponse.json({ verification: result.data });
}
