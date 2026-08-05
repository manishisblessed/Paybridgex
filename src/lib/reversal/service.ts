import type { Reversal, WalletDirection, WalletType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { creditWallet, debitWallet, LedgerError } from "@/lib/ledger";
import { add, dec, toNumber } from "@/lib/money";

/**
 * Reversal desk — admin-raised compensating movements against settled
 * entities. History is NEVER edited: a reversal posts an opposite-direction
 * ledger entry (reason REVERSAL) and links it here.
 *
 * Authorization is tab-based (see `canManageReversals`): any staff member who
 * holds the reversals tab may raise a reversal on their own — there is no
 * second-admin (maker-checker) approval step. Same money-safety contract as
 * wallet operations otherwise: idempotent ledger leg (`reversal:<id>`) and the
 * op row + movement commit together.
 */

export class ReversalError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = "ReversalError";
  }
}

/**
 * Authorization gate for raising / actioning reversals. Full admins always
 * qualify; a sub-admin (DB role SUPPORT) qualifies when granted the reversals
 * tab.
 */
export function canManageReversals(user: { role: string; allowedTabs?: string[] }): boolean {
  if (user.role === "MASTER_ADMIN" || user.role === "ADMIN") return true;
  if (user.role === "SUPPORT") return (user.allowedTabs ?? []).includes("reversals");
  return false;
}

/** Read access — everyone write-capable, plus read-only FINANCE oversight. */
export function canViewReversals(user: { role: string; allowedTabs?: string[] }): boolean {
  return user.role === "FINANCE" || canManageReversals(user);
}

export type CreateReversalInput = {
  actorId: string;
  kind: "TRANSACTION" | "SETTLEMENT" | "AEPS" | "WALLET_ENTRY";
  refType: string;
  refId: string;
  refLabel?: string;
  targetUserId: string;
  /** Direction from the TARGET USER's perspective. CREDIT = money returned. */
  direction: WalletDirection;
  walletType?: WalletType;
  amount: number;
  reason: string;
};

async function executeReversal(rev: Reversal): Promise<string> {
  const movement = {
    userId: rev.targetUserId,
    amount: dec(rev.amount),
    reason: "REVERSAL" as const,
    refType: rev.refType,
    refId: rev.refId,
    note: `[Reversal ${rev.kind}] ${rev.reason}`,
    idempotencyKey: `reversal:${rev.id}`,
    walletType: rev.walletType,
  };
  const txn =
    rev.direction === "CREDIT" ? await creditWallet(movement) : await debitWallet(movement);
  await prisma.reversal.update({
    where: { id: rev.id },
    data: { walletTxnId: txn.id, status: "COMPLETED" },
  });

  // Kind-specific side effects — stamp the source entity where we own it.
  if (rev.kind === "TRANSACTION" && rev.refType === "Transaction") {
    await prisma.transaction.updateMany({
      where: { id: rev.refId, status: { in: ["SUCCESS", "FAILED", "HOLD"] } },
      data: { status: "REFUNDED", refundedAt: new Date(), refundRefId: rev.id },
    });
  }
  return txn.id;
}

