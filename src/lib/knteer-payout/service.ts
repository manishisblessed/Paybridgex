/**
 * Bank Transfer (Knteer) — service layer.
 *
 * Scope after the rail re-architecture: this module ONLY owns the beneficiary
 * book (verify + register + list). The actual transfer, its wallet hold/debit,
 * reconciliation, refunds, and NEEDS_REVIEW handling all ride the shared
 * PayoutRequest lifecycle in `src/lib/payout/service.ts` (rail = "KNTEER") so the
 * money-safety guarantees are identical to the Settlement-based Bank Payouts.
 *
 * SECURITY: account numbers are AES-256-GCM encrypted at rest and NEVER logged
 * or returned to the client in plain form — only the masked last-4 is surfaced.
 */
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { encryptField } from "@/lib/crypto/fieldEncryption";
import {
  knteerGetBalance,
  knteerGetBanks,
  knteerVerifyAccount,
  knteerRegisterAccount,
  type KnteerVerifyResult,
} from "@/lib/partners/sameday-knteer-payout";
import type { PartnerResult } from "@/lib/partners/types";

const log = logger.child({ module: "knteer-payout/service" });

// ---------------------------------------------------------------------------
// Re-exports (for convenience)
// ---------------------------------------------------------------------------
export { knteerGetBalance as getKnteerBalance };
export { knteerGetBanks as getKnteerBanks };

// ---------------------------------------------------------------------------
// Verify account  (eKYC Hub penny-less, ₹4.72 on success — partner wallet)
// ---------------------------------------------------------------------------

export async function verifyKnteerAccount(input: {
  accountNumber: string;
  ifscCode: string;
  bankName?: string;
}): Promise<PartnerResult<KnteerVerifyResult>> {
  return knteerVerifyAccount(input);
}

// ---------------------------------------------------------------------------
// Register / add beneficiary
// ---------------------------------------------------------------------------

export type RegisterKnteerAccountInput = {
  userId: string;
  accountNumber: string;
  ifscCode: string;
  accountHolderName: string;
  bankName: string;
  mobile: string;
  email?: string;
};

export type RegisterKnteerAccountResult = {
  beneficiaryId: string;
  alreadyRegistered: boolean;
  registrationType: "register" | "verify";
  verificationCharge: number;
  referenceId: string | null;
  message: string;
  accountLast4: string;
  accountHolderName: string;
  bankName: string;
  ifscCode: string;
  isBankVerified: boolean;
};

export async function registerKnteerAccount(
  input: RegisterKnteerAccountInput
): Promise<PartnerResult<RegisterKnteerAccountResult>> {
  // 1. Call the partner API first (may throw on network error — let it bubble).
  const r = await knteerRegisterAccount({
    accountNumber: input.accountNumber,
    ifscCode: input.ifscCode,
    accountHolderName: input.accountHolderName,
    bankName: input.bankName,
    mobile: input.mobile,
    email: input.email,
    registrationType: "register",
  });

  if (!r.ok) {
    log.warn(
      { code: r.code, accountLast4: input.accountNumber.slice(-4) },
      "KnteerPayout registerAccount partner error"
    );
    return r;
  }

  const last4 = input.accountNumber.replace(/\D/g, "").slice(-4);
  const encAccount = encryptField(input.accountNumber);

  // 2. Persist the beneficiary, deduped per (owner, account last-4, IFSC) so a
  //    re-registration updates the existing book entry in place rather than
  //    creating duplicates. A fresh encryption of the account number is written
  //    on every call so key rotation works naturally.
  const beneficiary = await prisma.knteerBeneficiary.upsert({
    where: {
      userId_accountLast4_ifscCode: {
        userId: input.userId,
        accountLast4: last4,
        ifscCode: input.ifscCode,
      },
    },
    create: {
      userId: input.userId,
      accountNumber: encAccount,
      accountLast4: last4,
      ifscCode: input.ifscCode,
      accountHolderName: r.data.account.accountHolderName,
      bankName: r.data.account.bankName,
      mobile: input.mobile,
      referenceId: r.data.referenceId,
      registrationType: r.data.registrationType,
      verificationCharge: r.data.verificationCharge,
      isRegistered: r.data.account.isRegistered,
      isBankVerified: r.data.account.isBankVerified,
    },
    update: {
      accountNumber: encAccount,
      accountHolderName: r.data.account.accountHolderName,
      bankName: r.data.account.bankName,
      mobile: input.mobile,
      referenceId: r.data.referenceId ?? undefined,
      registrationType: r.data.registrationType,
      verificationCharge: r.data.verificationCharge,
      isRegistered: r.data.account.isRegistered,
      isBankVerified: r.data.account.isBankVerified,
    },
    select: { id: true },
  });

  log.info(
    { beneficiaryId: beneficiary.id, referenceId: r.data.referenceId, accountLast4: last4 },
    "KnteerPayout beneficiary persisted"
  );

  return {
    ok: true,
    data: {
      beneficiaryId: beneficiary.id,
      alreadyRegistered: r.data.alreadyRegistered,
      registrationType: r.data.registrationType,
      verificationCharge: r.data.verificationCharge,
      referenceId: r.data.referenceId,
      message: r.data.message,
      accountLast4: last4,
      accountHolderName: r.data.account.accountHolderName,
      bankName: r.data.account.bankName,
      ifscCode: input.ifscCode,
      isBankVerified: r.data.account.isBankVerified,
    },
  };
}

// ---------------------------------------------------------------------------
// List local beneficiaries (from DB) — scoped to the requesting user
// ---------------------------------------------------------------------------

export type KnteerBeneficiaryRow = {
  id: string;
  accountLast4: string;
  ifscCode: string;
  accountHolderName: string;
  bankName: string;
  mobile: string;
  referenceId: string | null;
  registrationType: string;
  verificationCharge: number;
  isRegistered: boolean;
  isBankVerified: boolean;
  createdAt: Date;
};

export async function listKnteerBeneficiaries(
  userId: string
): Promise<KnteerBeneficiaryRow[]> {
  const rows = await prisma.knteerBeneficiary.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      accountLast4: true,
      ifscCode: true,
      accountHolderName: true,
      bankName: true,
      mobile: true,
      referenceId: true,
      registrationType: true,
      verificationCharge: true,
      isRegistered: true,
      isBankVerified: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    verificationCharge: Number(r.verificationCharge),
  }));
}
