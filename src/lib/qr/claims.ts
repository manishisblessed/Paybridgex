/**
 * Static QR collections — claim verification & settlement (no provider webhook).
 *
 * Trust model: a screenshot is only a CLAIM, never proof. Money is credited
 * exclusively after a human admin attests the UTR exists in the third-party
 * provider's merchant portal (`portalVerified`), and large amounts need a
 * second, different admin (maker-checker). What the software guarantees:
 *
 *   - One UPI payment settles at most once, platform-wide: `utr` is UNIQUE.
 *   - One screenshot backs at most one claim: `screenshotHash` is UNIQUE.
 *   - The wallet credit is idempotent (`qrclaim:<id>`) and gated on a
 *     status-transition claim, so racing admins cannot double-credit.
 *   - Velocity caps make spray-and-pray fraud attempts expensive.
 *
 * Phase-2 hooks (`settlementBatchId`, `reconciledAt`) let a future recon job
 * match APPROVED claims against the provider's settlement file and claw back
 * anything that never settled.
 */
import { Prisma, type QrClaimStatus } from "@prisma/client";
import { createHash } from "crypto";
import { prisma } from "../db";
import { creditWallet, debitWallet } from "../ledger";
import { round, toNumber } from "../money";
import { getSetting } from "../settings";
import { priceSchemeSettlement, startOfTodayIst, SETTLED_VIA } from "../settlement/engine";
import { railScopeKey } from "../mdr/floor";

export class QrClaimError extends Error {
  public statusCode: number;
  constructor(message: string, statusCode = 400, public code = "QR_CLAIM_ERROR") {
    super(message);
    this.name = "QrClaimError";
    this.statusCode = statusCode;
  }
}

// ── Limits (env-overridable; sane defaults) ─────────────────────────────────

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Max single-claim amount. */
export function maxClaimAmount(): number {
  return num(process.env.QR_CLAIM_MAX_AMOUNT, 100_000);
}
/** Claims above this need a second, different admin approval. */
export function secondApprovalThreshold(): number {
  return num(process.env.QR_CLAIM_SECOND_APPROVAL_THRESHOLD, 10_000);
}
/** Max claims a user may file per calendar day (any status — attempts count). */
export function dailyClaimCountLimit(): number {
  return num(process.env.QR_CLAIM_DAILY_LIMIT_COUNT, 10);
}
/** Max total amount a user may claim per calendar day. */
export function dailyClaimAmountLimit(): number {
  return num(process.env.QR_CLAIM_DAILY_LIMIT_AMOUNT, 200_000);
}

/** How far back a payment may be dated. */
export const QR_CLAIM_MAX_AGE_DAYS = 7;
/** Clock-skew allowance for "paidAt is in the future" checks. */
const FUTURE_SKEW_MS = 5 * 60 * 1000;

const UTR_RE = /^\d{12}$/;

