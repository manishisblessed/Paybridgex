import { NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { debitWallet, LedgerError } from "@/lib/ledger";
import { encryptField, decryptField } from "@/lib/crypto/fieldEncryption";
import { enforceRateLimit, RATE_LIMITS, RateLimitError } from "@/lib/security/rateLimit";
import { assertAccountActive, AccountSuspendedError } from "@/lib/security/accountGate";
import { assertKycCurrent, ReKycRequiredError } from "@/lib/security/kycGate";
import { assertLivenessReady, LivenessRequiredError } from "@/lib/security/livenessGate";
import {
  verifyBankPennyDrop,
  recheckBankVerification,
  newBankVerifyOrderId,
} from "@/lib/payout/bankVerify";
import { clientIp } from "@/lib/security/audit";
import { dec, round, percentOf, add, toNumber } from "@/lib/money";

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_RE = /^\d{9,18}$/;

// Penny-drop fee. Base ₹4, +18% GST on top → ₹4.72 total off the wallet.
// Kept as constants here (not a Scheme slab) because it is a platform-wide
// on-us verification cost, not a customer-facing product charge.
const VERIFY_BASE = dec(4);
const VERIFY_GST = round(percentOf(VERIFY_BASE, 18));
const VERIFY_TOTAL = round(add(VERIFY_BASE, VERIFY_GST));
const VERIFY_TOTAL_PAISE = Math.round(toNumber(VERIFY_TOTAL) * 100);

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const CreateBody = z
  .object({
    accountNumber: z.string().trim().regex(ACCOUNT_RE, "Account number must be 9–18 digits"),
    confirmAccountNumber: z
      .string()
      .trim()
      .regex(ACCOUNT_RE, "Confirm account number must be 9–18 digits"),
    ifsc: z.string().trim().toUpperCase().regex(IFSC_RE, "Invalid IFSC code"),
    holderName: z
      .string()
      .trim()
      .min(3, "Beneficiary name must be at least 3 characters")
      .max(120)
      .regex(/^[A-Za-z\s.\-]+$/, "Only letters, spaces, dots and hyphens are allowed"),
    contactMobile: z
      .string()
      .trim()
      .regex(/^\d{10}$/, "Enter a valid 10-digit mobile number"),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.accountNumber !== v.confirmAccountNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmAccountNumber"],
        message: "Account numbers do not match",
      });
    }
  });

const RecheckBody = z.object({ id: z.string().min(1) }).strict();

function safe<T>(o: T) {
  return o;
}

/** Public shape returned to the client — never leaks the encrypted PII. */
function toPublic(b: {
  id: string;
  accountLast4: string;
  ifsc: string;
  holderName: string;
  verifiedName: string | null;
  contactMobile: string | null;
  isVerified: boolean;
  verificationStatus: "PENDING" | "SUCCESS" | "FAILED";
  failureReason: string | null;
  createdAt: Date;
  verifiedAt: Date | null;
}) {
  // IFSC is stored encrypted; the DB row we hand to this function already went
  // through decryption at the call site, so surface it as-is.
  return {
    id: b.id,
    accountLast4: b.accountLast4,
    ifsc: b.ifsc,
    holderName: b.holderName,
    verifiedName: b.verifiedName,
    contactMobile: b.contactMobile,
    isVerified: b.isVerified,
    verificationStatus: b.verificationStatus,
    failureReason: b.failureReason,
    createdAt: b.createdAt.toISOString(),
    verifiedAt: b.verifiedAt?.toISOString() ?? null,
  };
}

const NETWORK_ROLES = new Set(["RETAILER", "DISTRIBUTOR", "MASTER_DISTRIBUTOR", "SUPER_DISTRIBUTOR"]);

