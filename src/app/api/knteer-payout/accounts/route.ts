/**
 * GET  /api/knteer-payout/accounts — list saved beneficiaries (from local DB)
 * POST /api/knteer-payout/accounts — register a new beneficiary
 *
 * On POST: the full account number is AES-256-GCM encrypted at rest.
 * Only the last-4 digits are ever returned to the client.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { assertAccountActive, AccountSuspendedError } from "@/lib/security/accountGate";
import { assertKycCurrent, ReKycRequiredError } from "@/lib/security/kycGate";
import { assertLivenessReady, LivenessRequiredError } from "@/lib/security/livenessGate";
import { enforceRateLimit, RATE_LIMITS, RateLimitError } from "@/lib/security/rateLimit";
import { flags } from "@/lib/env";
import {
  listKnteerBeneficiaries,
  registerKnteerAccount,
} from "@/lib/knteer-payout/service";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["RETAILER", "DISTRIBUTOR", "MASTER_DISTRIBUTOR", "SUPER_DISTRIBUTOR", "ADMIN"]);
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_RE = /^\d{9,18}$/;

const RegisterBody = z
  .object({
    accountNumber: z.string().trim().regex(ACCOUNT_RE, "Account number must be 9–18 digits"),
    ifscCode: z.string().trim().toUpperCase().regex(IFSC_RE, "Invalid IFSC code"),
    accountHolderName: z
      .string()
      .trim()
      .min(3, "Name must be at least 3 characters")
      .max(120)
      .regex(/^[A-Za-z\s.\-]+$/, "Only letters, spaces, dots and hyphens"),
    bankName: z.string().trim().min(2, "Bank name required").max(80),
    mobile: z
      .string()
      .trim()
      .regex(/^\d{10}$/, "Enter a valid 10-digit mobile number"),
    email: z.string().trim().email("Invalid email").min(1, "Email is required"),
  })
  .strict();

// ---- GET ----

export async function GET(_req: Request) {
  let user;
  try {
    user = await requireAuth();
    if (!ALLOWED_ROLES.has(user.role))
      throw new AuthError("Bank Transfer is available for network users only", 403);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  if (!flags.knteerPayout) {
    return NextResponse.json({ error: "Bank Transfer is not enabled" }, { status: 503 });
  }

  const rows = await listKnteerBeneficiaries(user.id);
  return NextResponse.json({ beneficiaries: rows });
}

// ---- POST ----

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
      `knteer_payout:accounts:${user.id}`,
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

  const parsed = RegisterBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const result = await registerKnteerAccount({ userId: user.id, ...parsed.data });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: 502 }
    );
  }

  return NextResponse.json({ account: result.data }, { status: 201 });
}
