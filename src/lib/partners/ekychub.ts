/**
 * eKYC Hub adapter — covers identity & bank verification APIs.
 *
 * Activate by: PARTNER_VERIFICATION_ENABLED=true
 * Required env: EKYCHUB_USERNAME, EKYCHUB_API_TOKEN, EKYCHUB_BASE_URL
 *
 * All eKYC Hub APIs are GET requests with auth passed as query params.
 * Responses follow: { status: "Success", ...data } | { status: "Failure", message }
 */
import type { PartnerResult } from "./types";

function baseUrl(): string {
  return process.env.EKYCHUB_BASE_URL || "https://connect.ekychub.in/v3";
}

function username(): string {
  return process.env.EKYCHUB_USERNAME!;
}

function token(): string {
  return process.env.EKYCHUB_API_TOKEN!;
}

export function ekychubConfigured(): boolean {
  return !!(process.env.EKYCHUB_USERNAME && process.env.EKYCHUB_API_TOKEN);
}

async function ekychubGet<T>(
  path: string,
  params: Record<string, string>
): Promise<PartnerResult<T>> {
  const url = new URL(`${baseUrl()}${path}`);
  url.searchParams.set("username", username());
  url.searchParams.set("token", token());
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  return parseEkychubResponse<T>(res);
}

async function parseEkychubResponse<T>(res: Response): Promise<PartnerResult<T>> {
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      ok: false as const,
      code: "EKYCHUB_FAILURE",
      message: `Verification service error (HTTP ${res.status}). Please try again or contact support.`,
      raw: { status: res.status, body: text.slice(0, 500) },
    };
  }

  if (data.status === "Success") {
    return { ok: true, data: data as T, raw: data };
  }
  return {
    ok: false,
    code: "EKYCHUB_FAILURE",
    message: data.message ?? "Verification failed",
    raw: data,
  };
}

// ---------------------------------------------------------------------------
// Balance Check
// ---------------------------------------------------------------------------

export interface EkycBalanceResponse {
  status: string;
  balance: string;
}

export async function checkBalance(): Promise<PartnerResult<EkycBalanceResponse>> {
  return ekychubGet("/verification/balance", {});
}

// ---------------------------------------------------------------------------
// PAN 360 Verification
// ---------------------------------------------------------------------------

export interface Pan360Response {
  status: string;
  pan: string;
  type: string;
  registered_name: string;
  gender: string;
  date_of_birth: string;
  masked_aadhaar_number: string;
  aadhaar_linked: boolean;
  message: string;
}

export async function verifyPan360(input: {
  pan: string;
  orderid: string;
}): Promise<PartnerResult<Pan360Response>> {
  return ekychubGet("/verification/pan_360", {
    pan: input.pan.toUpperCase(),
    orderid: input.orderid,
  });
}

// ---------------------------------------------------------------------------
// GST Verification
// ---------------------------------------------------------------------------

export interface GstResponse {
  status: string;
  GSTIN: string;
  legal_name_of_business: string;
  trade_name_of_business: string;
  center_jurisdiction: string;
  state_jurisdiction: string;
  constitution_of_business: string;
  taxpayer_type: string;
  gst_in_status: string;
  last_update_date: string;
  principal_place_address: string;
  message: string;
}

export async function verifyGst(input: {
  gst: string;
  orderid: string;
}): Promise<PartnerResult<GstResponse>> {
  return ekychubGet("/verification/gst_verification", {
    gst: input.gst.toUpperCase(),
    orderid: input.orderid,
  });
}

// ---------------------------------------------------------------------------
// Bank Verification (Advance — no penny drop)
// ---------------------------------------------------------------------------

export interface BankVerifyResponse {
  status: string;
  nameAtBank: string;
  bankName: string;
  utr: string;
  city: string;
  branch: string;
  micr: number;
  message: string;
}

export async function verifyBankAdvance(input: {
  account_number: string;
  ifsc: string;
  orderid: string;
}): Promise<PartnerResult<BankVerifyResponse>> {
  return ekychubGet("/verification/bank_verification", {
    account_number: input.account_number,
    ifsc: input.ifsc.toUpperCase(),
    orderid: input.orderid,
  });
}

// ---------------------------------------------------------------------------
// Penny Drop (Bank Account Verification)
// ---------------------------------------------------------------------------

export interface PennyDropResponse {
  status: string;
  "Account Number": string;
  "Ifsc Code": string;
  nameAtBank: string;
  utr: string;
  message: string;
}

export async function verifyPennyDrop(input: {
  account_number: string;
  ifsc: string;
  orderid: string;
}): Promise<PartnerResult<PennyDropResponse>> {
  return ekychubGet("/verification/penny_drop", {
    account_number: input.account_number,
    ifsc: input.ifsc.toUpperCase(),
    orderid: input.orderid,
  });
}

// ---------------------------------------------------------------------------
// Company CIN Verification
// ---------------------------------------------------------------------------

export interface CinResponse {
  status: string;
  message: string;
  company_name: string;
  data: {
    verification_id: string;
    reference_id: number;
    status: string;
    cin: string;
    company_name: string;
    registration_number: number;
    incorporation_date: string;
    cin_status: string;
    email: string;
    incorporation_country: string;
    director_details: Array<{
      dob: string;
      designation: string;
      address: string;
      din: string;
      name: string;
    }>;
  };
}

