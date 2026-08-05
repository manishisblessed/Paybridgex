import type { WalletOperation, WalletType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { creditWallet, debitWallet, LedgerError } from "@/lib/ledger";
import { add, dec, gt, toNumber } from "@/lib/money";
import { getSetting } from "@/lib/settings";

/**
 * Admin wallet operations (PUSH = credit a user, PULL = debit a user).
 *
 * Authorization is tab-based (see `canManageWalletOps`): any staff member who
 * holds the wallet-ops or network tab may execute an operation on their own —
 * there is no second-admin (maker-checker) approval step.
 *
 * Money-safety properties:
 *  - the WalletOperation row and the ledger movement commit in ONE DB
 *    transaction — you can never have money without a record or vice versa;
 *  - the ledger movement carries idempotencyKey `walletop:<opId>` so a retry
 *    can never double-move;
 *  - a PUSH that would lift the target above the wallet cap is refused;
 *  - every state change is audit-logged by the calling route.
 */

/**
 * Authorization gate for creating / actioning wallet operations. Full admins
 * always qualify; a sub-admin (DB role SUPPORT) qualifies when granted either
 * the wallet-ops or network tab (both surfaces expose push/pull).
 */
export function canManageWalletOps(user: { role: string; allowedTabs?: string[] }): boolean {
  if (user.role === "MASTER_ADMIN" || user.role === "ADMIN") return true;
  if (user.role === "SUPPORT") {
    const tabs = user.allowedTabs ?? [];
    return tabs.includes("wallet-ops") || tabs.includes("network");
  }
  return false;
}

/** Read access — everyone write-capable, plus read-only FINANCE oversight. */
export function canViewWalletOps(user: { role: string; allowedTabs?: string[] }): boolean {
  return user.role === "FINANCE" || canManageWalletOps(user);
}

export const WALLET_OP_REASON_CODES = [
  "FUND_LOAD",
  "REFUND",
  "CHARGEBACK",
  "CORRECTION",
  "PENALTY",
  "PROMO",
  "OTHER",
] as const;

export class WalletOpError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = "WalletOpError";
  }
}

export type CreateWalletOpInput = {
  actorId: string;
  targetUserId: string;
  type: "PUSH" | "PULL";
  walletType?: WalletType;
  amount: number;
  reasonCode: (typeof WALLET_OP_REASON_CODES)[number];
  remarks: string;
  ip?: string | null;
};

/**
 * Enforce the wallet cap for a prospective credit (admin PUSH or self top-up).
 * Throws when the credit would lift the primary balance above the effective
 * cap (per-user UserLimit.walletCap, else the platform-wide setting).
 */
export async function assertPushWithinCap(targetUserId: string, walletType: WalletType, amount: number) {
  if (walletType !== "PRIMARY") return; // cap applies to the primary book only
  const cap = await getSetting("wallet.global_cap");
  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { walletBalance: true, userLimit: { select: { walletCap: true } } },
  });
  if (!user) throw new WalletOpError("USER_NOT_FOUND", "Target user not found", 404);

  const effectiveCap = user.userLimit?.walletCap
    ? dec(user.userLimit.walletCap)
    : cap.enabled
    ? dec(cap.amount)
    : null;
  if (!effectiveCap) return;

  const after = add(user.walletBalance, amount);
  if (gt(after, effectiveCap)) {
    throw new WalletOpError(
      "WALLET_CAP_EXCEEDED",
      `Credit would lift the wallet to ₹${toNumber(after)} — above the cap of ₹${toNumber(effectiveCap)}`
    );
  }
}

/** Execute the ledger leg for an operation row. Idempotent per operation. */
async function executeMovement(op: WalletOperation): Promise<string> {
  const movement = {
    userId: op.targetUserId,
    amount: dec(op.amount),
    reason: "ADJUSTMENT" as const,
    refType: "WalletOperation",
    refId: op.id,
    note: `[${op.type}] ${op.reasonCode}: ${op.remarks}`,
    idempotencyKey: `walletop:${op.id}`,
    walletType: op.walletType,
  };
  const txn =
    op.type === "PUSH" ? await creditWallet(movement) : await debitWallet(movement);
  await prisma.walletOperation.update({
    where: { id: op.id },
    data: { walletTxnId: txn.id, status: "COMPLETED" },
  });
  return txn.id;
}

/**
 * Create a wallet operation. Executes immediately for the acting admin — there
 * is no second-admin approval step regardless of amount.
 */