// ---------- GET: list / search current user's saved beneficiaries ----------
//
// Optional query params:
//   q            free-text search — matches holder/verified name, the FULL
//                account number (decrypted in-memory, never returned), the
//                last-4 digits, and the IFSC.
//   verifiedOnly "1" to return only bank-verified accounts (used by the
//                transfer flow so a payout can only target a verified account).
export async function GET(req: Request) {
  let user;
  try {
    user = await requireAuth();
    if (!NETWORK_ROLES.has(user.role)) throw new AuthError("Payout is available for network users only", 403);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const verifiedOnly = url.searchParams.get("verifiedOnly") === "1";
  // Collapse spaces so "SBIN 0001234" or "1234 5678" match the stored value.
  const compact = q.replace(/\s+/g, "");

  const rows = await prisma.payoutBeneficiary.findMany({
    where: { userId: user.id, ...(verifiedOnly ? { isVerified: true } : {}) },
    orderBy: [{ isVerified: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      ifsc: true,
      accountNumber: true,
      accountLast4: true,
      holderName: true,
      verifiedName: true,
      contactMobile: true,
      isVerified: true,
      verificationStatus: true,
      failureReason: true,
      createdAt: true,
      verifiedAt: true,
    },
  });

  const matched = rows.filter((r) => {
    if (!q) return true;
    const ifscPlain = safeDecrypt(r.ifsc).toLowerCase();
    const accPlain = safeDecrypt(r.accountNumber).toLowerCase();
    const name = (r.verifiedName || r.holderName || "").toLowerCase();
    return (
      name.includes(q) ||
      accPlain.includes(compact) ||
      r.accountLast4.includes(compact) ||
      ifscPlain.includes(compact)
    );
  });

  // Strip the encrypted accountNumber before shaping the public payload.
  const decrypted = matched.map(({ accountNumber: _enc, ...r }) =>
    toPublic({ ...r, ifsc: safeDecrypt(r.ifsc) })
  );

  return NextResponse.json({
    fee: {
      base: toNumber(VERIFY_BASE),
      gst: toNumber(VERIFY_GST),
      total: toNumber(VERIFY_TOTAL),
      gstPercent: 18,
    },
    beneficiaries: decrypted,
  });
}

// ---------- POST: verify + create a new beneficiary ----------
export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    if (!NETWORK_ROLES.has(user.role)) throw new AuthError("Payout is available for network users only", 403);
    await assertAccountActive(user.id);
    await assertLivenessReady(user);
    await assertKycCurrent(user);
    await enforceRateLimit(`payout:bene:create:${user.id}`, RATE_LIMITS.payoutCreate);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.statusCode });
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

  const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;

  const accountLast4 = body.accountNumber.slice(-4);
  const encAccount = encryptField(body.accountNumber);
  const encIfsc = encryptField(body.ifsc);

  // Deduplicate: if the same (user, account, ifsc) already exists, do NOT
  // charge again — return the existing row so the UI can just resume.
  const existing = await prisma.payoutBeneficiary.findUnique({
    where: {
      userId_accountNumber_ifsc: {
        userId: user.id,
        accountNumber: encAccount,
        ifsc: encIfsc,
      },
    },
  });
  if (existing) {
    return NextResponse.json({
      alreadyExists: true,
      beneficiary: toPublic({ ...existing, ifsc: body.ifsc }),
    });
  }

  const orderId = newBankVerifyOrderId();

  // 1) Debit ₹4 + 18% GST from the user's wallet. If they can't afford it,
  //    reject BEFORE calling the provider (no wasted attempts).
  let walletTxnId: string | null = null;
  try {
    const txn = await debitWallet({
      userId: user.id,
      amount: VERIFY_TOTAL,
      reason: "FEE",
      refType: "PayoutBeneficiary.verification",
      refId: orderId,
      note: `Bank account verification (₹${toNumber(VERIFY_BASE)} + 18% GST)`,
      idempotencyKey: `payoutBeneVerify:${user.id}:${orderId}`,
    });
    walletTxnId = txn.id;
  } catch (e) {
    if (e instanceof LedgerError && e.code === "INSUFFICIENT_FUNDS") {
      return NextResponse.json(
        { error: `Insufficient wallet balance for ₹${toNumber(VERIFY_TOTAL)} verification fee.` },
        { status: 400 }
      );
    }
    throw e;
  }

  // 2) Kick off the penny-drop verification.
  let result;
  try {
    result = await verifyBankPennyDrop({
      accountNumber: body.accountNumber,
      ifsc: body.ifsc,
      holderName: body.holderName,
      contactMobile: body.contactMobile,
      orderId,
    });
  } catch (err) {
    result = {
      status: "FAILED" as const,
      nameAtBank: null,
      orderId,
      utr: null,
      failureReason: err instanceof Error ? err.message : "Verification provider unreachable",
      pendingMessage: null,
    };
  }

  const created = await prisma.payoutBeneficiary.create({
    data: {
      userId: user.id,
      accountNumber: encAccount,
      ifsc: encIfsc,
      accountLast4,
      holderName: body.holderName,
      contactMobile: body.contactMobile,
      verifiedName: result.nameAtBank,
      isVerified: result.status === "SUCCESS",
      verificationStatus: result.status,
      verificationOrderId: orderId,
      verificationUtr: result.utr ?? null,
      verificationChargeInPaise: VERIFY_TOTAL_PAISE,
      verificationWalletTxnId: walletTxnId,
      failureReason: result.failureReason ?? null,
      verifiedAt: result.status === "SUCCESS" ? new Date() : null,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "payout.beneficiary.verify",
      entity: "PayoutBeneficiary",
      entityId: created.id,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent") ?? undefined,
      meta: safe({
        orderId,
        outcome: result.status,
        accountLast4,
        chargeInPaise: VERIFY_TOTAL_PAISE,
      }),
    },
  });

  return NextResponse.json({
    beneficiary: toPublic({ ...created, ifsc: body.ifsc }),
    pendingMessage: result.pendingMessage,
    charge: {
      base: toNumber(VERIFY_BASE),
      gst: toNumber(VERIFY_GST),
      total: toNumber(VERIFY_TOTAL),
    },
  });
}

