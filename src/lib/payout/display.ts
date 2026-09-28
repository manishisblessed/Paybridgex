// =====================================================================
// Payout display helpers — shared by the All Transactions feed and the
// transaction-receipt route so payouts (which live on PayoutRequest, NOT the
// Transaction table) render consistently wherever they are folded in.
// =====================================================================

import type { PayoutStatus, PayoutMode } from "@prisma/client";

/** Map a PayoutRequest status to the tri-state display status the feed uses. */
export function payoutDisplayStatus(
  status: PayoutStatus
): "Success" | "Pending" | "Failed" {
  if (status === "SUCCESS") return "Success";
  if (status === "FAILED" || status === "REJECTED" || status === "REVERSED")
    return "Failed";
  // DRAFT | PENDING_APPROVAL | APPROVED | PROCESSING
  return "Pending";
}

/** PayoutStatus values that back each display status (for status filtering). */
export const PAYOUT_STATUS_GROUPS: Record<string, PayoutStatus[]> = {
  Success: ["SUCCESS"],
  Pending: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "PROCESSING"],
  Failed: ["FAILED", "REJECTED", "REVERSED"],
};

/** Feed "Service" label for a payout, e.g. "Payout - IMPS". */
export function payoutServiceLabel(mode: PayoutMode): string {
  return `Payout - ${mode}`;
}

/** Feed "Customer" label for a payout — beneficiary name + masked account. */
export function payoutCustomerLabel(
  beneficiaryName: string,
  accountLast4: string
): string {
  return accountLast4
    ? `${beneficiaryName} ••${accountLast4}`
    : beneficiaryName;
}
