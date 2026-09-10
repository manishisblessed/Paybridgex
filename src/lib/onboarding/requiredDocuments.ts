/**
 * Canonical list of documents an onboardee MUST upload before their invite can
 * be registered. This is the single source of truth shared by:
 *   - the onboarding wizard UI (`src/app/(auth)/onboard/page.tsx`), and
 *   - the server-side registration gate (`.../register/route.ts`).
 *
 * Keep the two in sync via this module so the client and server can never drift
 * (i.e. so the flow cannot be bypassed by calling the register API directly).
 *
 * Document rows are persisted as `VerificationResult` records with a
 * `DOCUMENT_<TYPE>` type and status "Uploaded" during onboarding.
 */

/** Base documents every network onboardee must upload, regardless of role. */
export const REQUIRED_ONBOARD_DOC_TYPES = [
  "SIGNATURE",
  "ELECTRICITY_BILL",
  "CANCEL_CHEQUE",
  "ADDITIONAL_ID",
  "FAMILY_REFERENCE",
  "PG_FORM",
  "GPS_PHOTO_OUTSIDE",
  "GPS_PHOTO_INSIDE",
  "GPS_SELFIE_DISTRIBUTOR",
] as const;

export type RequiredOnboardDocType = (typeof REQUIRED_ONBOARD_DOC_TYPES)[number];

/**
 * Document types that are only required for RETAILER onboardees. The Payment
 * Gateway (PG) onboarding form applies to retailers who actually accept
 * payments; distributor tiers (DT/MD/SD) do not sign it.
 */
export const RETAILER_ONLY_DOC_TYPES = new Set<string>(["PG_FORM"]);

/**
 * Return the required document types for a given onboardee role. Retailer-only
 * documents (e.g. the PG form) are excluded for the distributor tiers.
 */
export function getRequiredDocTypes(role: string): readonly string[] {
  if (role === "RETAILER") return REQUIRED_ONBOARD_DOC_TYPES;
  return REQUIRED_ONBOARD_DOC_TYPES.filter((t) => !RETAILER_ONLY_DOC_TYPES.has(t));
}

/** Human-friendly labels for missing-document error messages. */
export const DOC_TYPE_LABELS: Record<string, string> = {
  PAN: "PAN Card",
  AADHAAR_FRONT: "Aadhaar (Front)",
  AADHAAR_BACK: "Aadhaar (Back)",
  SHOP_PHOTO: "Shop Photo",
  BANK_PROOF: "Bank Proof",
  CANCEL_CHEQUE: "Cancelled Cheque / Bank Passbook",
  PASSBOOK: "Bank Passbook",
  GST_CERT: "GST Certificate",
  SHOP_ESTABLISHMENT: "Shop & Establishment Certificate",
  GUMASTA_LICENSE: "Gumasta License",
  SIGNATURE: "Signature",
  ELECTRICITY_BILL: "Household Electricity Bill",
  ADDITIONAL_ID: "Additional ID Proof",
  FAMILY_REFERENCE: "Family Member Reference Document",
  PG_FORM: "PG Form",
  GPS_PHOTO_OUTSIDE: "GPS-tagged Photo (Outside)",
  GPS_PHOTO_INSIDE: "GPS-tagged Photo (Inside)",
  GPS_SELFIE_DISTRIBUTOR: "GPS-tagged Selfie with Distributor",
  DISTRIBUTOR_DECLARATION: "Distributor Declaration",
  SELF_DECLARATION: "Signed Self-Declaration",
  SUCCESSOR_DECLARATION: "Successor Declaration",
  SELFIE: "Live Selfie",
  ONBOARD_VIDEO: "Onboarding Liveness Video",
  LIVE_VIDEO: "Liveness Video",
  OTHER: "Other Document",
};

export function docTypeLabel(type: string): string {
  return DOC_TYPE_LABELS[type] ?? type.replace(/_/g, " ");
}