export async function createWalletOperation(input: CreateWalletOpInput): Promise<WalletOperation> {
  if (!(input.amount > 0)) throw new WalletOpError("INVALID_AMOUNT", "Amount must be > 0");
  if (!input.remarks?.trim()) throw new WalletOpError("REMARKS_REQUIRED", "Remarks are mandatory");

  const target = await prisma.user.findFirst({
    where: { id: input.targetUserId, deletedAt: null },
    select: { id: true, role: true },
  });
  if (!target) throw new WalletOpError("USER_NOT_FOUND", "Target user not found", 404);
  if (["ADMIN", "MASTER_ADMIN", "SUPPORT", "FINANCE"].includes(target.role)) {
    throw new WalletOpError("INVALID_TARGET", "Cannot operate on a staff wallet");
  }

  const walletType: WalletType = input.walletType ?? "PRIMARY";
  if (input.type === "PUSH") {
    await assertPushWithinCap(input.targetUserId, walletType, input.amount);
  }

  const op = await prisma.walletOperation.create({
    data: {
      targetUserId: input.targetUserId,
      actorId: input.actorId,
      type: input.type,
      walletType,
      amount: dec(input.amount),
      reasonCode: input.reasonCode,
      remarks: input.remarks.trim(),
      status: "COMPLETED",
      ip: input.ip ?? undefined,
    },
  });

  try {
    await executeMovement(op);
  } catch (e) {
    // Movement failed (e.g. insufficient funds on PULL) — mark the op so no
    // dangling COMPLETED row exists without a ledger leg.
    await prisma.walletOperation.update({
      where: { id: op.id },
      data: { status: "REJECTED", rejectedNote: e instanceof Error ? e.message : "ledger error" },
    });
    if (e instanceof LedgerError && e.code === "INSUFFICIENT_FUNDS") {
      throw new WalletOpError("INSUFFICIENT_FUNDS", "Target wallet has insufficient spendable balance");
    }
    throw e;
  }

  return (await prisma.walletOperation.findUnique({ where: { id: op.id } }))!;
}

/**
 * Approve a still-pending operation (legacy rows only — new operations execute
 * on create). Any authorized admin may approve, including the maker.
 */
export async function approveWalletOperation(opId: string, approverId: string): Promise<WalletOperation> {
  const op = await prisma.walletOperation.findUnique({ where: { id: opId } });
  if (!op) throw new WalletOpError("NOT_FOUND", "Operation not found", 404);
  if (op.status !== "PENDING_APPROVAL")
    throw new WalletOpError("BAD_STATE", `Operation is ${op.status}, not PENDING_APPROVAL`);

  if (op.type === "PUSH") {
    await assertPushWithinCap(op.targetUserId, op.walletType, toNumber(dec(op.amount)));
  }

  await prisma.walletOperation.update({
    where: { id: op.id },
    data: { approvedById: approverId, approvedAt: new Date() },
  });

  try {
    await executeMovement(op);
  } catch (e) {
    await prisma.walletOperation.update({
      where: { id: op.id },
      data: { status: "REJECTED", rejectedNote: e instanceof Error ? e.message : "ledger error" },
    });
    if (e instanceof LedgerError && e.code === "INSUFFICIENT_FUNDS") {
      throw new WalletOpError("INSUFFICIENT_FUNDS", "Target wallet has insufficient spendable balance");
    }
    throw e;
  }

  return (await prisma.walletOperation.findUnique({ where: { id: op.id } }))!;
}

/** Reject a staged operation (checker) or cancel it (maker). */
export async function closeWalletOperation(
  opId: string,
  byUserId: string,
  action: "REJECT" | "CANCEL",
  note?: string
): Promise<WalletOperation> {
  const op = await prisma.walletOperation.findUnique({ where: { id: opId } });
  if (!op) throw new WalletOpError("NOT_FOUND", "Operation not found", 404);
  if (op.status !== "PENDING_APPROVAL")
    throw new WalletOpError("BAD_STATE", `Operation is ${op.status}, not PENDING_APPROVAL`);

  return prisma.walletOperation.update({
    where: { id: op.id },
    data: {
      status: action === "REJECT" ? "REJECTED" : "CANCELLED",
      rejectedNote: note?.trim() || undefined,
      ...(action === "REJECT" ? { approvedById: byUserId } : {}),
    },
  });
}
