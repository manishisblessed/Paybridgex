/**
 * Re-KYC method configuration (Phase 13).
 *
 * The monthly re-verification method is configurable via the REKYC_METHOD env:
 *   - "aadhaar_otp"      → Aadhaar re-verification only (default)
 *   - "face_match"       → liveness face match only
 *   - "aadhaar_otp+face" → Aadhaar re-verification AND a fresh liveness face match
 *
 * NOTE: the Aadhaar factor now uses the DigiLocker flow (the same one used at
 * onboarding), not a standalone OTP. The "aadhaar_otp" method values are kept
 * for backward compatibility with existing deployments; the "aadhaar"/"aadhaar+
 * face" aliases mean the same thing. Aadhaar is the primary factor; face match
 * is layered on when the method includes it and compares a FRESH liveness
 * capture against the onboarding baseline (Phase 14).
 */

export type ReKycMethod = "aadhaar_otp" | "face_match" | "aadhaar_otp+face";

const ALIASES: Record<string, ReKycMethod> = {
  aadhaar_otp: "aadhaar_otp",
  aadhaar: "aadhaar_otp",
  face_match: "face_match",
  face: "face_match",
  "aadhaar_otp+face": "aadhaar_otp+face",
  "aadhaar+face": "aadhaar_otp+face",
};

export function reKycMethod(): ReKycMethod {
  const raw = (process.env.REKYC_METHOD || "aadhaar_otp").trim();
  return ALIASES[raw] ?? "aadhaar_otp";
}

export function methodRequiresAadhaar(method: ReKycMethod): boolean {
  return method === "aadhaar_otp" || method === "aadhaar_otp+face";
}

export function methodRequiresFace(method: ReKycMethod): boolean {
  return method === "face_match" || method === "aadhaar_otp+face";
}

/** Minimum face-match confidence (0..100) to accept a monthly re-KYC. */
export function faceMatchThreshold(): number {
  const n = Number(process.env.REKYC_FACE_MATCH_THRESHOLD ?? "80");
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 80;
}
