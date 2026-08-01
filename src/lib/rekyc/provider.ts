import { nanoid } from "nanoid";
import { flags, isProd } from "../env";
import {
  ekychubConfigured,
  createDigilockerUrl as hubDigilockerUrl,
  getDigilockerDocument as hubDigilockerDoc,
  faceMatch as hubFaceMatch,
} from "../partners/ekychub";

/**
 * Re-KYC provider abstraction over the eKYC Hub.
 *
 * Aadhaar re-verification reuses the SAME DigiLocker flow as onboarding: we
 * create a DigiLocker redirect URL, the user authenticates with UIDAI, and we
 * pull the verified Aadhaar document back. (The earlier Aadhaar-OTP endpoints
 * were never part of eKYC Hub's live contract and returned 404 → 502.)
 *
 * Live path (PARTNER_VERIFICATION_ENABLED=true AND eKYC Hub creds present):
 *   real calls to the eKYC Hub DigiLocker and face-match APIs.
 *
 * Simulated path (provider not configured AND NODE_ENV !== "production"):
 *   deterministic local stubs so the whole gate → flow → unblock cycle is
 *   testable end-to-end without external creds. The simulated DigiLocker URL
 *   loops straight back to the redirect URL.
 *
 * In production the simulated path is refused — a missing/disabled provider
 * surfaces a clear error rather than silently waving identity checks through.
 */

export type ReKycProviderName = "EKYCHUB" | "SIMULATED";

export function rekycLive(): boolean {
  return flags.verification && ekychubConfigured();
}

export function rekycProviderName(): ReKycProviderName {
  return rekycLive() ? "EKYCHUB" : "SIMULATED";
}

function assertSimulationAllowed(): void {
  if (isProd) {
    throw new Error(
      "[rekyc] Verification provider (eKYC Hub) is not configured. Set " +
        "PARTNER_VERIFICATION_ENABLED=true and EKYCHUB_USERNAME/EKYCHUB_API_TOKEN."
    );
  }
}

export type AadhaarInitResult =
  | { ok: true; url: string; verificationId: string; referenceId: string }
  | { ok: false; code: string; message: string };

/**
 * Open a DigiLocker Aadhaar session. Returns the redirect URL the user must
 * visit plus the opaque verification/reference ids we persist on the ReKycLog
 * to fetch the document after they return.
 */
export async function initiateAadhaarDigilocker(input: {
  redirectUrl: string;
  orderid: string;
}): Promise<AadhaarInitResult> {
  if (rekycLive()) {
    const res = await hubDigilockerUrl({
      document_type: "AADHAAR",
      redirect_url: input.redirectUrl,
      orderid: input.orderid,
    });
    if (res.ok) {
      return {
        ok: true,
        url: res.data.url,
        verificationId: String(res.data.verification_id),
        referenceId: String(res.data.reference_id),
      };
    }
    return { ok: false, code: res.code, message: res.message };
  }
  assertSimulationAllowed();
  // Loop straight back so the dev flow completes without a real DigiLocker hop.
  return {
    ok: true,
    url: input.redirectUrl,
    verificationId: `SIMVID_${nanoid(10)}`,
    referenceId: `SIMREF_${nanoid(10)}`,
  };
}

export type AadhaarCompleteResult =
  | { ok: true; name: string; uid: string | null; dob: string | null; gender: string | null }
  | { ok: false; code: string; message: string };

/**
 * Pull the verified Aadhaar document after the user completes DigiLocker.
 * `uid` is eKYC Hub's returned Aadhaar identifier — the caller matches it
 * against the user's on-file Aadhaar so a hijacked session can't re-verify with
 * a different Aadhaar.
 */
export async function completeAadhaarDigilocker(input: {
  verificationId: string;
  referenceId: string;
  orderid: string;
}): Promise<AadhaarCompleteResult> {
  if (rekycLive()) {
    const res = await hubDigilockerDoc({
      verification_id: input.verificationId,
      reference_id: input.referenceId,
      orderid: input.orderid,
      document_type: "AADHAAR",
    });
    if (res.ok) {
      return {
        ok: true,
        name: res.data.name,
        uid: res.data.uid ?? null,
        dob: res.data.dob ?? null,
        gender: res.data.gender ?? null,
      };
    }
    return { ok: false, code: res.code, message: res.message };
  }
  assertSimulationAllowed();
  // Simulated document — the service skips the identity match off the live path.
  return { ok: true, name: "SIMULATED USER", uid: null, dob: null, gender: null };
}

export type FaceMatchResult =
  | { ok: true; match: boolean; confidence: number }
  | { ok: false; code: string; message: string };

export async function matchFace(input: {
  baselineRef: string;
  probeRef: string;
  orderid: string;
}): Promise<FaceMatchResult> {
  if (rekycLive()) {
    const res = await hubFaceMatch({
      baselineRef: input.baselineRef,
      probeRef: input.probeRef,
      orderid: input.orderid,
    });
    if (res.ok) return { ok: true, match: res.data.match, confidence: res.data.confidence };
    return { ok: false, code: res.code, message: res.message };
  }
  assertSimulationAllowed();
  // Simulated match passes when a probe is supplied.
  return { ok: true, match: !!input.probeRef, confidence: input.probeRef ? 99 : 0 };
}