export async function verifyCin(input: {
  cin: string;
  orderid: string;
}): Promise<PartnerResult<CinResponse>> {
  return ekychubGet("/verification/cin", {
    cin: input.cin.toUpperCase(),
    orderid: input.orderid,
  });
}

// ---------------------------------------------------------------------------
// Digilocker — Step 1: Create Redirect URL
// ---------------------------------------------------------------------------

export interface DigilockerUrlResponse {
  verification_id: string;
  reference_id: number;
  url: string;
  status: string;
  document_requested: string[];
  user_flow: string;
  redirect_url: string;
  message: string;
  txid: number;
}

export async function createDigilockerUrl(input: {
  document_type: "AADHAAR" | "PAN";
  redirect_url: string;
  orderid: string;
}): Promise<PartnerResult<DigilockerUrlResponse>> {
  const path =
    input.document_type === "AADHAAR"
      ? "/digilocker/create_url_aadhaar"
      : "/digilocker/create_url_pan";

  return ekychubGet(path, {
    redirect_url: input.redirect_url,
    orderid: input.orderid,
  });
}

// ---------------------------------------------------------------------------
// Digilocker — Step 2: Get Document
// ---------------------------------------------------------------------------

export interface DigilockerDocResponse {
  reference_id: number;
  verification_id: string;
  status: string;
  name: string;
  uid: string;
  dob: string;
  gender: string;
  care_of: string;
  address: string;
  split_address: {
    country: string;
    dist: string;
    house: string;
    landmark: string;
    pincode: string;
    po: string;
    state: string;
    street: string;
    subdist: string;
    vtc: string;
  };
  year_of_birth: string;
  photo_link: string;
  xml_file: string;
  message: string;
}

export async function getDigilockerDocument(input: {
  verification_id: string;
  reference_id: string;
  orderid: string;
  document_type: "AADHAAR" | "PAN";
}): Promise<PartnerResult<DigilockerDocResponse>> {
  return ekychubGet("/digilocker/get_document", {
    verification_id: input.verification_id,
    reference_id: input.reference_id,
    orderid: input.orderid,
    document_type: input.document_type,
  });
}

// ---------------------------------------------------------------------------
// Monthly Re-KYC Aadhaar re-verification (Phase 13)
//
// Re-KYC reuses the DigiLocker Aadhaar flow above (createDigilockerUrl +
// getDigilockerDocument) — the same live contract used during onboarding. The
// previous standalone Aadhaar-OTP endpoints were never part of eKYC Hub's live
// API (they returned 404) and have been removed.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Face match (liveness selfie/video frame vs. an enrolled baseline — Phase 13/14)
//
// Compares a freshly-captured face image against the stored onboarding
// baseline reference and returns a confidence score. The caller supplies opaque
// provider-side references (never raw biometrics travel through our DB).
// ---------------------------------------------------------------------------

export interface FaceMatchResponse {
  status: string;
  match: boolean;
  /** 0..100 confidence; the caller compares against its own threshold. */
  confidence: number;
  message: string;
}

export async function faceMatch(input: {
  /** Provider reference for the enrolled baseline (from onboarding). */
  baselineRef: string;
  /** Provider reference for the freshly-captured liveness frame. */
  probeRef: string;
  orderid: string;
}): Promise<PartnerResult<FaceMatchResponse>> {
  const path = process.env.EKYCHUB_FACE_MATCH_PATH || "/face/match";
  return ekychubGet(path, {
    baseline_ref: input.baselineRef,
    probe_ref: input.probeRef,
    orderid: input.orderid,
  });
}

// ---------------------------------------------------------------------------
// Face register (enroll an onboarding baseline — Phase 14)
//
// Registers a single clear face frame (extracted from the onboarding liveness
// video) as the user's baseline and returns an opaque provider reference. The
// raw frame is delivered to the provider out-of-band (a short-TTL signed URL);
// our DB only ever stores the returned reference, field-encrypted.
// ---------------------------------------------------------------------------

export interface FaceRegisterResponse {
  status: string;
  /** Provider-side reference for the enrolled baseline. */
  reference_id: string | number;
  /** Whether a usable face was detected in the supplied frame. */
  face_detected?: boolean;
  message: string;
}

export async function faceRegister(input: {
  /** A short-TTL URL the provider can fetch the face frame from. */
  imageUrl: string;
  orderid: string;
}): Promise<PartnerResult<FaceRegisterResponse>> {
  const path = process.env.EKYCHUB_FACE_REGISTER_PATH || "/face/register";
  return ekychubGet(path, { image: input.imageUrl, orderid: input.orderid });
}

// ---------------------------------------------------------------------------
// Card BIN Checker
// ---------------------------------------------------------------------------

export interface CardBinResponse {
  status: string;
  bin: string;
  cardNetwork: string;
  cardType: string;
  cardLevel: string;
  country: string;
  issuerBank: string;
  message: string;
}

export async function checkCardBin(input: {
  card: string;
  orderid: string;
}): Promise<PartnerResult<CardBinResponse>> {
  return ekychubGet("/verification/bin", {
    card: input.card.slice(0, 6),
    orderid: input.orderid,
  });
}

// ---------------------------------------------------------------------------
// Unified verification provider interface
// ---------------------------------------------------------------------------

export const ekychubVerification = {
  name: "EKYCHUB",
  checkBalance,
  verifyPan360,
  verifyGst,
  verifyBankAdvance,
  verifyPennyDrop,
  verifyCin,
  createDigilockerUrl,
  getDigilockerDocument,
  faceMatch,
  faceRegister,
  checkCardBin,
} as const;
