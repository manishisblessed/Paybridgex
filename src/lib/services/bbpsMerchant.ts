/**
 * BBPS Merchant helpers — resolves a user's Chagans CC Bill merchantId.
 *
 * Every retailer must be onboarded as a merchant (KYC-validated via
 * POST /ccBillpay/createMerchant) before they can use the CC Bill Pay flow.
 * The returned merchantId is stored in BbpsMerchant.providerMerchantId.
 *
 * - requireChagansMerchant(): throws if the user doesn't have an ACTIVE merchant
 * - resolveChagansMerchantId(): returns merchantId or null (no throw)
 */

import { prisma } from "@/lib/db";

export class BbpsMerchantRequiredError extends Error {
  public statusCode = 403;
  constructor(message?: string) {
    super(message ?? "CC Bill Payment requires merchant onboarding. Please complete KYC first.");
    this.name = "BbpsMerchantRequiredError";
  }
}

export type BbpsMerchantInfo = {
  id: string;
  providerMerchantId: string;
  status: string;
  kycStatus: string | null;
};

/**
 * Look up the user's ACTIVE BbpsMerchant and return its providerMerchantId.
 * Every user must complete merchant onboarding before transacting — no fallback.
 */
export async function requireChagansMerchant(userId: string): Promise<BbpsMerchantInfo> {
  const merchant = await prisma.bbpsMerchant.findUnique({
    where: { userId },
    select: {
      id: true,
      providerMerchantId: true,
      status: true,
      kycStatus: true,
    },
  });

  if (merchant?.status === "ACTIVE" && merchant.providerMerchantId) {
    return {
      id: merchant.id,
      providerMerchantId: merchant.providerMerchantId,
      status: merchant.status,
      kycStatus: merchant.kycStatus,
    };
  }

  if (merchant?.status === "PENDING") {
    throw new BbpsMerchantRequiredError(
      "Your merchant onboarding is pending approval. Please wait for verification."
    );
  }

  if (merchant?.status === "REJECTED") {
    throw new BbpsMerchantRequiredError(
      "Your merchant onboarding was rejected. Please contact support."
    );
  }

  if (merchant?.status === "SUSPENDED") {
    throw new BbpsMerchantRequiredError(
      "Your merchant account has been suspended. Please contact support."
    );
  }

  throw new BbpsMerchantRequiredError();
}

/**
 * Soft lookup — returns the providerMerchantId or null. No throw.
 * Used for the biller list (getBillers) which can use any valid merchantId.
 */
export async function resolveChagansMerchantId(userId: string): Promise<string | null> {
  const merchant = await prisma.bbpsMerchant.findUnique({
    where: { userId },
    select: { providerMerchantId: true, status: true },
  });
  if (merchant?.status === "ACTIVE" && merchant.providerMerchantId) {
    return merchant.providerMerchantId;
  }
  return null;
}

/**
 * Check if a user already has a BBPS merchant record (any status).
 */
export async function getBbpsMerchantStatus(userId: string) {
  const merchant = await prisma.bbpsMerchant.findUnique({
    where: { userId },
    select: {
      id: true,
      providerMerchantId: true,
      status: true,
      kycStatus: true,
      createdAt: true,
      activatedAt: true,
    },
  });
  if (!merchant) return null;
  return {
    id: merchant.id,
    providerMerchantId: merchant.providerMerchantId,
    status: merchant.status,
    kycStatus: merchant.kycStatus,
    createdAt: merchant.createdAt.toISOString(),
    activatedAt: merchant.activatedAt?.toISOString() ?? null,
  };
}
