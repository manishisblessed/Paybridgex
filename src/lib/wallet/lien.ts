import type { WalletLien } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  creditWallet,
  debitWallet,
  placeLienHold,
  releaseLienHold,
  sweepLiensForUser,
} from "@/lib/ledger";
import { getSuspenseAccountId } from "@/lib/wallet/suspense";
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

/**
 * REVERSE an (over-)recovered lien — return the money ALREADY swept to the
 * Company Suspense account back to the user's wallet, and free any still-frozen
 * outstanding portion.
 *
 * Use when a recovery turned out to be wrong — e.g. we lien-recovered an instant
 * refund, then the provider (SameDay) separately refunded our float for the same
 * transaction: keeping the recovery would leave the retailer charged twice. Plain
 * `releaseWalletLien` only frees the never-recovered portion (and refuses a
 * non-ACTIVE lien), so it cannot undo a RECOVERED lien — this is the path that
 * can. Idempotent per lien via deterministic ledger keys; the suspense debit and
 * the user credit are one double-entry so balances stay consistent.
 */
export async function reverseWalletLien(
  lienId: string,
  actorId: string,
  note?: string
): Promise<WalletLien> {
  return prisma.$transaction(async (tx) => {
    const lien = await tx.walletLien.findUnique({ where: { id: lienId } });
    if (!lien) throw new WalletLienError("NOT_FOUND", "Lien not found", 404);
    if (lien.status === "RELEASED")
      throw new WalletLienError("BAD_STATE", "Lien is already RELEASED");

    const recovered = toNumber(dec(lien.recoveredAmount));
    const outstanding = sub(lien.amount, lien.recoveredAmount);

    // 1. Return any still-frozen (never-recovered) portion to spendable.
    if (gt(outstanding, 0)) {
      await releaseLienHold(lien.targetUserId, outstanding, tx);
    }

    // 2. Return the already-recovered money: debit the Company Suspense account
    //    (where the sweep parked it) and credit it back to the user. Keyed so a
    //    retry can never double-return.
    if (recovered > 0) {
      const suspenseId = await getSuspenseAccountId(tx);
      await debitWallet(
        {
          userId: suspenseId,
          amount: recovered,
          reason: "REVERSAL",
          refType: "WalletLien",
          refId: lien.id,
          note: `Lien reversal — recovered funds returned to ${lien.targetUserId} (lien ${lien.id})`,
          idempotencyKey: `lien:${lien.id}:reverse:suspense`,
        },
        tx
      );
      // NOTE: this PRIMARY credit will be re-swept by any OTHER still-ACTIVE lien
      // on the user (correct — they still owe those); THIS lien is RECOVERED/non-
      // ACTIVE here so it can never re-capture its own reversal.
      await creditWallet(
        {
          userId: lien.targetUserId,
          amount: recovered,
          reason: "REVERSAL",
          refType: "WalletLien",
          refId: lien.id,
          note: `Lien reversal — recovered funds returned${note?.trim() ? `: ${note.trim()}` : ""}`,
          idempotencyKey: `lien:${lien.id}:reverse:user`,
        },
        tx
      );

      await tx.notification.create({
        data: {
          userId: lien.targetUserId,
          title: "A recovery hold was reversed",
          body: `₹${recovered.toFixed(2)} previously recovered under a wallet hold has been returned to your wallet.`,
          channel: "INAPP",
          href: "/dashboard/wallet",
        },
      });
    }

    // Keep `recoveredAmount` as the historical record of what was swept; the
    // matching REVERSAL ledger legs above net it back out. Status RELEASED closes
    // the lien so it no longer burdens the wallet or appears as open exposure.
    return tx.walletLien.update({
      where: { id: lien.id },
      data: {
        status: "RELEASED",
        releasedById: actorId,
        releasedAt: new Date(),
        closedAt: new Date(),
        remarks: `${lien.remarks} | Reversed (recovered funds returned)${note?.trim() ? `: ${note.trim()}` : ""}`,
      },
    });
  });
}
