import type { WalletLien } from "@prisma/client";
import { prisma } from "@/lib/db";
import { placeLienHold, releaseLienHold, sweepLiensForUser } from "@/lib/ledger";
import { dec, gt, sub, toNumber } from "@/lib/money";

/**
 * Admin wallet liens (chargeback / fraud recovery).
 *
 * A lien freezes funds so a user cannot spend them and recovers the money
 * EAGERLY into the Company Suspense account. Properties:
 *  - the WalletLien row and the balance mutation commit in ONE DB transaction;
 *  - placing a lien immediately sweeps whatever is currently available, and the
 *    ledger's creditWallet hook keeps sweeping every future incoming credit
 *    until `recoveredAmount == amount`, then the lien auto-closes (RECOVERED);
 *  - the lien is invisible to the user (never subtracted from the displayed
 *    balance) — only the reduced spendable enforces it;
 *  - releasing an active lien returns its still-outstanding portion to spendable
 *    (already-recovered funds stay with the company);
 *  - authorization is permission-based (see the API route), not maker-checker.
 */

export const LIEN_REASON_CODES = [
  "CHARGEBACK",
  "FRAUD",
  "DISPUTE",
  "INVESTIGATION",
  "OTHER",
] as const;

export type LienReasonCode = (typeof LIEN_REASON_CODES)[number];

/** Roles whose wallets can never be liened. */
const STAFF_ROLES = ["ADMIN", "MASTER_ADMIN", "SUPPORT", "FINANCE"];

export class WalletLienError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = "WalletLienError";
  }
}

/**
 * Permission gate (no maker-checker): full admins can always manage liens; a
 * sub-admin (DB role SUPPORT) may only if granted the wallet-ops tab.
 */
export function canManageLiens(user: { role: string; allowedTabs?: string[] }): boolean {
  if (user.role === "MASTER_ADMIN" || user.role === "ADMIN") return true;
  if (user.role === "SUPPORT") return (user.allowedTabs ?? []).includes("wallet-ops");
  return false;
}

/** Read access — everything write-capable, plus read-only FINANCE oversight. */
export function canViewLiens(user: { role: string; allowedTabs?: string[] }): boolean {
  return user.role === "FINANCE" || canManageLiens(user);
}

export type CreateLienInput = {
  actorId: string;
  targetUserId: string;
  amount: number;
  reasonCode: LienReasonCode;
  remarks: string;
  /** Optional link to the originating transaction (or other entity). */
  refType?: string | null;
  refId?: string | null;
  ip?: string | null;
};

/** Serialized shape returned to the admin console. */
export function serializeLien(lien: WalletLien) {
  const outstanding = sub(lien.amount, lien.recoveredAmount);
  return {
    id: lien.id,
    targetUserId: lien.targetUserId,
    actorId: lien.actorId,
    amount: toNumber(dec(lien.amount)),
    recoveredAmount: toNumber(dec(lien.recoveredAmount)),
    outstanding: toNumber(gt(outstanding, 0) ? outstanding : dec(0)),
    reasonCode: lien.reasonCode,
    remarks: lien.remarks,
    status: lien.status,
    refType: lien.refType,
    refId: lien.refId,
    releasedById: lien.releasedById,
    releasedAt: lien.releasedAt?.toISOString() ?? null,
    closedAt: lien.closedAt?.toISOString() ?? null,
    createdAt: lien.createdAt.toISOString(),
  };
}

/**
 * Place a lien on a user's wallet and eagerly recover whatever is available.
 * Returns the (possibly already partially/fully recovered) lien row.
 */
export async function placeWalletLien(input: CreateLienInput): Promise<WalletLien> {
  if (!(input.amount > 0)) throw new WalletLienError("INVALID_AMOUNT", "Amount must be > 0");
  if (!input.remarks?.trim()) throw new WalletLienError("REMARKS_REQUIRED", "Remarks are mandatory");

  const target = await prisma.user.findFirst({
    where: { id: input.targetUserId, deletedAt: null },
    select: { id: true, role: true },
  });
  if (!target) throw new WalletLienError("USER_NOT_FOUND", "Target user not found", 404);
  if (STAFF_ROLES.includes(target.role)) {
    throw new WalletLienError("INVALID_TARGET", "Cannot place a lien on a staff wallet");
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.walletLien.create({
      data: {
        targetUserId: input.targetUserId,
        actorId: input.actorId,
        amount: dec(input.amount),
        reasonCode: input.reasonCode,
        remarks: input.remarks.trim(),
        refType: input.refType ?? undefined,
        refId: input.refId ?? undefined,
        ip: input.ip ?? undefined,
        status: "ACTIVE",
      },
    });
    // Freeze the debt and immediately sweep any currently-available funds.
    await placeLienHold(input.targetUserId, input.amount, tx);
    // Governance: tell the retailer a hold was placed (atomic with the lien) so
    // they always know why their spendable balance dropped. Never silent.
    await tx.notification.create({
      data: {
        userId: input.targetUserId,
        title: "A hold was placed on your wallet",
        body: `₹${input.amount.toFixed(2)} has been placed under a recovery hold (${input.reasonCode}). It will be recovered from your available balance and future credits. Reason: ${input.remarks.trim()}`,
        channel: "INAPP",
        href: "/dashboard/wallet",
      },
    });
    return tx.walletLien.findUniqueOrThrow({ where: { id: created.id } });
  });
}

/**
 * Force an immediate recovery sweep for a lien's owner (money is otherwise
 * swept automatically as credits land). Useful when funds are already present.
 */
export async function recoverWalletLien(lienId: string): Promise<WalletLien> {
  return prisma.$transaction(async (tx) => {
    const lien = await tx.walletLien.findUnique({ where: { id: lienId } });
    if (!lien) throw new WalletLienError("NOT_FOUND", "Lien not found", 404);
    if (lien.status !== "ACTIVE")
      throw new WalletLienError("BAD_STATE", `Lien is ${lien.status}, not ACTIVE`);
    await sweepLiensForUser(tx, lien.targetUserId);
    return tx.walletLien.findUniqueOrThrow({ where: { id: lienId } });
  });
}

/**
 * Release an active lien — its outstanding (unrecovered) portion returns to the
 * user's spendable balance. Already-recovered funds stay with the company.
 */
export async function releaseWalletLien(
  lienId: string,
  actorId: string,
  note?: string
): Promise<WalletLien> {
  return prisma.$transaction(async (tx) => {
    const lien = await tx.walletLien.findUnique({ where: { id: lienId } });
    if (!lien) throw new WalletLienError("NOT_FOUND", "Lien not found", 404);
    if (lien.status !== "ACTIVE")
      throw new WalletLienError("BAD_STATE", `Lien is ${lien.status}, not ACTIVE`);

    const remaining = sub(lien.amount, lien.recoveredAmount);
    if (gt(remaining, 0)) {
      await releaseLienHold(lien.targetUserId, remaining, tx);
    }
    return tx.walletLien.update({
      where: { id: lienId },
      data: {
        status: "RELEASED",
        releasedById: actorId,
        releasedAt: new Date(),
        closedAt: new Date(),
        remarks: note?.trim() ? `${lien.remarks} | Released: ${note.trim()}` : lien.remarks,
      },
    });
  });
}