/** sha256 hex of the uploaded screenshot bytes (the image-reuse dedupe key). */
export function screenshotSha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Normalize a user-typed UTR (strip spaces/hyphens). */
export function normalizeUtr(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

// ── Submission ──────────────────────────────────────────────────────────────

export type QrClaimPrecheckInput = {
  userId: string;
  qrId: string;
  amount: number;
  utr: string;
  paidAt: Date;
  /** sha256 hex of the screenshot bytes. */
  screenshotHash: string;
};

/**
 * Run every submission-time validation WITHOUT creating anything. The route
 * calls this before paying for the Cloudinary upload; `submitQrClaim` runs it
 * again right before insert (the DB uniques stay authoritative under races).
 */
export async function precheckQrClaim(input: QrClaimPrecheckInput): Promise<{ utr: string; amount: number }> {
  const utr = normalizeUtr(input.utr);
  if (!UTR_RE.test(utr)) {
    throw new QrClaimError("UTR must be the 12-digit UPI reference number shown in the payment app", 400, "INVALID_UTR");
  }

  const amount = toNumber(round(input.amount));
  if (!(amount > 0)) throw new QrClaimError("Amount must be positive", 400, "INVALID_AMOUNT");
  if (amount > maxClaimAmount()) {
    throw new QrClaimError(`Amount exceeds the per-claim limit of ₹${maxClaimAmount().toLocaleString("en-IN")}`, 400, "AMOUNT_TOO_LARGE");
  }

  const now = Date.now();
  const paidAtMs = input.paidAt.getTime();
  if (!Number.isFinite(paidAtMs)) throw new QrClaimError("Invalid payment date/time", 400, "INVALID_PAID_AT");
  if (paidAtMs > now + FUTURE_SKEW_MS) {
    throw new QrClaimError("Payment date/time cannot be in the future", 400, "INVALID_PAID_AT");
  }
  if (paidAtMs < now - QR_CLAIM_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) {
    throw new QrClaimError(`Payments older than ${QR_CLAIM_MAX_AGE_DAYS} days cannot be claimed`, 400, "PAID_AT_TOO_OLD");
  }

  const qr = await prisma.staticQr.findUnique({ where: { id: input.qrId } });
  if (!qr) throw new QrClaimError("QR code not found", 404, "QR_NOT_FOUND");
  // A rotated-out QR still accepts claims for payments made BEFORE it was
  // disabled; anything dated after the switch must target the new QR.
  if (!qr.active) {
    const cutoff = qr.disabledAt?.getTime();
    if (!cutoff || paidAtMs > cutoff) {
      throw new QrClaimError("This QR code is disabled — payments after the switch must be claimed on the current QR", 400, "QR_DISABLED");
    }
  }

  // Friendly duplicate errors (the unique indexes are the real enforcement).
  const dupUtr = await prisma.qrClaim.findFirst({ where: { utr }, select: { id: true } });
  if (dupUtr) throw new QrClaimError("This UTR has already been claimed — a payment can be settled only once", 409, "DUPLICATE_UTR");
  const dupShot = await prisma.qrClaim.findFirst({ where: { screenshotHash: input.screenshotHash }, select: { id: true } });
  if (dupShot) throw new QrClaimError("This screenshot has already been submitted", 409, "DUPLICATE_SCREENSHOT");

  // Velocity: per-day count AND amount, counting every attempt (incl. rejected)
  // so probing the system burns the day's quota.
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const [count, sum] = await Promise.all([
    prisma.qrClaim.count({ where: { userId: input.userId, createdAt: { gte: dayStart } } }),
    prisma.qrClaim.aggregate({ _sum: { amount: true }, where: { userId: input.userId, createdAt: { gte: dayStart } } }),
  ]);
  if (count >= dailyClaimCountLimit()) {
    throw new QrClaimError("Daily claim limit reached — try again tomorrow or contact support", 429, "DAILY_COUNT_LIMIT");
  }
  const claimedToday = Number(sum._sum.amount ?? 0);
  if (claimedToday + amount > dailyClaimAmountLimit()) {
    throw new QrClaimError("Daily claim amount limit reached — try again tomorrow or contact support", 429, "DAILY_AMOUNT_LIMIT");
  }

  return { utr, amount };
}

export type QrClaimSubmitInput = QrClaimPrecheckInput & {
  screenshotPublicId: string;
  screenshotFormat?: string;
};

export async function submitQrClaim(input: QrClaimSubmitInput) {
  const { utr, amount } = await precheckQrClaim(input);

  let claim;
  try {
    claim = await prisma.qrClaim.create({
      data: {
        userId: input.userId,
        qrId: input.qrId,
        amount: new Prisma.Decimal(amount),
        utr,
        paidAt: input.paidAt,
        screenshotPublicId: input.screenshotPublicId,
        screenshotFormat: input.screenshotFormat ?? null,
        screenshotHash: input.screenshotHash,
      },
    });
  } catch (e) {
    // Unique-index race (two submits of the same UTR/screenshot in flight).
    if ((e as { code?: string })?.code === "P2002") {
      throw new QrClaimError("This payment has already been claimed", 409, "DUPLICATE_UTR");
    }
    throw e;
  }

  await prisma.auditLog.create({
    data: {
      userId: input.userId,
      action: "qr_claim.submitted",
      entity: "QrClaim",
      entityId: claim.id,
      meta: { qrId: input.qrId, amount, utr },
    },
  });

  return claim;
}

// ── Review (approve / reject) ───────────────────────────────────────────────

export type QrClaimReviewInput = {
  claimId: string;
  adminId: string;
  note?: string;
  /** Admin attests the UTR was found in the provider's merchant portal. */
  portalVerified?: boolean;
};

/**
 * Approve a claim — the FRAUD gate. Approval attests the payment is real (UTR
 * found in the provider portal) and makes the claim SETTLEABLE. It NO LONGER
 * moves money: settlement is a separate step where the scheme's QR MDR is
 * deducted (instant/T0 via the retailer button, or T1 via the daily cron).
 *
 * Below the maker-checker threshold this goes straight to SETTLEABLE; above it,
 * the first call stages the claim (AWAITING_SECOND_APPROVAL) and a DIFFERENT
 * admin must approve again before it becomes SETTLEABLE.
 *
 * Race-safe: the status transition is claimed with updateMany.
 */
export async function approveQrClaim(input: QrClaimReviewInput): Promise<{ id: string; status: QrClaimStatus }> {
  if (!input.portalVerified) {
    throw new QrClaimError("You must verify the UTR in the provider portal before approving", 400, "PORTAL_VERIFICATION_REQUIRED");
  }

  const claim = await prisma.qrClaim.findUnique({ where: { id: input.claimId } });
  if (!claim) throw new QrClaimError("Claim not found", 404, "NOT_FOUND");
  if (claim.status !== "PENDING" && claim.status !== "AWAITING_SECOND_APPROVAL") {
    throw new QrClaimError(`Claim is already ${claim.status}`, 409, "NOT_REVIEWABLE");
  }

  const amount = Number(claim.amount);

  // Stage 1 for large amounts: record the first approver, move no money.
  if (claim.status === "PENDING" && amount > secondApprovalThreshold()) {
    const staged = await prisma.qrClaim.updateMany({
      where: { id: claim.id, status: "PENDING" },
      data: {
        status: "AWAITING_SECOND_APPROVAL",
        firstApprovedById: input.adminId,
        firstApprovedAt: new Date(),
        portalVerified: true,
      },
    });
    if (staged.count === 0) throw new QrClaimError("Claim was reviewed by someone else — refresh", 409, "NOT_REVIEWABLE");
    await prisma.auditLog.create({
      data: {
        userId: input.adminId,
        action: "qr_claim.first_approval",
        entity: "QrClaim",
        entityId: claim.id,
        meta: { amount, utr: claim.utr, note: input.note ?? null },
      },
    });
    return { id: claim.id, status: "AWAITING_SECOND_APPROVAL" };
  }

  // Maker-checker: the finalizing admin must differ from the first approver.
  if (claim.status === "AWAITING_SECOND_APPROVAL" && claim.firstApprovedById === input.adminId) {
    throw new QrClaimError("A different admin must give the second approval", 403, "SECOND_APPROVER_MUST_DIFFER");
  }

  // Terminal transition to SETTLEABLE (no money moves here). Claim it first so
  // concurrent approvers do nothing.
  const approved = await prisma.qrClaim.updateMany({
    where: { id: claim.id, status: claim.status },
    data: {
      status: "SETTLEABLE",
      reviewedById: input.adminId,
      reviewedAt: new Date(),
      reviewNote: input.note ?? null,
      portalVerified: true,
      settleableAt: new Date(),
    },
  });
  if (approved.count === 0) {
    throw new QrClaimError("Claim was reviewed by someone else — refresh", 409, "NOT_REVIEWABLE");
  }

  await prisma.auditLog.create({
    data: {
      userId: input.adminId,
      action: "qr_claim.approved",
      entity: "QrClaim",
      entityId: claim.id,
      meta: {
        amount,
        utr: claim.utr,
        beneficiaryId: claim.userId,
        portalVerified: true,
        secondApproval: claim.status === "AWAITING_SECOND_APPROVAL",
        note: input.note ?? null,
      },
    },
  });

  return { id: claim.id, status: "SETTLEABLE" };
}

// ── Settlement (scheme MDR; instant button / T+1 cron) ──────────────────────

type SettleableClaim = {
  id: string;
  userId: string;
  amount: Prisma.Decimal | number | string;
  utr: string;
};

/**
 * Settle ONE SETTLEABLE claim: price the scheme's QR MDR (T0 for instant, T1
 * for the daily sweep), deduct it, and credit the NET to the retailer wallet.
 *
 * No double credit: the SETTLEABLE→SETTLED transition is claimed with
 * updateMany INSIDE the same transaction as the credit, and the wallet credit
 * carries the `qrsettle:<id>` idempotency key. A racing instant-button click
 * and T+1 sweep can never both pay out. Returns the net credited, or null when
 * the claim can't be priced (no scheme slab / below floor) — left SETTLEABLE.
 */
async function settleClaim(
  claim: SettleableClaim,
  settlementType: "T0" | "T1",
  via: string,
  actorId?: string
): Promise<number | null> {
  const price = await priceSchemeSettlement({
    userId: claim.userId,
    serviceKind: "QR",
    grossAmount: Number(claim.amount),
    paymentMode: "UPI",
    settlementType,
    scopeKey: await railScopeKey("QR"),
  });
  if (!price) return null; // no scheme rate / below floor — leave SETTLEABLE for admin

  let credited: number | null = null;
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.qrClaim.updateMany({
      where: { id: claim.id, status: "SETTLEABLE" },
      data: {
        status: "SETTLED",
        settledAt: new Date(),
        settledVia: via,
        mdrAmount: price.mdrAmount,
        netAmount: price.netAmount,
        settlementSchemeId: price.schemeId,
        mdrSlabId: price.slabId,
      },
    });
    if (claimed.count === 0) return; // already settled by a concurrent writer

    const wtxn = await creditWallet(
      {
        userId: claim.userId,
        amount: price.netAmount,
        reason: "SETTLEMENT",
        refType: "QrClaim",
        refId: claim.id,
        note: `QR ${settlementType === "T0" ? "instant" : "T+1"} settlement (UTR ${claim.utr})`,
        idempotencyKey: `qrsettle:${claim.id}`,
      },
      tx
    );
    await tx.qrClaim.updateMany({ where: { id: claim.id }, data: { walletTxnId: wtxn.id } });
    await tx.auditLog.create({
      data: {
        userId: actorId ?? claim.userId,
        action: settlementType === "T0" ? "qr_claim.instant_settled" : "qr_claim.t1_settled",
        entity: "QrClaim",
        entityId: claim.id,
        meta: {
          gross: Number(claim.amount),
          mdr: toNumber(price.mdrAmount),
          net: toNumber(price.netAmount),
          utr: claim.utr,
          via,
        },
      },
    });
    credited = toNumber(price.netAmount);
  });

  return credited;
}

