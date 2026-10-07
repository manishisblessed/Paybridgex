import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { creditWallet, debitWallet, LedgerError, schedulePosRentalRetryIfNeeded } from "@/lib/ledger";
import { toNumber } from "@/lib/money";
import { isAdminRole } from "@/lib/security/ownership";
import { assertKycCurrent, ReKycRequiredError } from "@/lib/security/kycGate";
import { assertLivenessReady, LivenessRequiredError } from "@/lib/security/livenessGate";
import { enforceRateLimit, RATE_LIMITS, RateLimitError } from "@/lib/security/rateLimit";

const PatchBody = z
  .object({
    action: z.enum(["approve", "reject"]),
    remarks: z.string().optional(),
  })
  .strict();

/** Thrown when a concurrent approval already claimed this request. */
class AlreadyProcessedError extends Error {}

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  let user;
  try {
    user = await requireAuth();
    await enforceRateLimit(`fund-request:decide:${user.id}`, RATE_LIMITS.fundRequestCreate);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    if (e instanceof RateLimitError)
      return NextResponse.json(
        { error: e.message, retryAfterSec: e.result.retryAfterSec },
        { status: 429 }
      );
    throw e;
  }

  const parsed = PatchBody.safeParse(await req.json());
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const fundReq = await prisma.fundRequest.findUnique({
    where: { id: params.id },
    include: { requester: { select: { id: true, parentId: true, name: true } } },
  });

  if (!fundReq)
    return NextResponse.json({ error: "Fund request not found" }, { status: 404 });

  if (fundReq.status !== "PENDING")
    return NextResponse.json({ error: "Request already processed" }, { status: 409 });

  // Admins (incl. MASTER_ADMIN) may decide any request; otherwise only the
  // requester's direct parent in the hierarchy may approve/reject.
  const isAdmin = isAdminRole(user.role);
  const isParent = fundReq.requester.parentId === user.id;
  if (!isAdmin && !isParent)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (parsed.data.action === "reject") {
    await prisma.fundRequest.update({
      where: { id: params.id },
      data: {
        status: "REJECTED",
        approverId: user.id,
        rejectedAt: new Date(),
        remarks: parsed.data.remarks ?? null,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "fund_request.rejected",
        entity: "FundRequest",
        entityId: params.id,
        meta: {
          amount: toNumber(fundReq.amount),
          requesterId: fundReq.requesterId,
        },
      },
    });

    return NextResponse.json({ status: "REJECTED" });
  }

  // Onboarding liveness + monthly Re-KYC gates — a network-tier approver moves
  // their own wallet funds here, so block the money movement until both pass.
  try {
    await assertLivenessReady(user);
    await assertKycCurrent(user);
  } catch (e) {
    if (e instanceof LivenessRequiredError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode });
    if (e instanceof ReKycRequiredError)
      return NextResponse.json({ error: e.message, code: e.code, reKycDueAt: e.dueAt }, { status: e.statusCode });
    throw e;
  }

  // Approve: atomic wallet transfer (approver → requester) through the ledger.
  // The status is claimed with a conditional update inside the same transaction
  // so two concurrent approvals can never both move money, and the ledger
  // helpers row-lock + idempotency-key each movement so balances stay exact.
  try {
    await prisma.$transaction(async (tx) => {
      // Claim the request — only the winner of the race proceeds.
      const claim = await tx.fundRequest.updateMany({
        where: { id: params.id, status: "PENDING" },
        data: {
          status: "APPROVED",
          approverId: user.id,
          approvedAt: new Date(),
          remarks: parsed.data.remarks ?? null,
        },
      });
      if (claim.count === 0) throw new AlreadyProcessedError();

      await debitWallet(
        {
          userId: user.id,
          amount: fundReq.amount,
          reason: "FUND_TRANSFER_OUT",
          refType: "FundRequest",
          refId: params.id,
          note: `Fund transfer to ${fundReq.requester.name}`,
          idempotencyKey: `fund-request:${params.id}:out`,
        },
        tx
      );

      await creditWallet(
        {
          userId: fundReq.requesterId,
          amount: fundReq.amount,
          reason: "FUND_TRANSFER_IN",
          refType: "FundRequest",
          refId: params.id,
          note: `Fund request approved by ${user.name}`,
          idempotencyKey: `fund-request:${params.id}:in`,
        },
        tx
      );
    });
  } catch (e) {
    if (e instanceof AlreadyProcessedError) {
      return NextResponse.json(
        { error: "Request already processed" },
        { status: 409 }
      );
    }
    if (e instanceof LedgerError && e.code === "INSUFFICIENT_FUNDS") {
      return NextResponse.json(
        { error: "Insufficient wallet balance to approve this request" },
        { status: 400 }
      );
    }
    throw e;
  }

  // Transfer committed → recover any outstanding POS rent for the requester
  // immediately (the creditWallet hook can't fire from inside the tx above).
  void schedulePosRentalRetryIfNeeded(fundReq.requesterId);

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "fund_request.approved",
      entity: "FundRequest",
      entityId: params.id,
      meta: {
        amount: toNumber(fundReq.amount),
        requesterId: fundReq.requesterId,
      },
    },
  });

  return NextResponse.json({ status: "APPROVED" });
}
