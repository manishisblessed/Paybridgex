import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { flags } from "@/lib/env";
import { releaseHold, LedgerError } from "@/lib/ledger";
import { toNumber } from "@/lib/money";
import { decryptField, maskTail } from "@/lib/crypto/fieldEncryption";
import { assertCanAccessUser } from "@/lib/security/ownership";
import { assertKycCurrent } from "@/lib/security/kycGate";
import { assertLivenessReady } from "@/lib/security/livenessGate";
import { enqueuePayoutInitiate } from "@/lib/payout/service";
import { requireStepUp, readStepUpCode } from "@/lib/security/stepUp";
import { clientIp } from "@/lib/security/audit";
import { enforceRateLimit, RATE_LIMITS, RateLimitError } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";

const PatchBody = z
  .object({
    action: z.enum(["approve", "reject"]),
    remarks: z.string().trim().max(500).optional(),
    stepUpCode: z.string().max(20).optional(),
    stepUpType: z.enum(["totp", "backup"]).optional(),
  })
  .strict();

/** Thrown when a concurrent decision already claimed this request. */
class AlreadyProcessedError extends Error {}

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const row = await prisma.payoutRequest.findUnique({
    where: { id: params.id },
    include: { user: { select: { id: true, name: true, email: true, phone: true, role: true } } },
  });
  if (!row) return NextResponse.json({ error: "Payout not found" }, { status: 404 });

  try {
    await assertCanAccessUser(row.userId, user);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  // Decrypt only for masked display — never return the raw account number.
  const handle = decryptField(row.accountNumber);
  const checker = row.checkerId
    ? await prisma.user.findUnique({ where: { id: row.checkerId }, select: { id: true, name: true } })
    : null;

  return NextResponse.json({
    payout: {
      id: row.id,
      beneficiaryName: row.beneficiaryName,
      maskedAccount: maskTail(handle),
      ifsc: row.ifsc ? decryptField(row.ifsc) : null,
      accountLast4: row.accountLast4,
      mode: row.mode,
      amount: toNumber(row.amount),
      serviceCharge: toNumber(row.serviceCharge),
      gst: toNumber(row.gst),
      totalDebit: toNumber(row.totalDebit),
      status: row.status,
      utr: row.utr,
      failureReason: row.failureReason,
      remarks: row.remarks,
      providerReferenceId: row.providerReferenceId,
      providerTxnId: row.providerTxnId,
      makerId: row.makerId,
      checker,
      createdAt: row.createdAt.toISOString(),
      approvedAt: row.approvedAt?.toISOString() ?? null,
      processedAt: row.processedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      user: row.user,
    },
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let user;
  try {
    user = await requireAuth();
    await enforceRateLimit(`payout:decide:${user.id}`, RATE_LIMITS.payoutCreate);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.statusCode });
    if (e instanceof RateLimitError)
      return NextResponse.json(
        { error: e.message, retryAfterSec: e.result.retryAfterSec },
        { status: 429 }
      );
    throw e;
  }

  const parsed = PatchBody.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const row = await prisma.payoutRequest.findUnique({ where: { id: params.id } });
  if (!row) return NextResponse.json({ error: "Payout not found" }, { status: 404 });

  // Checker must be able to access the maker's data (parent/admin).
  try {
    await assertCanAccessUser(row.userId, user);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  // Maker-checker separation: a maker cannot approve/reject their own payout.
  if (user.id === row.makerId) {
    return NextResponse.json({ error: "Maker cannot be the checker for their own payout" }, { status: 403 });
  }

  // Step-up 2FA: re-verify the checker before a payout decision (no-op unless
  // SECURITY_STEPUP_ENABLED). Accepts code via body or x-2fa-code header.
  try {
    const { code, type } = readStepUpCode(req, parsed.data);
    await requireStepUp(user, {
      action: `payout.${parsed.data.action}`,
      code: code ?? parsed.data.stepUpCode,
      type: parsed.data.stepUpType ?? type,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });
  } catch (e) {
    return toErrorResponse(e);
  }

  if (row.status !== "PENDING_APPROVAL") {
    return NextResponse.json({ error: "Payout is not pending approval" }, { status: 409 });
  }

  if (parsed.data.action === "approve" && !flags.payout) {
    return NextResponse.json({ error: "Payout service is currently disabled" }, { status: 503 });
  }

  // Onboarding liveness + monthly Re-KYC gates — block a network-tier checker
  // from releasing money (approval queues the disbursal) until both pass.
  if (parsed.data.action === "approve") {
    try {
      await assertLivenessReady(user);
      await assertKycCurrent(user);
    } catch (e) {
      return toErrorResponse(e);
    }
  }

  if (parsed.data.action === "reject") {
    try {
      await prisma.$transaction(async (tx) => {
        const claim = await tx.payoutRequest.updateMany({
          where: { id: params.id, status: "PENDING_APPROVAL" },
          data: {
            status: "REJECTED",
            checkerId: user.id,
            remarks: parsed.data.remarks ?? null,
            completedAt: new Date(),
          },
        });
        if (claim.count === 0) throw new AlreadyProcessedError();
        await releaseHold({ userId: row.userId, amount: row.totalDebit }, tx);
      });
    } catch (e) {
      if (e instanceof AlreadyProcessedError)
        return NextResponse.json({ error: "Payout is not pending approval" }, { status: 409 });
      if (e instanceof LedgerError)
        return NextResponse.json({ error: e.message }, { status: 400 });
      throw e;
    }

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "payout.rejected",
        entity: "PayoutRequest",
        entityId: params.id,
        meta: { ownerId: row.userId, totalDebit: toNumber(row.totalDebit), remarks: parsed.data.remarks ?? null },
      },
    });

    return NextResponse.json({ status: "REJECTED" });
  }

  // Approve: claim PENDING_APPROVAL -> APPROVED (funds remain held), then queue.
  const claim = await prisma.payoutRequest.updateMany({
    where: { id: params.id, status: "PENDING_APPROVAL" },
    data: {
      status: "APPROVED",
      checkerId: user.id,
      remarks: parsed.data.remarks ?? null,
      approvedAt: new Date(),
    },
  });
  if (claim.count === 0)
    return NextResponse.json({ error: "Payout is not pending approval" }, { status: 409 });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "payout.approved",
      entity: "PayoutRequest",
      entityId: params.id,
      meta: { ownerId: row.userId, totalDebit: toNumber(row.totalDebit) },
    },
  });

  // Hand off to the PM2 worker; it calls the payout rail from the IP-whitelisted box.
  await enqueuePayoutInitiate(params.id);

  return NextResponse.json({ status: "APPROVED" });
}