export type QrSettleResult = {
  requested: number;
  settled: number;
  failed: number;
  skipped: number;
  totalAmount: number;
  results: Array<{ id: string; status: "SETTLED" | "SKIPPED" | "FAILED"; netAmount?: number; reason?: string }>;
};

/**
 * Retailer-driven INSTANT settlement (the dashboard button). Settles the chosen
 * SETTLEABLE claims owned by `userId` at the scheme's T0 rate; anything not
 * chosen stays SETTLEABLE for the next-day T+1 cron.
 */
export async function instantSettleQrClaims(userId: string, claimIds: string[]): Promise<QrSettleResult> {
  const unique = Array.from(new Set(claimIds)).slice(0, 200);
  const claims = await prisma.qrClaim.findMany({
    where: { id: { in: unique }, userId, status: "SETTLEABLE" },
    orderBy: { settleableAt: "asc" },
  });

  let settled = 0;
  let failed = 0;
  let skipped = 0;
  let totalAmount = 0;
  const results: QrSettleResult["results"] = [];

  for (const claim of claims) {
    try {
      const net = await settleClaim(claim, "T0", SETTLED_VIA.INSTANT_BUTTON, userId);
      if (net === null) {
        skipped++;
        results.push({ id: claim.id, status: "SKIPPED", reason: "no scheme rate configured" });
        continue;
      }
      settled++;
      totalAmount += net;
      results.push({ id: claim.id, status: "SETTLED", netAmount: net });
    } catch {
      failed++;
      results.push({ id: claim.id, status: "FAILED", reason: "ledger error" });
    }
  }

  const found = new Set(claims.map((c) => c.id));
  for (const id of unique) {
    if (!found.has(id)) {
      skipped++;
      results.push({ id, status: "SKIPPED", reason: "already settled or not found" });
    }
  }

  return { requested: unique.length, settled, failed, skipped, totalAmount, results };
}

