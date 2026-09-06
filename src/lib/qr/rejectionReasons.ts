/**
 * Predefined catalog of QR-claim rejection reasons. A fixed catalog (rather than
 * only free text) makes rejections filterable and reportable. Admins may select
 * multiple reasons and optionally add a free-text note for anything else.
 *
 * Values are the stable identifiers stored in QrClaim.rejectionReasons; labels
 * are the human-readable text composed into reviewNote (shown to the retailer).
 */

export const QR_REJECTION_REASONS = [
  { value: "AMOUNT_MISMATCH", label: "Amount does not match the payment" },
  { value: "UTR_NOT_FOUND", label: "UTR / RRN not found in the portal" },
  { value: "UTR_INVALID", label: "Invalid or fabricated UTR" },
  { value: "SCREENSHOT_UNCLEAR", label: "Screenshot is blurred or unreadable" },
  { value: "SCREENSHOT_EDITED", label: "Screenshot appears edited / tampered" },
  { value: "DUPLICATE_CLAIM", label: "Duplicate of an existing claim" },
  { value: "PAYMENT_NOT_RECEIVED", label: "Payment not received in the account" },
  { value: "WRONG_QR", label: "Payment made to a different / wrong QR" },
  { value: "NAME_MISMATCH", label: "Payer name does not match records" },
  { value: "SUSPECTED_FRAUD", label: "Suspected fraudulent activity" },
  { value: "OTHER", label: "Other (see note)" },
] as const;

export type QrRejectionReasonValue = (typeof QR_REJECTION_REASONS)[number]["value"];

const REASON_LABELS: Record<string, string> = Object.fromEntries(
  QR_REJECTION_REASONS.map((r) => [r.value, r.label])
);

export const QR_REJECTION_REASON_VALUES = QR_REJECTION_REASONS.map((r) => r.value);

/** Human label for a reason value (falls back to the raw value if unknown). */
export function rejectionReasonLabel(value: string): string {
  return REASON_LABELS[value] ?? value;
}

/**
 * Compose the human-readable reviewNote shown to the retailer from the selected
 * structured reasons plus an optional free-text note.
 */
export function composeRejectionNote(reasons: string[], note?: string): string {
  const labels = reasons.map(rejectionReasonLabel);
  const base = labels.join("; ");
  const extra = note?.trim();
  if (base && extra) return `${base} — ${extra}`;
  return base || extra || "Claim rejected";
}