export async function createReversal(input: CreateReversalInput): Promise<Reversal> {
  if (!(input.amount > 0)) throw new ReversalError("INVALID_AMOUNT", "Amount must be > 0");
  if (!input.reason?.trim()) throw new ReversalError("REASON_REQUIRED", "Reason is mandatory");

  const target = await prisma.user.findFirst({
    where: { id: input.targetUserId, deletedAt: null },
    select: { id: true },
  });
  if (!target) throw new ReversalError("USER_NOT_FOUND", "Target user not found", 404);

  // Refuse a duplicate COMPLETED/PENDING reversal of the same entity.
  const dup = await prisma.reversal.findFirst({
    where: {
      refType: input.refType,
      refId: input.refId,
      status: { in: ["COMPLETED", "PENDING_APPROVAL"] },
    },
    select: { id: true, status: true },
  });
  if (dup) {
    throw new ReversalError(
      "ALREADY_REVERSED",
      `This entity already has a ${dup.status} reversal (${dup.id})`
    );
  }

  const rev = await prisma.reversal.create({
    data: {
      kind: input.kind,
      refType: input.refType,
      refId: input.refId,
      refLabel: input.refLabel,
      targetUserId: input.targetUserId,
      actorId: input.actorId,
      direction: input.direction,
      walletType: input.walletType ?? "PRIMARY",
      amount: dec(input.amount),
      reason: input.reason.trim(),
      status: "COMPLETED",
    },
  });

  try {
    await executeReversal(rev);
  } catch (e) {
    await prisma.reversal.update({
      where: { id: rev.id },
      data: { status: "REJECTED", rejectedNote: e instanceof Error ? e.message : "ledger error" },
    });
    if (e instanceof LedgerError && e.code === "INSUFFICIENT_FUNDS") {
      throw new ReversalError("INSUFFICIENT_FUNDS", "Target wallet has insufficient balance for this debit");
    }
    throw e;
  }

  return (await prisma.reversal.findUnique({ where: { id: rev.id } }))!;
}

/**
 * Approve a still-pending reversal (legacy rows only — new reversals execute
 * on create). Any authorized admin may approve, including the maker.
 */
export async function approveReversal(revId: string, approverId: string): Promise<Reversal> {
  const rev = await prisma.reversal.findUnique({ where: { id: revId } });
  if (!rev) throw new ReversalError("NOT_FOUND", "Reversal not found", 404);
  if (rev.status !== "PENDING_APPROVAL")
    throw new ReversalError("BAD_STATE", `Reversal is ${rev.status}, not PENDING_APPROVAL`);

  await prisma.reversal.update({
    where: { id: rev.id },
    data: { approvedById: approverId, approvedAt: new Date() },
  });

  try {
    await executeReversal(rev);
  } catch (e) {
    await prisma.reversal.update({
      where: { id: rev.id },
      data: { status: "REJECTED", rejectedNote: e instanceof Error ? e.message : "ledger error" },
    });
    if (e instanceof LedgerError && e.code === "INSUFFICIENT_FUNDS") {
      throw new ReversalError("INSUFFICIENT_FUNDS", "Target wallet has insufficient balance for this debit");
    }
    throw e;
  }

  return (await prisma.reversal.findUnique({ where: { id: rev.id } }))!;
}

export async function closeReversal(
  revId: string,
  byUserId: string,
  action: "REJECT" | "CANCEL",
  note?: string
): Promise<Reversal> {
  const rev = await prisma.reversal.findUnique({ where: { id: revId } });
  if (!rev) throw new ReversalError("NOT_FOUND", "Reversal not found", 404);
  if (rev.status !== "PENDING_APPROVAL")
    throw new ReversalError("BAD_STATE", `Reversal is ${rev.status}, not PENDING_APPROVAL`);

  return prisma.reversal.update({
    where: { id: rev.id },
    data: {
      status: action === "REJECT" ? "REJECTED" : "CANCELLED",
      rejectedNote: note?.trim() || undefined,
      ...(action === "REJECT" ? { approvedById: byUserId } : {}),
    },
  });
}

/**
 * Convenience: build reversal inputs from a service Transaction — refunds
 * amount + fee back to the transaction owner.
 */
export async function reversalInputFromTransaction(refIdOrId: string): Promise<{
  targetUserId: string;
  amount: number;
  refType: "Transaction";
  refId: string;
  refLabel: string;
} | null> {
  const txn = await prisma.transaction.findFirst({
    where: { OR: [{ id: refIdOrId }, { refId: refIdOrId }] },
    select: { id: true, refId: true, userId: true, amount: true, fee: true, status: true },
  });
  if (!txn) return null;
  return {
    targetUserId: txn.userId,
    amount: toNumber(add(txn.amount, txn.fee)),
    refType: "Transaction",
    refId: txn.id,
    refLabel: txn.refId,
  };
}