/**
 * QR T+1 cron: settle SETTLEABLE claims approved BEFORE the current IST day
 * (true T+1) at the scheme's T1 rate. Instant-settled claims are already SETTLED
 * and invisible here, so a claim is never paid out twice.
 */
export async function runQrT1SettlementSweep(): Promise<{
  processed: number;
  settled: number;
  failed: number;
  totalAmount: number;
}> {
  const config = await getSetting("settlement.qr_t1");
  if (!config.enabled || config.paused) {
    return { processed: 0, settled: 0, failed: 0, totalAmount: 0 };
  }

  const cutoff = startOfTodayIst();
  const claims = await prisma.qrClaim.findMany({
    where: { status: "SETTLEABLE", settleableAt: { lt: cutoff } },
    orderBy: { settleableAt: "asc" },
    take: 500,
  });

  let settled = 0;
  let failed = 0;
  let totalAmount = 0;

  for (const claim of claims) {
    if (Number(claim.amount) < config.minAmount) continue; // below minimum — leave for next run
    try {
      const net = await settleClaim(claim, "T1", SETTLED_VIA.T1_CRON);
      if (net === null) continue; // not priceable — leave SETTLEABLE for admin
      settled++;
      totalAmount += net;
    } catch {
      failed++;
    }
  }

  return { processed: claims.length, settled, failed, totalAmount };
}

