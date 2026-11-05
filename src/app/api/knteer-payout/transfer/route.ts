/**
 * POST /api/knteer-payout/transfer  — Bank Transfer (Knteer rail)
 *
 * Mirrors /api/payout exactly, but:
 *   - prices from the KNTEER_PAYOUT scheme slabs (separate product pricing),
 *   - disburses over the Same Day Knteer Payout API (PayoutRequest.rail="KNTEER"),
 *   - targets a pre-registered KnteerBeneficiary (account number decrypted
 *     server-side only — the client only ever sends beneficiaryId).
 *
 * Money-safety is inherited from the shared PayoutRequest lifecycle:
 *   holdFunds(totalDebit) on submit → captureHold on SUCCESS → releaseHold on
 *   definitive FAILED → NEEDS_REVIEW (hold retained) on indeterminate.
 *
 * Business rules enforced here:
 *   - No transfer unless a matching KNTEER_PAYOUT slab prices it (fail closed).
 *   - Amount may not exceed the slab ceiling.
 *   - User wallet is debited amount + slab charge + GST.
 *   - No second transfer to the SAME account within 30 minutes.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { flags } from "@/lib/env";
import { holdFunds, LedgerError } from "@/lib/ledger";
import { toNumber, dec, gt, type Money } from "@/lib/money";
import { encryptField, decryptField } from "@/lib/crypto/fieldEncryption";
import { assertKycCurrent, ReKycRequiredError } from "@/lib/security/kycGate";
import { assertLivenessReady, LivenessRequiredError } from "@/lib/security/livenessGate";
import { assertAccountActive, AccountSuspendedError } from "@/lib/security/accountGate";
import { enforceRateLimit, RATE_LIMITS, RateLimitError } from "@/lib/security/rateLimit";
import { withIdempotency, IdempotencyInProgressError } from "@/lib/idempotency";
import { requireSubmitNonce, SubmitNonceError } from "@/lib/security/submitNonce";
import { requireTxnPin, TxnPinError } from "@/lib/security/txnPin";
import { assertTransactionRisk, RiskError } from "@/lib/risk/engine";
import { clientIp } from "@/lib/security/audit";
import { assertServiceEnabled, ServiceDisabledError } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { requireActiveScheme, NoSchemeError } from "@/lib/scheme/gate";
import { getSchemeLimit, PricingUnavailableError } from "@/lib/scheme/resolver";
import { quoteKnteerForUser } from "@/lib/knteer-payout/charges";
import { enqueuePayoutInitiate } from "@/lib/payout/service";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const NETWORK_ROLES = new Set([
  "RETAILER",
  "DISTRIBUTOR",
  "MASTER_DISTRIBUTOR",
  "SUPER_DISTRIBUTOR",
]);

// No second transfer to the SAME account within this window (business rule).
// Env-tunable; defaults to 30 minutes.
const KNTEER_DUP_GUARD_COOLDOWN_SEC = Number(
  process.env.KNTEER_DUP_GUARD_COOLDOWN_SEC ?? 30 * 60
);

const TransferBody = z
  .object({
    beneficiaryId: z.string().min(1, "beneficiaryId is required"),
    amount: z
      .number({ invalid_type_error: "amount must be a number" })
      .positive("amount must be positive")
      .max(500000),
    paymentMode: z.enum(["IMPS", "NEFT"]).default("IMPS"),
    remarks: z.string().trim().max(100).optional(),
  })
  .strict();

export async function POST(req: Request) {
  if (!flags.knteerPayout) {
    return NextResponse.json({ error: "Bank Transfer is currently disabled" }, { status: 503 });
  }

  let user;
  try {
    user = await requireAuth();
    if (!NETWORK_ROLES.has(user.role))
      return NextResponse.json(
        { error: "Bank Transfer is available for network users only" },
        { status: 403 }
      );
    await assertAccountActive(user.id);
    await assertLivenessReady(user);
    await assertKycCurrent(user);
    await assertServiceEnabled(SERVICE_KEYS.KNTEER_PAYOUT, {
      name: "Bank Transfer",
      userId: user.id,
      role: user.role,
    });
    await requireActiveScheme(user.id);
    await enforceRateLimit(`knteer_payout:transfer:${user.id}`, RATE_LIMITS.payoutCreate);
    await requireSubmitNonce(req, user.id);
    await requireTxnPin(user, req, {
      action: "knteer_payout.transfer",
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });
  } catch (e) {
    if (e instanceof TxnPinError)
      return NextResponse.json({ error: e.message, txnPin: true, code: e.code }, { status: e.statusCode });
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.statusCode });
    if (e instanceof AccountSuspendedError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode });
    if (e instanceof LivenessRequiredError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode });
    if (e instanceof ReKycRequiredError)
      return NextResponse.json({ error: e.message, code: e.code, reKycDueAt: e.dueAt }, { status: e.statusCode });
    if (e instanceof ServiceDisabledError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    if (e instanceof NoSchemeError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode });
    if (e instanceof RateLimitError)
      return NextResponse.json({ error: e.message, retryAfterSec: e.result.retryAfterSec }, { status: 429 });
    if (e instanceof SubmitNonceError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const parsed = TransferBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;

  // ── Resolve beneficiary (must be the caller's own, registered) ─────────────
  const bene = await prisma.knteerBeneficiary.findFirst({
    where: { id: body.beneficiaryId, userId: user.id },
  });
  if (!bene) return NextResponse.json({ error: "Beneficiary not found" }, { status: 404 });
  if (!bene.isRegistered) {
    return NextResponse.json(
      { error: "This account is not registered yet. Please register it before transferring." },
      { status: 400 }
    );
  }

  let accountNumber: string;
  try {
    accountNumber = decryptField(bene.accountNumber);
  } catch {
    return NextResponse.json(
      { error: "Beneficiary data could not be read. Please delete and re-add it." },
      { status: 500 }
    );
  }

  // ── Scheme ceiling (max amount per slab) ───────────────────────────────────
  const schemeLimit: Money | null = await getSchemeLimit(user.id, "KNTEER_PAYOUT");
  if (schemeLimit && gt(dec(body.amount), schemeLimit)) {
    return NextResponse.json(
      { error: `Amount exceeds the maximum allowed limit of ₹${schemeLimit.toNumber().toLocaleString("en-IN")}` },
      { status: 400 }
    );
  }

  // ── Fail-closed pricing: no matching KNTEER_PAYOUT slab → reject ───────────
  let quote;
  try {
    quote = await quoteKnteerForUser(user.id, body.amount, { requireScheme: true });
  } catch (e) {
    if (e instanceof PricingUnavailableError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode });
    throw e;
  }

  // ── Risk rules (shared PAYOUT velocity / caps) ─────────────────────────────
  try {
    await assertTransactionRisk({
      userId: user.id,
      service: "PAYOUT",
      amount: quote.totalDebit,
      baseAmount: body.amount,
      newBeneficiaryCapOverride: schemeLimit ? schemeLimit.toNumber() : null,
      beneficiary: { accountLast4: bene.accountLast4, mode: body.paymentMode },
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });
  } catch (e) {
    if (e instanceof RiskError)
      return NextResponse.json({ error: e.message, code: e.code, rule: e.rule }, { status: e.statusCode });
    throw e;
  }

  // ── 30-minute same-account cooldown (business rule) ────────────────────────
  // Only a prior NON-FAILED transfer gates: a FAILED row released its hold and
  // carries no double-disburse risk, so it must not block a genuine retry.
  const dupSince = new Date(Date.now() - KNTEER_DUP_GUARD_COOLDOWN_SEC * 1000);
  const recent = await prisma.payoutRequest.findFirst({
    where: {
      userId: user.id,
      rail: "KNTEER",
      accountLast4: bene.accountLast4,
      status: { in: ["APPROVED", "PROCESSING", "NEEDS_REVIEW", "SUCCESS"] },
      createdAt: { gte: dupSince },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true },
  });
  if (recent) {
    const waitSec = Math.max(
      1,
      KNTEER_DUP_GUARD_COOLDOWN_SEC - Math.floor((Date.now() - recent.createdAt.getTime()) / 1000)
    );
    const waitMin = Math.ceil(waitSec / 60);
    return NextResponse.json(
      {
        error: `A transfer to this account was made recently. To prevent a duplicate, any transfer to the same account is blocked for ${Math.round(KNTEER_DUP_GUARD_COOLDOWN_SEC / 60)} minutes — please wait about ${waitMin} more minute${waitMin === 1 ? "" : "s"} and try again.`,
        code: "DUPLICATE_COOLDOWN",
        payoutId: recent.id,
        retryAfterSec: waitSec,
      },
      { status: 429 }
    );
  }

  // ── Create (hold funds + PayoutRequest), then enqueue the rail call ────────
  const idemKey = req.headers.get("Idempotency-Key") || req.headers.get("idempotency-key") || nanoid();

  try {
    const result = await withIdempotency(
      { key: idemKey, scope: "knteer_payout.transfer", userId: user.id },
      async () => {
        const providerReferenceId = `PO${nanoid(18).toUpperCase()}`;

        const created = await prisma.$transaction(async (tx) => {
          await holdFunds({ userId: user.id, amount: quote.totalDebit }, tx);
          return tx.payoutRequest.create({
            data: {
              userId: user.id,
              makerId: user.id,
              rail: "KNTEER",
              knteerBeneficiaryId: bene.id,
              beneficiaryName: bene.accountHolderName,
              accountNumber: encryptField(accountNumber),
              ifsc: encryptField(bene.ifscCode),
              accountLast4: bene.accountLast4,
              mode: body.paymentMode,
              amount: quote.amount,
              serviceCharge: quote.serviceCharge,
              gst: quote.gst,
              gstRate: quote.gstRate,
              totalDebit: quote.totalDebit,
              vendorCharge: quote.vendorCharge,
              status: "APPROVED",
              approvedAt: new Date(),
              providerReferenceId,
            },
          });
        });

        await prisma.auditLog.create({
          data: {
            userId: user.id,
            action: "knteer_payout.submitted",
            entity: "PayoutRequest",
            entityId: created.id,
            ip: clientIp(req),
            userAgent: req.headers.get("user-agent") ?? undefined,
            meta: {
              rail: "KNTEER",
              mode: created.mode,
              amount: toNumber(created.amount),
              totalDebit: toNumber(created.totalDebit),
              accountLast4: created.accountLast4,
              beneficiaryId: bene.id,
            },
          },
        });

        await enqueuePayoutInitiate(created.id);

        return {
          id: created.id,
          rail: "KNTEER",
          mode: created.mode,
          beneficiaryName: created.beneficiaryName,
          accountLast4: created.accountLast4,
          bankName: bene.bankName,
          amount: toNumber(created.amount),
          serviceCharge: toNumber(created.serviceCharge),
          gst: toNumber(created.gst),
          totalDebit: toNumber(created.totalDebit),
          status: created.status,
          createdAt: created.createdAt.toISOString(),
        };
      }
    );

    return NextResponse.json({ transfer: result }, { status: 201 });
  } catch (e) {
    if (e instanceof IdempotencyInProgressError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    if (e instanceof LedgerError && e.code === "INSUFFICIENT_FUNDS")
      return NextResponse.json(
        { error: "Insufficient spendable balance for this transfer" },
        { status: 400 }
      );
    throw e;
  }
}