// ---------- PATCH: re-check a PENDING verification ----------
export async function PATCH(req: Request) {
  let user;
  try {
    user = await requireAuth();
    if (!NETWORK_ROLES.has(user.role)) throw new AuthError("Payout is available for network users only", 403);
    await assertAccountActive(user.id);
    await enforceRateLimit(`payout:bene:recheck:${user.id}`, RATE_LIMITS.payoutCreate);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.statusCode });
    if (e instanceof AccountSuspendedError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode });
    if (e instanceof RateLimitError)
      return NextResponse.json({ error: e.message, retryAfterSec: e.result.retryAfterSec }, { status: 429 });
    throw e;
  }

  const parsed = RecheckBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const row = await prisma.payoutBeneficiary.findFirst({
    where: { id: parsed.data.id, userId: user.id },
  });
  if (!row) return NextResponse.json({ error: "Beneficiary not found" }, { status: 404 });

  if (row.isVerified) {
    return NextResponse.json({ beneficiary: toPublic({ ...row, ifsc: safeDecrypt(row.ifsc) }) });
  }

  const orderId = row.verificationOrderId ?? newBankVerifyOrderId();
  const ifscPlain = safeDecrypt(row.ifsc);

  const result = await recheckBankVerification({
    orderId,
    accountNumber: safeDecrypt(row.accountNumber),
    ifsc: ifscPlain,
    holderName: row.holderName,
  });

  const updated = await prisma.payoutBeneficiary.update({
    where: { id: row.id },
    data: {
      verificationStatus: result.status,
      isVerified: result.status === "SUCCESS",
      verifiedName: result.nameAtBank ?? row.verifiedName,
      verificationUtr: result.utr ?? row.verificationUtr,
      failureReason: result.failureReason ?? row.failureReason,
      verificationOrderId: orderId,
      verifiedAt: result.status === "SUCCESS" ? new Date() : row.verifiedAt,
    },
  });

  return NextResponse.json({
    beneficiary: toPublic({ ...updated, ifsc: ifscPlain }),
    pendingMessage: result.pendingMessage,
  });
}

// ---------- DELETE: remove a beneficiary ----------
export async function DELETE(req: Request) {
  let user;
  try {
    user = await requireAuth();
    if (!NETWORK_ROLES.has(user.role)) throw new AuthError("Payout is available for network users only", 403);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const row = await prisma.payoutBeneficiary.findFirst({
    where: { id, userId: user.id },
  });
  if (!row) return NextResponse.json({ error: "Beneficiary not found" }, { status: 404 });

  await prisma.payoutBeneficiary.delete({ where: { id: row.id } });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "payout.beneficiary.delete",
      entity: "PayoutBeneficiary",
      entityId: row.id,
      meta: { accountLast4: row.accountLast4 },
    },
  });

  return NextResponse.json({ ok: true });
}

/** Decrypt a `v1:`-tagged field; fall back to the raw value for legacy rows. */
function safeDecrypt(value: string): string {
  if (!value?.startsWith?.("v1:")) return value;
  try {
    return decryptField(value);
  } catch {
    return value;
  }
}