/**
 * The retailer's SETTLEABLE claims plus instant (T0) and T+1 quotes per claim.
 * Powers the dashboard "Instant settle" table.
 */
export async function listSettleableQrClaims(userId: string) {
  const claims = await prisma.qrClaim.findMany({
    where: { userId, status: "SETTLEABLE" },
    orderBy: { settleableAt: "desc" },
    take: 200,
    include: { qr: { select: { label: true } } },
  });

  const scopeKey = await railScopeKey("QR");
  const rows = [];
  for (const c of claims) {
    const gross = Number(c.amount);
    const [instant, t1] = await Promise.all([
      priceSchemeSettlement({ userId, serviceKind: "QR", grossAmount: gross, paymentMode: "UPI", settlementType: "T0", scopeKey }),
      priceSchemeSettlement({ userId, serviceKind: "QR", grossAmount: gross, paymentMode: "UPI", settlementType: "T1", scopeKey }),
    ]);
    rows.push({
      id: c.id,
      qrLabel: c.qr.label,
      amount: gross,
      utr: c.utr,
      paidAt: c.paidAt.toISOString(),
      settleableAt: c.settleableAt?.toISOString() ?? null,
      instant: instant ? { mdrAmount: toNumber(instant.mdrAmount), netAmount: toNumber(instant.netAmount) } : null,
      t1: t1 ? { mdrAmount: toNumber(t1.mdrAmount), netAmount: toNumber(t1.netAmount) } : null,
    });
  }
  return rows;
}

export async function rejectQrClaim(input: QrClaimReviewInput & { note: string }): Promise<{ id: string; status: QrClaimStatus }> {
  if (!input.note?.trim()) throw new QrClaimError("A rejection note is required", 400, "NOTE_REQUIRED");

  const claim = await prisma.qrClaim.findUnique({ where: { id: input.claimId } });
  if (!claim) throw new QrClaimError("Claim not found", 404, "NOT_FOUND");
  if (claim.status !== "PENDING" && claim.status !== "AWAITING_SECOND_APPROVAL") {
    throw new QrClaimError(`Claim is already ${claim.status}`, 409, "NOT_REVIEWABLE");
  }

  const rejected = await prisma.qrClaim.updateMany({
    where: { id: claim.id, status: { in: ["PENDING", "AWAITING_SECOND_APPROVAL"] } },
    data: {
      status: "REJECTED",
      reviewedById: input.adminId,
      reviewedAt: new Date(),
      reviewNote: input.note,
    },
  });
  if (rejected.count === 0) throw new QrClaimError("Claim was reviewed by someone else — refresh", 409, "NOT_REVIEWABLE");

  await prisma.auditLog.create({
    data: {
      userId: input.adminId,
      action: "qr_claim.rejected",
      entity: "QrClaim",
      entityId: claim.id,
      meta: { amount: Number(claim.amount), utr: claim.utr, note: input.note },
    },
  });

  return { id: claim.id, status: "REJECTED" };
}

/**
 * Claw back a claim whose payment never appeared in the provider's settlement
 * (phase-2 recon, or a manual admin action on discovered fraud). Debits back
 * whatever was actually credited: the NET for SETTLED claims (post-MDR), or the
 * full amount for legacy APPROVED (credit-on-approval) rows. Idempotent; freezes
 * nothing by itself — account suspension stays a separate, human decision.
 */
export async function clawbackQrClaim(input: QrClaimReviewInput & { note: string }): Promise<{ id: string; status: QrClaimStatus }> {
  if (!input.note?.trim()) throw new QrClaimError("A clawback note is required", 400, "NOTE_REQUIRED");

  const claim = await prisma.qrClaim.findUnique({ where: { id: input.claimId } });
  if (!claim) throw new QrClaimError("Claim not found", 404, "NOT_FOUND");
  if (claim.status !== "SETTLED" && claim.status !== "APPROVED") {
    throw new QrClaimError("Only settled claims can be clawed back", 409, "NOT_CLAWBACKABLE");
  }

  // Debit back what was credited: NET for the new SETTLED path, full face value
  // for legacy credit-on-approval rows (netAmount is null on those).
  const debitAmount = claim.status === "SETTLED" ? claim.netAmount ?? claim.amount : claim.amount;
  const fromStatus = claim.status;

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.qrClaim.updateMany({
      where: { id: claim.id, status: fromStatus },
      data: { status: "CLAWED_BACK", reviewNote: input.note, reviewedById: input.adminId, reviewedAt: new Date() },
    });
    if (claimed.count === 0) throw new QrClaimError("Claim state changed — refresh", 409, "NOT_CLAWBACKABLE");
    await debitWallet(
      {
        userId: claim.userId,
        amount: debitAmount,
        reason: "REVERSAL",
        refType: "QrClaim",
        refId: claim.id,
        note: `QR claim clawback (UTR ${claim.utr})`,
        idempotencyKey: `qrclaim-clawback:${claim.id}`,
      },
      tx
    );
    await tx.auditLog.create({
      data: {
        userId: input.adminId,
        action: "qr_claim.clawed_back",
        entity: "QrClaim",
        entityId: claim.id,
        meta: { amount: Number(debitAmount), utr: claim.utr, beneficiaryId: claim.userId, note: input.note },
      },
    });
  });

  return { id: claim.id, status: "CLAWED_BACK" };
}

// ── Ops overview ────────────────────────────────────────────────────────────

/**
 * The numbers the admin needs on screen. `outstandingReceivable` is the float
 * you've fronted: approved-and-credited claims the provider hasn't settled to
 * you yet. If it grows faster than settlements arrive, stop approving.
 */
export async function getQrClaimOverview() {
  const [pending, awaitingSecond, settleable, outstanding] = await Promise.all([
    prisma.qrClaim.aggregate({ _count: true, _sum: { amount: true }, where: { status: "PENDING" } }),
    prisma.qrClaim.aggregate({ _count: true, _sum: { amount: true }, where: { status: "AWAITING_SECOND_APPROVAL" } }),
    prisma.qrClaim.aggregate({ _count: true, _sum: { amount: true }, where: { status: "SETTLEABLE" } }),
    // Fronted float: SETTLED (net-credited) claims the provider hasn't settled to us yet.
    prisma.qrClaim.aggregate({ _count: true, _sum: { netAmount: true }, where: { status: "SETTLED", reconciledAt: null } }),
  ]);
  return {
    pendingCount: pending._count,
    pendingAmount: Number(pending._sum.amount ?? 0),
    awaitingSecondCount: awaitingSecond._count,
    awaitingSecondAmount: Number(awaitingSecond._sum.amount ?? 0),
    settleableCount: settleable._count,
    settleableAmount: Number(settleable._sum.amount ?? 0),
    outstandingReceivableCount: outstanding._count,
    outstandingReceivable: Number(outstanding._sum.netAmount ?? 0),
  };
}
