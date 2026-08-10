"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Building2,
  CreditCard,
  User,
  Lock,
  Phone,
  Mail,
  Fingerprint,
  Upload,
  FileText,
  AlertTriangle,
  ArrowDown,
  Eye,
  EyeOff,
  FileSignature,
  Send,
  Clock,
  XCircle,
  Camera,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select } from "@/components/ui/Input";
import { namesMatch } from "@/lib/utils";
import { extractGpsFromFile } from "@/lib/gps";
import { LivenessVideoCapture } from "@/components/kyc/LivenessVideoCapture";
import { SelfieCapture } from "@/components/kyc/SelfieCapture";
import { GpsPhotoCapture, type GpsCapture } from "@/components/kyc/GpsPhotoCapture";
import { InAppBrowserWarning } from "@/components/kyc/InAppBrowserWarning";

type InviteData = {
  id: string;
  phone: string;
  email: string;
  role: string;
  name: string | null;
  status: string;
  expiresAt: string;
  phoneVerifiedAt: string | null;
  emailVerifiedAt: string | null;
  aadhaarVerifiedAt: string | null;
};

type Verification = {
  type: string;
  status: string;
  verifiedName: string | null;
  responsePayload?: any;
};

const STEPS = [
  { label: "Welcome", icon: ShieldCheck },
  { label: "Mobile Verification", icon: Phone },
  { label: "Email Verification", icon: Mail },
  { label: "Aadhaar Verification", icon: Fingerprint },
  { label: "PAN Verification", icon: CreditCard },
  { label: "Bank Verification", icon: Building2 },
  { label: "GST & MSME", icon: Building2 },
  { label: "Selfie & Video", icon: Upload },
  { label: "Documents", icon: FileText },
  { label: "Declaration", icon: FileSignature },
  { label: "Details & Password", icon: Lock },
] as const;

type DocumentDef = {
  type: string;
  label: string;
  required: boolean;
  accept: string;
  requiresGps?: boolean;
  description?: string;
  downloadUrl?: string;
};

const REQUIRED_DOCUMENTS: DocumentDef[] = [
  { type: "GST_CERT", label: "GST Certificate", required: false, accept: "image/*,.pdf" },
  { type: "SHOP_ESTABLISHMENT", label: "Shop & Establishment Certificate", required: false, accept: "image/*,.pdf" },
  { type: "GUMASTA_LICENSE", label: "Gumasta License", required: false, accept: "image/*,.pdf" },
  { type: "SIGNATURE", label: "Signature", required: true, accept: "image/*" },
  { type: "ELECTRICITY_BILL", label: "Household Electricity Bill (copy)", required: true, accept: "image/*,.pdf" },
  { type: "CANCEL_CHEQUE", label: "Cancelled Cheque / Bank Passbook (with account holder name)", required: true, accept: "image/*,.pdf", description: "Already verified via penny drop, but physical copy needed" },
  { type: "ADDITIONAL_ID", label: "Additional ID Proof (Driving License / Voter ID / Passport)", required: true, accept: "image/*,.pdf" },
  { type: "FAMILY_REFERENCE", label: "Family Member Reference Document — KYC Document", required: true, accept: "image/*,.pdf" },
  { type: "PG_FORM", label: "PG Form (Payment Gateway onboarding form — signed)", required: true, accept: "image/*,.pdf" },
  { type: "GPS_PHOTO_OUTSIDE", label: "GPS-tagged Photo — House/Office (Outside)", required: true, accept: "image/*", requiresGps: true },
  { type: "GPS_PHOTO_INSIDE", label: "GPS-tagged Photo — House/Office (Inside)", required: true, accept: "image/*", requiresGps: true },
  { type: "GPS_SELFIE_DISTRIBUTOR", label: "GPS-tagged Selfie with Salesperson/Distributor", required: true, accept: "image/*", requiresGps: true, description: "Mandatory — take a selfie with your distributor/salesperson at your location" },
];

const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand",
  "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan",
  "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh",
  "Uttarakhand", "West Bengal",
];

// Persisted across the full-page DigiLocker redirect so we can auto-complete
// the Aadhaar step when the user returns (works on mobile, where popups and
// window.opener/postMessage are unreliable).
const DIGILOCKER_STORAGE_KEY = "ngp_digilocker_pending";

export default function OnboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-brand-50">
          <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
        </div>
      }
    >
      <OnboardContent />
    </Suspense>
  );
}

function OnboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const urlToken = searchParams.get("token");
  // Token may be absent on the DigiLocker return (we redirect back to a clean
  // /onboard URL to avoid tripping the eKYC Hub WAF). Recover it from storage.
  const [token, setToken] = useState<string | null>(urlToken);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [invite, setInvite] = useState<InviteData | null>(null);
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);

  // Form state
  const [form, setForm] = useState({
    name: "",
    shopName: "",
    shopAddress: "",
    city: "",
    state: "Delhi",
    pincode: "",
    dob: "",
    panNumber: "",
    aadhaarLast4: "",
    aadhaarNumber: "",
    aadhaarName: "",
    aadhaarDob: "",
    aadhaarGender: "",
    aadhaarAddress: "",
    aadhaarMobile: "",
    bankAccountNumber: "",
    bankIfsc: "",
    bankName: "",
    bankAccountStatus: "",
    gstin: "",
    msmeNumber: "",
    password: "",
    confirmPassword: "",
  });

  // Verification results
  const [panResult, setPanResult] = useState<any>(null);
  const [bankResult, setBankResult] = useState<any>(null);
  const [gstResult, setGstResult] = useState<any>(null);
  const [aadhaarResult, setAadhaarResult] = useState<any>(null);
  const [verifying, setVerifying] = useState(false);

  // Derived (not state) so it recomputes when a step is edited & re-verified.
  const bankRefName = aadhaarResult?.name || panResult?.registered_name;
  const nameMismatch =
    !!(
      aadhaarResult?.name &&
      panResult?.registered_name &&
      !namesMatch(aadhaarResult.name, panResult.registered_name)
    ) ||
    !!(
      bankRefName &&
      bankResult?.nameAtBank &&
      !namesMatch(bankRefName, bankResult.nameAtBank)
    );

  // Name-mismatch self-declaration popup
  const [showNameDeclaration, setShowNameDeclaration] = useState(false);
  const [nameDeclarationChecked, setNameDeclarationChecked] = useState(false);

  // OTP state
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpResendTimer, setOtpResendTimer] = useState(0);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [aadhaarVerified, setAadhaarVerified] = useState(false);

  // Digilocker state
  const [digilockerPending, setDigilockerPending] = useState(false);
  const [digilockerIds, setDigilockerIds] = useState<{
    verification_id: string;
    reference_id: string;
  } | null>(null);

  // Document upload state
  const [uploadedDocs, setUploadedDocs] = useState<Record<string, boolean>>({});
  const [uploading, setUploading] = useState<string | null>(null);

  // Selfie & video state
  const [selfieUploaded, setSelfieUploaded] = useState(false);
  const [videoCompleted, setVideoCompleted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Declaration state
  const [selfDeclarationUploaded, setSelfDeclarationUploaded] = useState(false);
  const [declarationStatus, setDeclarationStatus] = useState<{
    requiresApproval: boolean;
    approverName: string | null;
    approval: {
      id: string;
      status: string;
      approvedAt: string | null;
      rejectedAt: string | null;
      rejectedReason: string | null;
      sentAt: string;
    } | null;
  } | null>(null);
  const [declarationSending, setDeclarationSending] = useState(false);
  const [declarationPolling, setDeclarationPolling] = useState(false);

  // Partner agreement eSign (Leegality) state
  const [agreement, setAgreement] = useState<{
    sent: boolean;
    configured?: boolean;
    status: string | null;
    signUrl?: string | null;
  } | null>(null);
  const [agreementSending, setAgreementSending] = useState(false);

  // Recover the token from a pending DigiLocker flow when it's missing from the
  // URL (the DigiLocker return lands on a clean /onboard with no query string).
  useEffect(() => {
    if (urlToken) {
      setToken(urlToken);
      return;
    }
    if (token) return;
    try {
      const raw = localStorage.getItem(DIGILOCKER_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.token) setToken(parsed.token);
      }
    } catch {}
  }, [urlToken]);

  useEffect(() => {
    if (token) {
      fetchInvite();
      return;
    }
    // No token yet — it may still be recovered from a pending DigiLocker flow.
    let hasPending = false;
    try {
      hasPending = !!localStorage.getItem(DIGILOCKER_STORAGE_KEY);
    } catch {}
    if (!hasPending) {
      setError("Invalid onboarding link. No token found.");
      setLoading(false);
    }
  }, [token]);

  const autoVerifyRef = useRef(false);

  useEffect(() => {
    if (otpResendTimer <= 0) return;
    const t = setTimeout(() => setOtpResendTimer((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [otpResendTimer]);

  async function fetchInvite() {
    setLoading(true);
    const res = await fetch(`/api/onboard/${token}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Invalid invite link");
      setLoading(false);
      return;
    }
    // A re-opened invite is a targeted document re-upload, not a fresh
    // onboarding — send the applicant to the dedicated resubmission page.
    if (data.invite?.status === "RESUBMIT") {
      router.replace(`/onboard/resubmit?token=${token}`);
      return;
    }
    setInvite(data.invite);
    setVerifications(data.verifications ?? []);

    if (data.invite.name) {
      setForm((f) => ({ ...f, name: data.invite.name }));
    }

    // Restore verification state from invite
    if (data.invite.phoneVerifiedAt) setPhoneVerified(true);
    if (data.invite.emailVerifiedAt) setEmailVerified(true);
    if (data.invite.aadhaarVerifiedAt) setAadhaarVerified(true);

    // Restore verification results from previous session
    const vList = data.verifications ?? [];
    const aadhaarV = vList.find(
      (v: Verification) => v.type === "AADHAAR_DIGILOCKER" && v.status === "Success"
    );
    if (aadhaarV) {
      const payload = aadhaarV.responsePayload as any;
      setAadhaarResult({
        name: aadhaarV.verifiedName ?? payload?.name,
        uid: payload?.uid,
        dob: payload?.dob,
        gender: payload?.gender,
        address: payload?.address,
        split_address: payload?.split_address,
      });
      setForm((f) => ({
        ...f,
        // Full Name always comes from the verified Aadhaar record (overrides invite name).
        name: aadhaarV.verifiedName || payload?.name || f.name || "",
        // Shop/Firm name must come from GST (or manual entry), never the Aadhaar name.
        shopName: f.shopName,
        shopAddress: f.shopAddress || payload?.address || "",
        aadhaarName: aadhaarV.verifiedName || payload?.name || "",
        aadhaarNumber: payload?.uid || "",
        aadhaarLast4: payload?.uid ? payload.uid.slice(-4) : "",
        aadhaarDob: payload?.dob || "",
        aadhaarGender: payload?.gender || "",
        aadhaarAddress: payload?.address || "",
        aadhaarMobile: payload?.aadhaarMobile || "",
        dob: payload?.dob || f.dob,
        state: payload?.split_address?.state || f.state,
        pincode: payload?.split_address?.pincode || f.pincode,
        city: payload?.split_address?.dist || f.city,
      }));
    }

    const panV = vList.find(
      (v: Verification) => v.type === "PAN_360" && v.status === "Success"
    );
    if (panV) {
      setPanResult({ registered_name: panV.verifiedName });
    }

    const bankV = vList.find(
      (v: Verification) =>
        (v.type === "BANK_PENNY_DROP" || v.type === "BANK_ADVANCE") &&
        v.status === "Success"
    );
    if (bankV) {
      setBankResult({ nameAtBank: bankV.verifiedName });
    }

    const gstV = vList.find(
      (v: Verification) => v.type === "GST" && v.status === "Success"
    );
    let restoredShop = "";
    if (gstV) {
      const gp = (gstV.responsePayload ?? {}) as any;
      const tradeName =
        gp.trade_name ??
        gp.trade_name_of_business ??
        gp.legal_name ??
        gp.legal_name_of_business ??
        gstV.verifiedName ??
        "";
      setGstResult(gp);
      restoredShop = tradeName;
    }

    // Manual business name when GST was skipped or returned no trade name.
    if (!restoredShop) {
      const bizV = vList.find(
        (v: Verification) => v.type === "BUSINESS_NAME" && v.status === "Success"
      );
      if (bizV?.verifiedName) restoredShop = bizV.verifiedName;
    }
    if (restoredShop) {
      setForm((f) => ({ ...f, shopName: restoredShop }));
    }

    // Restore uploaded documents / selfie / video / declaration so a page
    // reload doesn't force the applicant to upload everything again.
    const docFlags: Record<string, boolean> = {};
    for (const v of vList as Verification[]) {
      if (v.type.startsWith("DOCUMENT_") && v.status === "Uploaded") {
        docFlags[v.type.replace("DOCUMENT_", "")] = true;
      }
    }
    setUploadedDocs(docFlags);
    setSelfieUploaded(!!docFlags.SELFIE);
    setSelfDeclarationUploaded(!!docFlags.SELF_DECLARATION);
    setVideoCompleted(
      vList.some(
        (v: Verification) => v.type === "ONBOARD_VIDEO" && v.status === "Uploaded"
      )
    );

    setLoading(false);
  }

  function updateForm(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // ----- OTP -----
  function handleOtpChange(value: string, channel: "SMS" | "EMAIL") {
    const cleaned = value.replace(/\D/g, "").slice(0, 6);
    setOtpCode(cleaned);
    if (cleaned.length === 6 && otpSent && !verifying && !autoVerifyRef.current) {
      autoVerifyRef.current = true;
      verifyOtp(channel, cleaned).finally(() => { autoVerifyRef.current = false; });
    }
  }

  async function sendOtp(channel: "SMS" | "EMAIL") {
    setVerifying(true);
    setError("");
    setOtpCode("");
    try {
      const res = await fetch(`/api/onboard/${token}/otp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const data = await res.json();
      if (data.alreadyVerified) {
        if (channel === "SMS") setPhoneVerified(true);
        else setEmailVerified(true);
      } else if (data.ok) {
        setOtpSent(true);
        setOtpResendTimer(60);
      } else {
        setError(data.error ?? "Failed to send OTP");
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setVerifying(false);
  }

  async function verifyOtp(channel: "SMS" | "EMAIL", codeOverride?: string) {
    const code = codeOverride ?? otpCode;
    if (code.length !== 6) {
      setError("Please enter the 6-digit OTP");
      return;
    }
    setVerifying(true);
    setError("");
    try {
      const res = await fetch(`/api/onboard/${token}/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, code }),
      });
      const data = await res.json();
      if (data.ok) {
        if (channel === "SMS") setPhoneVerified(true);
        else setEmailVerified(true);
        setOtpSent(false);
        setOtpCode("");
      } else {
        setError(data.error ?? "Invalid OTP");
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setVerifying(false);
  }

  // ----- Aadhaar DigiLocker -----
  async function initAadhaar() {
    setVerifying(true);
    setError("");
    // IMPORTANT: keep the redirect URL CLEAN (no query string). A nested query
    // string in redirect_url trips the eKYC Hub WAF and returns a 403. We carry
    // the token + verification IDs through localStorage instead.
    const redirectUrl = `${window.location.origin}/onboard`;
    try {
      const res = await fetch(`/api/onboard/${token}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "AADHAAR_INIT",
          redirect_url: redirectUrl,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        const ids = {
          verification_id: data.data.verification_id,
          reference_id: String(data.data.reference_id),
        };
        setDigilockerIds(ids);
        // Persist so we can finish the flow after the full-page redirect back.
        try {
          localStorage.setItem(
            DIGILOCKER_STORAGE_KEY,
            JSON.stringify({ token, ...ids, ts: Date.now() })
          );
        } catch {}
        // Full-page redirect (reliable on mobile & desktop — no popup needed).
        window.location.href = data.data.url;
        return;
      } else {
        const msg = data.message ?? "Failed to initiate Aadhaar verification";
        if (msg.includes("HTTP 403") || msg.includes("service error")) {
          setError("Aadhaar DigiLocker service is temporarily unavailable. Please try again in a few minutes or contact support.");
        } else {
          setError(msg);
        }
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setVerifying(false);
  }

  // On return from DigiLocker, auto-finish the step. We detect the return via a
  // recent pending record in localStorage (the redirect URL is clean, so there
  // is no query flag to read).
  const digilockerResumeRef = useRef(false);
  useEffect(() => {
    if (loading) return;
    // NOTE: no early-return on aadhaarVerified — a pending record also exists
    // when the user re-verifies with a different Aadhaar (Edit flow).
    if (digilockerResumeRef.current) return;

    let pending: any = null;
    try {
      const raw = localStorage.getItem(DIGILOCKER_STORAGE_KEY);
      if (raw) pending = JSON.parse(raw);
    } catch {}

    if (!pending?.verification_id || !pending?.reference_id) return;
    if (pending.token !== token) return;
    // Only auto-resume shortly after initiation (avoid acting on stale records).
    if (pending.ts && Date.now() - pending.ts > 20 * 60 * 1000) return;

    digilockerResumeRef.current = true;

    // Consume the record so a later refresh doesn't re-trigger a stale attempt.
    try {
      localStorage.removeItem(DIGILOCKER_STORAGE_KEY);
    } catch {}

    const ids = {
      verification_id: pending.verification_id,
      reference_id: String(pending.reference_id),
    };
    setDigilockerIds(ids);
    setStep(3);
    setDigilockerPending(true);
    completeAadhaar(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, token]);

  async function completeAadhaar(idsOverride?: {
    verification_id: string;
    reference_id: string;
  }) {
    const ids = idsOverride ?? digilockerIds;
    if (!ids) return;
    setVerifying(true);
    setError("");
    try {
      const res = await fetch(`/api/onboard/${token}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "AADHAAR_COMPLETE",
          verification_id: ids.verification_id,
          reference_id: ids.reference_id,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setAadhaarResult(data.data);
        setAadhaarVerified(true);
        setDigilockerPending(false);
        try {
          localStorage.removeItem(DIGILOCKER_STORAGE_KEY);
        } catch {}
        // Restore the token in the URL (we returned to a clean /onboard) so a
        // refresh reloads the correct invite.
        if (!urlToken && token) {
          router.replace(`/onboard?token=${token}`);
        }
        setForm((f) => ({
          ...f,
          // Full Name always comes from the verified Aadhaar record (overrides invite name).
          name: data.data.name || f.name || "",
          // Shop/Firm name must come from GST (or manual entry), never the Aadhaar name.
          shopName: f.shopName,
          shopAddress: f.shopAddress || data.data.address || "",
          aadhaarName: data.data.name || "",
          aadhaarNumber: data.data.uid || "",
          aadhaarLast4: data.data.uid ? data.data.uid.slice(-4) : "",
          aadhaarDob: data.data.dob || "",
          aadhaarGender: data.data.gender || "",
          aadhaarAddress: data.data.address || "",
          aadhaarMobile: data.data.aadhaarMobile || "",
          dob: data.data.dob || f.dob,
          state: data.data.state || f.state,
          pincode: data.data.pincode || f.pincode,
          city: data.data.city || f.city,
        }));
      } else {
        setError(data.message ?? "Aadhaar verification failed");
        setDigilockerPending(false);
        try {
          localStorage.removeItem(DIGILOCKER_STORAGE_KEY);
        } catch {}
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setVerifying(false);
  }

  // ----- PAN -----
  async function verifyPan() {
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(form.panNumber.toUpperCase())) {
      setError("Invalid PAN format. Expected: ABCDE1234F");
      return;
    }
    setVerifying(true);
    setError("");
    try {
      const res = await fetch(`/api/onboard/${token}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "PAN_360", pan: form.panNumber.toUpperCase() }),
      });
      const data = await res.json();
      if (data.ok) {
        setPanResult(data.data);
        setForm((f) => ({
          ...f,
          panNumber: f.panNumber.toUpperCase(),
          name: f.name || data.data.registered_name,
          dob: data.data.date_of_birth || f.dob,
        }));
      } else {
        setError(data.message ?? "PAN verification failed");
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setVerifying(false);
  }

  // ----- Bank -----
  async function verifyBank() {
    if (!form.bankAccountNumber || !form.bankIfsc) {
      setError("Please enter account number and IFSC");
      return;
    }
    setVerifying(true);
    setError("");
    try {
      const res = await fetch(`/api/onboard/${token}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "BANK_PENNY_DROP",
          account_number: form.bankAccountNumber,
          ifsc: form.bankIfsc.toUpperCase(),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setBankResult(data.data);
        setForm((f) => ({
          ...f,
          bankIfsc: f.bankIfsc.toUpperCase(),
          bankName: data.data.nameAtBank || "",
          bankAccountStatus: data.data.accountStatus || "active",
        }));
      } else {
        setError(data.message ?? "Bank verification failed");
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setVerifying(false);
  }

  // ----- GST -----
  async function verifyGst() {
    if (!form.gstin || form.gstin.length !== 15) {
      setError("Please enter a valid 15-character GSTIN");
      return;
    }
    setVerifying(true);
    setError("");
    try {
      const res = await fetch(`/api/onboard/${token}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "GST", gst: form.gstin.toUpperCase() }),
      });
      const data = await res.json();
      if (data.ok) {
        setGstResult(data.data);
        if (data.data.trade_name || data.data.legal_name) {
          setForm((f) => ({
            ...f,
            shopName: data.data.trade_name || data.data.legal_name || f.shopName,
          }));
        }
      } else {
        setError(data.message ?? "GST verification failed");
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setVerifying(false);
  }

  // ----- Document Upload -----
  async function uploadDocument(
    type: string,
    file: File,
    opts?: { requiresGps?: boolean; gps?: GpsCapture }
  ) {
    setUploading(type);
    setError("");
    try {
      let gpsLatitude: number | undefined;
      let gpsLongitude: number | undefined;
      let gpsAccuracy: number | undefined;
      let gpsCapturedAt: string | undefined;
      let gpsSource: string | undefined;

      if (opts?.gps) {
        // Live fix taken by GpsPhotoCapture at the moment of the shutter press.
        gpsLatitude = opts.gps.latitude;
        gpsLongitude = opts.gps.longitude;
        gpsAccuracy = opts.gps.accuracy;
        gpsCapturedAt = opts.gps.capturedAt;
        gpsSource = opts.gps.source;
      } else if (opts?.requiresGps) {
        const gps = await extractGpsFromFile(file);
        if (!gps) {
          setError(
            "This photo must have GPS location data. Please take a new photo with location enabled on your camera/phone."
          );
          setUploading(null);
          return;
        }
        gpsLatitude = gps.latitude;
        gpsLongitude = gps.longitude;
        gpsSource = "exif";
      }

      const signRes = await fetch(`/api/onboard/${token}/documents/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (!signRes.ok) throw new Error("Failed to get upload signature");
      const params = await signRes.json();

      const formData = new FormData();
      formData.append("file", file);
      formData.append("api_key", params.apiKey);
      formData.append("timestamp", String(params.timestamp));
      formData.append("signature", params.signature);
      formData.append("folder", params.folder);
      formData.append("type", params.type);

      const uploadRes = await fetch(
        `https://api.cloudinary.com/v1_1/${params.cloudName}/auto/upload`,
        { method: "POST", body: formData }
      );
      if (!uploadRes.ok) throw new Error("Upload failed");
      const cloudResult = await uploadRes.json();

      const docRes = await fetch(`/api/onboard/${token}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          publicId: cloudResult.public_id,
          url: cloudResult.secure_url,
          resourceType: cloudResult.resource_type,
          format: cloudResult.format,
          bytes: cloudResult.bytes,
          width: cloudResult.width,
          height: cloudResult.height,
          gpsLatitude,
          gpsLongitude,
          gpsAccuracy,
          gpsCapturedAt,
          gpsSource,
        }),
      });
      if (!docRes.ok) throw new Error("Failed to save document");

      setUploadedDocs((prev) => ({ ...prev, [type]: true }));
      if (type === "SELFIE") setSelfieUploaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    }
    setUploading(null);
  }

  // ----- Document Remove (to re-upload a correct file) -----
  const [removing, setRemoving] = useState<string | null>(null);

  async function removeDocument(type: string) {
    setRemoving(type);
    setError("");
    try {
      const res = await fetch(
        `/api/onboard/${token}/documents?type=${encodeURIComponent(type)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to remove document");
      setUploadedDocs((prev) => {
        const next = { ...prev };
        delete next[type];
        return next;
      });
      if (type === "SELFIE") setSelfieUploaded(false);
      if (type === "SELF_DECLARATION") setSelfDeclarationUploaded(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove document");
    }
    setRemoving(null);
  }

  // ----- Edit verified steps (redo a verification with corrected details) -----
  function editPan() {
    setPanResult(null);
    setError("");
  }

  function editBank() {
    setBankResult(null);
    setForm((f) => ({ ...f, bankName: "", bankAccountStatus: "" }));
    setError("");
  }

  function editGst() {
    setGstResult(null);
    // Keep a manually entered business name; clear only GST-sourced names.
    setForm((f) => {
      const fromGst =
        gstResult?.trade_name ??
        gstResult?.trade_name_of_business ??
        gstResult?.legal_name ??
        gstResult?.legal_name_of_business ??
        "";
      if (fromGst && f.shopName === fromGst) {
        return { ...f, shopName: "", gstin: "" };
      }
      return { ...f, gstin: "" };
    });
    setError("");
  }

  // ----- Declaration -----
  const fetchDeclarationStatus = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/onboard/${token}/declaration/status`);
      if (res.ok) {
        const data = await res.json();
        setDeclarationStatus(data);
      }
    } catch {}
  }, [token]);

  useEffect(() => {
    if (step === 9 && token) {
      fetchDeclarationStatus();
    }
  }, [step, token, fetchDeclarationStatus]);

  useEffect(() => {
    if (step !== 9) return;
    if (!declarationStatus?.requiresApproval) return;
    if (declarationStatus.approval?.status === "APPROVED") return;
    if (!declarationStatus.approval || declarationStatus.approval.status !== "PENDING") return;

    setDeclarationPolling(true);
    const interval = setInterval(async () => {
      await fetchDeclarationStatus();
    }, 10000);

    return () => {
      clearInterval(interval);
      setDeclarationPolling(false);
    };
  }, [step, declarationStatus?.requiresApproval, declarationStatus?.approval?.status, fetchDeclarationStatus]);

  // ----- Partner agreement eSign (Leegality) -----
  const fetchAgreementStatus = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/onboard/${token}/agreement`);
      if (res.ok) setAgreement(await res.json());
    } catch {}
  }, [token]);

  useEffect(() => {
    if (step === 9 && token) fetchAgreementStatus();
  }, [step, token, fetchAgreementStatus]);

  useEffect(() => {
    // Poll while an eSign is out for signature.
    if (step !== 9) return;
    if (!agreement?.sent || agreement.status === "Completed" || agreement.status === "Expired") return;
    const interval = setInterval(fetchAgreementStatus, 10000);
    return () => clearInterval(interval);
  }, [step, agreement?.sent, agreement?.status, fetchAgreementStatus]);

  async function sendAgreement() {
    if (!token) return;
    setAgreementSending(true);
    setError("");
    try {
      const res = await fetch(`/api/onboard/${token}/agreement`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setAgreement({ sent: true, configured: true, status: data.status ?? "Pending", signUrl: data.signUrl });
        if (data.signUrl) window.open(data.signUrl, "_blank", "noopener");
      } else {
        setError(data.error ?? "Failed to start the agreement eSign");
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setAgreementSending(false);
  }

  async function sendForApproval() {
    if (!token) return;
    setDeclarationSending(true);
    setError("");
    try {
      const res = await fetch(`/api/onboard/${token}/declaration/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.ok) {
        await fetchDeclarationStatus();
      } else {
        setError(data.error ?? "Failed to send for approval");
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setDeclarationSending(false);
  }

  async function uploadSelfieToS3(file: File) {
    setUploading("SELFIE");
    setError("");
    try {
      const contentType = file.type || "image/jpeg";
      const presignRes = await fetch(`/api/onboard/${token}/selfie/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType }),
      });
      if (!presignRes.ok) {
        const fallbackUpload = true;
        if (fallbackUpload) {
          await uploadDocument("SELFIE", file);
          return;
        }
      }
      const presign = await presignRes.json();

      const putRes = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
      });
      if (!putRes.ok) throw new Error("Upload to storage failed");

      const completeRes = await fetch(`/api/onboard/${token}/selfie/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: presign.key,
          uploadToken: presign.uploadToken,
          contentType,
        }),
      });
      if (!completeRes.ok) throw new Error("Failed to confirm selfie upload");

      setSelfieUploaded(true);
      setUploadedDocs((prev) => ({ ...prev, SELFIE: true }));
    } catch (err) {
      await uploadDocument("SELFIE", file);
    }
    setUploading(null);
  }

  function isValidPassword(pwd: string): boolean {
    if (pwd.length < 8 || pwd.length > 20) return false;
    // Alphanumeric with at least one special character
    return /[A-Za-z]/.test(pwd) && /\d/.test(pwd) && /[^A-Za-z0-9]/.test(pwd);
  }

  // ----- Submit -----
  async function handleSubmit() {
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (!isValidPassword(form.password)) {
      setError(
        "Password must be 8–20 characters and include letters, numbers, and a special character"
      );
      return;
    }
    if (!form.name || !form.shopName || !form.pincode) {
      setError("Please fill in all required fields");
      return;
    }
    if (!allMandatoryComplete()) {
      setError("Please complete all mandatory steps before submitting");
      return;
    }

    // If the document names don't match, the applicant must first acknowledge
    // (via the popup) that all names belong to them before we submit.
    if (nameMismatch && !nameDeclarationChecked) {
      setError("");
      setShowNameDeclaration(true);
      return;
    }

    await submitRegistration();
  }

  async function submitRegistration() {
    setShowNameDeclaration(false);
    setVerifying(true);
    setError("");
    try {
      const res = await fetch(`/api/onboard/${token}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Prefer the Aadhaar-verified name as the account's full name.
          name: form.aadhaarName || form.name,
          password: form.password,
          shopName: form.shopName,
          shopAddress: form.shopAddress,
          city: form.city,
          state: form.state,
          pincode: form.pincode,
          panNumber: form.panNumber.toUpperCase() || undefined,
          panName: panResult?.registered_name || undefined,
          aadhaarLast4: form.aadhaarLast4 || undefined,
          aadhaarNumber: form.aadhaarNumber || undefined,
          aadhaarName: form.aadhaarName || undefined,
          aadhaarDob: form.aadhaarDob || undefined,
          aadhaarGender: form.aadhaarGender || undefined,
          aadhaarAddress: form.aadhaarAddress || undefined,
          aadhaarMobile: form.aadhaarMobile || undefined,
          bankAccountNumber: form.bankAccountNumber || undefined,
          bankIfsc: form.bankIfsc.toUpperCase() || undefined,
          bankName: bankResult?.nameAtBank || form.bankName || undefined,
          bankAccountStatus: form.bankAccountStatus || undefined,
          gstin: form.gstin.toUpperCase() || undefined,
          msmeNumber: form.msmeNumber || undefined,
          nameMismatch,
          nameDeclarationAccepted: nameMismatch && nameDeclarationChecked,
          dob: form.dob || form.aadhaarDob || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setDone(true);
      } else {
        setError(
          typeof data.error === "string"
            ? data.error
            : "Registration failed. Please try again."
        );
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setVerifying(false);
  }

  function canProceed(): boolean {
    switch (step) {
      case 0:
        return true;
      case 1:
        return phoneVerified;
      case 2:
        return emailVerified;
      case 3:
        return aadhaarVerified;
      case 4:
        return !!panResult;
      case 5:
        return !!bankResult;
      case 6:
        // GST is optional, but a business / shop name is always required so the
        // self-declaration and final registration have a firm name.
        return form.shopName.trim().length >= 2;
      case 7:
        return selfieUploaded && videoCompleted;
      case 8: {
        const allRequiredDocs = REQUIRED_DOCUMENTS.filter((d) => d.required);
        return allRequiredDocs.every((d) => !!uploadedDocs[d.type]);
      }
      case 9: {
        if (!selfDeclarationUploaded) return false;
        if (declarationStatus?.requiresApproval) {
          return declarationStatus.approval?.status === "APPROVED";
        }
        return true;
      }
      case 10:
        return allMandatoryComplete();
      default:
        return true;
    }
  }

  function allMandatoryComplete(): boolean {
    if (!form.password || !form.name || !form.shopName || !form.pincode) return false;
    if (form.password !== form.confirmPassword) return false;
    if (!isValidPassword(form.password)) return false;
    if (!phoneVerified || !emailVerified || !aadhaarVerified) return false;
    if (!panResult || !bankResult) return false;
    if (!selfieUploaded || !videoCompleted) return false;
    const allRequiredDocs = REQUIRED_DOCUMENTS.filter((d) => d.required);
    if (!allRequiredDocs.every((d) => !!uploadedDocs[d.type])) return false;
    if (!selfDeclarationUploaded) return false;
    if (declarationStatus?.requiresApproval && declarationStatus.approval?.status !== "APPROVED") return false;
    return true;
  }

  async function handleNext() {
    setError("");
    // Persist business name before leaving the GST step so the self-declaration
    // PDF (next steps) can include it when GST was skipped or returned no name.
    const gstTrade =
      gstResult?.trade_name ??
      gstResult?.trade_name_of_business ??
      gstResult?.legal_name ??
      gstResult?.legal_name_of_business ??
      "";
    if (step === 6 && form.shopName.trim().length >= 2 && !gstTrade) {
      setVerifying(true);
      try {
        const res = await fetch(`/api/onboard/${token}/business`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shopName: form.shopName.trim() }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "Could not save business name");
          setVerifying(false);
          return;
        }
      } catch {
        setError("Network error. Please try again.");
        setVerifying(false);
        return;
      }
      setVerifying(false);
    }
    setOtpSent(false);
    setOtpCode("");
    setStep(step + 1);
  }

  function handleBack() {
    setError("");
    setOtpSent(false);
    setOtpCode("");
    setStep(Math.max(0, step - 1));
  }

  // ----- Renders -----
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-brand-50">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      </div>
    );
  }

  if (error && !invite) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-rose-50 p-4">
        <div className="max-w-md rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-lg">
          <AlertCircle className="mx-auto h-12 w-12 text-rose-500" />
          <h2 className="mt-4 text-xl font-bold text-ink-900">Invalid Link</h2>
          <p className="mt-2 text-ink-600">{error}</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-emerald-50 p-4">
        <div className="max-w-md rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-lg">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-500 text-white">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h2 className="mt-4 text-xl font-bold text-ink-900">
            Registration Complete!
          </h2>
          <p className="mt-2 text-ink-600">
            {nameMismatch
              ? "Your details have been submitted. Since some document names didn't match, your application will be reviewed by our team."
              : "Your details have been submitted for admin approval."}
          </p>
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
            <p className="text-lg font-bold text-amber-800">
              Approval within 48–72 working hours
            </p>
            <p className="mt-1 text-sm text-amber-700">
              You&apos;ll receive a notification once your account is approved.
            </p>
          </div>
          <p className="mt-4 text-sm text-ink-500">
            A confirmation email has been sent to <strong>{invite?.email}</strong> with
            your login details.
          </p>
          <Button className="mt-6" onClick={() => router.push("/login")}>
            Go to Login <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  const StepIcon = STEPS[step].icon;

  // Shop/Firm name from verified GST, or a required manual business name
  // collected on the GST step when GST is skipped. Either way the final
  // Details step should not ask the user to type it again.
  const gstShopName = gstResult
    ? gstResult.trade_name ??
      gstResult.trade_name_of_business ??
      gstResult.legal_name ??
      gstResult.legal_name_of_business ??
      ""
    : "";
  const shopNameLocked = form.shopName.trim().length >= 2;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-brand-50 px-3 py-6 sm:px-4 sm:py-8">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <div className="mb-4 text-center sm:mb-6">
          <h1 className="font-display text-xl font-bold text-ink-900 sm:text-2xl">
            NextGenPay Registration
          </h1>
          <p className="mt-1 text-sm text-ink-600 sm:text-base">
            Complete your onboarding as{" "}
            <strong>{invite?.role.replace(/_/g, " ")}</strong>
          </p>
        </div>

        {/* Stepper */}
        <div className="mb-4 sm:mb-6">
          <div className="flex items-center justify-center gap-0.5 overflow-x-auto px-1 sm:gap-1 sm:px-2">
            {STEPS.map((s, i) => (
              <div key={s.label} className="flex items-center gap-0.5 sm:gap-1">
                <span
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold transition-colors sm:h-6 sm:w-6 sm:text-xs ${
                    i < step
                      ? "bg-emerald-500 text-white"
                      : i === step
                      ? "bg-brand-600 text-white"
                      : "bg-ink-100 text-ink-500"
                  }`}
                >
                  {i < step ? "\u2713" : i + 1}
                </span>
                {i < STEPS.length - 1 && (
                  <span className="mx-0.5 h-px w-2 bg-ink-200 sm:w-3" />
                )}
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700 sm:mb-4 sm:px-4 sm:py-3">
            <AlertCircle className="mr-2 inline h-4 w-4" />
            {error}
          </div>
        )}

        {/* Form Card */}
        <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-soft sm:p-6">
          {/* Step 0: Welcome */}
          {step === 0 && (
            <div className="space-y-4 text-center">
              {/* Warn immediately if opened in a WebView — the selfie/video
                  steps later would fail there. */}
              <div className="text-left">
                <InAppBrowserWarning />
              </div>
              <ShieldCheck className="mx-auto h-12 w-12 text-brand-600" />
              <h2 className="text-lg font-bold text-ink-900">Welcome!</h2>
              <p className="text-ink-600">
                You&apos;ve been invited to register as a{" "}
                <strong>{invite?.role.replace(/_/g, " ")}</strong> on NextGenPay.
              </p>
              <div className="rounded-xl bg-ink-50 p-4 text-left text-sm">
                <p>
                  <strong>Email:</strong> {invite?.email}
                </p>
                <p>
                  <strong>Phone:</strong> {invite?.phone}
                </p>
                <p>
                  <strong>Expires:</strong>{" "}
                  {invite?.expiresAt
                    ? new Date(invite.expiresAt).toLocaleDateString()
                    : "\u2014"}
                </p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-800">
                <p className="mb-2 font-semibold">
                  Please keep the following ready to complete registration:
                </p>
                <ul className="list-inside list-disc space-y-1">
                  <li>Access to your registered mobile &amp; email for OTP</li>
                  <li>Aadhaar card (for DigiLocker verification)</li>
                  <li>PAN card number</li>
                  <li>Bank account details (Account Number + IFSC)</li>
                  <li>GSTIN (optional) or Business Name (required if no GST)</li>
                  <li>Live selfie photo &amp; 10-second video</li>
                  <li>GST Certificate, Shop &amp; Establishment, Gumasta License</li>
                  <li>Signature, Electricity Bill, Cancelled Cheque copy</li>
                  <li>Additional ID proof (DL / Voter ID / Passport)</li>
                  <li>Family member reference document</li>
                  <li>PG Form &amp; Distributor Declaration Form</li>
                  <li>GPS-tagged photos of house/office (inside &amp; outside)</li>
                  <li>GPS-tagged selfie with your salesperson/distributor</li>
                </ul>
              </div>
            </div>
          )}

          {/* Step 1: Mobile OTP */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-brand-700">
                <Phone className="h-5 w-5" />
                <h2 className="font-bold">Mobile Number Verification</h2>
              </div>
              <p className="text-sm text-ink-600">
                We&apos;ll send an OTP to your registered mobile number to verify
                ownership.
              </p>
              {phoneVerified ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
                  <p className="mt-2 font-semibold text-emerald-800">
                    Mobile Number Verified
                  </p>
                  <p className="text-sm text-emerald-700">{invite?.phone}</p>
                </div>
              ) : (
                <>
                  <div className="rounded-xl bg-ink-50 p-4">
                    <p className="text-sm text-ink-600">Mobile Number</p>
                    <p className="text-lg font-bold text-ink-900">
                      {invite?.phone}
                    </p>
                  </div>
                  {!otpSent ? (
                    <Button
                      onClick={() => sendOtp("SMS")}
                      disabled={verifying}
                      className="w-full"
                    >
                      {verifying ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Phone className="h-4 w-4" />
                      )}
                      Send OTP
                    </Button>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <Label>Enter 6-digit OTP</Label>
                        <Input
                          value={otpCode}
                          onChange={(e) => handleOtpChange(e.target.value, "SMS")}
                          placeholder="000000"
                          maxLength={6}
                          autoFocus
                          className="text-center text-lg tracking-widest"
                        />
                      </div>
                      {verifying && (
                        <div className="flex items-center justify-center gap-2 text-sm text-brand-600">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Verifying...
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => sendOtp("SMS")}
                        disabled={otpResendTimer > 0 || verifying}
                        className="w-full text-center text-sm text-brand-600 hover:underline disabled:text-ink-400"
                      >
                        {otpResendTimer > 0
                          ? `Resend OTP in ${otpResendTimer}s`
                          : "Resend OTP"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Step 2: Email OTP */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-brand-700">
                <Mail className="h-5 w-5" />
                <h2 className="font-bold">Email Verification</h2>
              </div>
              <p className="text-sm text-ink-600">
                We&apos;ll send an OTP to your registered email to verify ownership.
              </p>
              {emailVerified ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
                  <p className="mt-2 font-semibold text-emerald-800">
                    Email Verified
                  </p>
                  <p className="text-sm text-emerald-700">{invite?.email}</p>
                </div>
              ) : (
                <>
                  <div className="rounded-xl bg-ink-50 p-4">
                    <p className="text-sm text-ink-600">Email Address</p>
                    <p className="text-lg font-bold text-ink-900">
                      {invite?.email}
                    </p>
                  </div>
                  {!otpSent ? (
                    <Button
                      onClick={() => sendOtp("EMAIL")}
                      disabled={verifying}
                      className="w-full"
                    >
                      {verifying ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Mail className="h-4 w-4" />
                      )}
                      Send OTP
                    </Button>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <Label>Enter 6-digit OTP</Label>
                        <Input
                          value={otpCode}
                          onChange={(e) => handleOtpChange(e.target.value, "EMAIL")}
                          placeholder="000000"
                          maxLength={6}
                          autoFocus
                          className="text-center text-lg tracking-widest"
                        />
                      </div>
                      {verifying && (
                        <div className="flex items-center justify-center gap-2 text-sm text-brand-600">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Verifying...
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => sendOtp("EMAIL")}
                        disabled={otpResendTimer > 0 || verifying}
                        className="w-full text-center text-sm text-brand-600 hover:underline disabled:text-ink-400"
                      >
                        {otpResendTimer > 0
                          ? `Resend OTP in ${otpResendTimer}s`
                          : "Resend OTP"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Step 3: Aadhaar DigiLocker */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-brand-700">
                <Fingerprint className="h-5 w-5" />
                <h2 className="font-bold">Aadhaar Verification</h2>
              </div>
              <p className="text-sm text-ink-600">
                Verify your Aadhaar through DigiLocker. You&apos;ll be redirected to
                the DigiLocker portal to authorize access to your Aadhaar details.
              </p>
              {aadhaarVerified && aadhaarResult ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    <p className="font-semibold text-emerald-800">
                      Aadhaar Verified via DigiLocker
                    </p>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <span className="text-emerald-700">Name:</span>{" "}
                      {aadhaarResult.name}
                    </div>
                    {aadhaarResult.uid && (
                      <div>
                        <span className="text-emerald-700">Aadhaar:</span>{" "}
                        XXXX-XXXX-{aadhaarResult.uid.slice(-4)}
                      </div>
                    )}
                    {aadhaarResult.dob && (
                      <div>
                        <span className="text-emerald-700">DOB:</span>{" "}
                        {aadhaarResult.dob}
                      </div>
                    )}
                    {aadhaarResult.gender && (
                      <div>
                        <span className="text-emerald-700">Gender:</span>{" "}
                        {aadhaarResult.gender}
                      </div>
                    )}
                    {aadhaarResult.address && (
                      <div className="col-span-2">
                        <span className="text-emerald-700">Address:</span>{" "}
                        {aadhaarResult.address}
                      </div>
                    )}
                    {form.aadhaarMobile && (
                      <div>
                        <span className="text-emerald-700">
                          Aadhaar Mobile:
                        </span>{" "}
                        {form.aadhaarMobile}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={initAadhaar}
                    disabled={verifying}
                    className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline disabled:opacity-50"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Wrong Aadhaar? Re-verify with DigiLocker
                  </button>
                </div>
              ) : digilockerPending ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-amber-600" />
                    <p className="mt-2 text-sm font-medium text-amber-800">
                      Fetching your Aadhaar details...
                    </p>
                    <p className="text-xs text-amber-700">
                      This happens automatically. If it doesn&apos;t complete, tap below.
                    </p>
                  </div>
                  <Button
                    onClick={() => completeAadhaar()}
                    disabled={verifying}
                    className="w-full"
                  >
                    {verifying ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Fetch Aadhaar Details
                  </Button>
                  <button
                    type="button"
                    onClick={initAadhaar}
                    disabled={verifying}
                    className="w-full text-center text-sm text-brand-600 hover:underline"
                  >
                    Restart DigiLocker Verification
                  </button>
                </div>
              ) : (
                <Button
                  onClick={initAadhaar}
                  disabled={verifying}
                  className="w-full"
                >
                  {verifying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Fingerprint className="h-4 w-4" />
                  )}
                  Verify with DigiLocker
                </Button>
              )}
            </div>
          )}

          {/* Step 4: PAN Verification */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-brand-700">
                <CreditCard className="h-5 w-5" />
                <h2 className="font-bold">PAN Verification</h2>
              </div>
              <p className="text-sm text-ink-600">
                Enter your PAN number. We&apos;ll verify it and cross-check with
                your Aadhaar details.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Label>PAN Number *</Label>
                  <Input
                    value={form.panNumber}
                    onChange={(e) =>
                      updateForm("panNumber", e.target.value.toUpperCase())
                    }
                    placeholder="ABCDE1234F"
                    maxLength={10}
                    className="uppercase"
                    disabled={!!panResult}
                  />
                </div>
                {!panResult && (
                  <Button
                    type="button"
                    onClick={verifyPan}
                    disabled={verifying || form.panNumber.length !== 10}
                    className="w-full sm:w-auto"
                  >
                    {verifying ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-4 w-4" />
                    )}
                    Verify
                  </Button>
                )}
              </div>
              {panResult && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-emerald-800">
                        PAN Verified
                      </p>
                      <button
                        type="button"
                        onClick={editPan}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
                      <p>
                        <span className="text-emerald-700">Name:</span>{" "}
                        {panResult.registered_name}
                      </p>
                      <p>
                        <span className="text-emerald-700">Type:</span>{" "}
                        {panResult.type}
                      </p>
                      {panResult.date_of_birth && (
                        <p>
                          <span className="text-emerald-700">DOB:</span>{" "}
                          {panResult.date_of_birth}
                        </p>
                      )}
                      <p>
                        <span className="text-emerald-700">Aadhaar Linked:</span>{" "}
                        {panResult.aadhaar_linked ? "Yes" : "No"}
                      </p>
                    </div>
                  </div>
                  {/* Name match indicator */}
                  {aadhaarResult?.name && (
                    <NameMatchBadge
                      label="Aadhaar"
                      name1={aadhaarResult.name}
                      name2={panResult.registered_name}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 5: Bank Verification */}
          {step === 5 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-brand-700">
                <Building2 className="h-5 w-5" />
                <h2 className="font-bold">Bank Account Verification</h2>
              </div>
              <p className="text-sm text-ink-600">
                We&apos;ll verify your bank account via Penny Drop (₹1
                deposit) and confirm the account holder name.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Account Number *</Label>
                  <Input
                    value={form.bankAccountNumber}
                    onChange={(e) =>
                      updateForm("bankAccountNumber", e.target.value)
                    }
                    placeholder="Enter account number"
                    disabled={!!bankResult}
                  />
                </div>
                <div>
                  <Label>IFSC Code *</Label>
                  <Input
                    value={form.bankIfsc}
                    onChange={(e) =>
                      updateForm("bankIfsc", e.target.value.toUpperCase())
                    }
                    placeholder="SBIN0001234"
                    maxLength={11}
                    className="uppercase"
                    disabled={!!bankResult}
                  />
                </div>
              </div>
              {!bankResult && (
                <Button
                  type="button"
                  onClick={verifyBank}
                  disabled={
                    verifying || !form.bankAccountNumber || !form.bankIfsc
                  }
                >
                  {verifying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  Verify Bank Account
                </Button>
              )}
              {bankResult && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-emerald-800">
                        Bank Account Verified
                      </p>
                      <button
                        type="button"
                        onClick={editBank}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                      <p>
                        <span className="text-emerald-700">Name at Bank:</span>{" "}
                        {bankResult.nameAtBank}
                      </p>
                      <p>
                        <span className="text-emerald-700">Account Status:</span>{" "}
                        <span
                          className={
                            bankResult.accountStatus === "active"
                              ? "font-semibold text-emerald-700"
                              : "font-semibold text-rose-600"
                          }
                        >
                          {bankResult.accountStatus?.toUpperCase() ?? "ACTIVE"}
                        </span>
                      </p>
                      {bankResult.utr && (
                        <p>
                          <span className="text-emerald-700">UTR:</span>{" "}
                          {bankResult.utr}
                        </p>
                      )}
                      <p>
                        <span className="text-emerald-700">Penny Drop:</span>{" "}
                        ₹{bankResult.depositAmount ?? 1} deposited
                      </p>
                    </div>
                  </div>
                  {/* Name match with Aadhaar/PAN */}
                  {(aadhaarResult?.name || panResult?.registered_name) && (
                    <NameMatchBadge
                      label="Aadhaar/PAN"
                      name1={aadhaarResult?.name ?? panResult?.registered_name}
                      name2={bankResult.nameAtBank}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 6: GST + MSME (Optional) — business name required if no GST */}
          {step === 6 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-brand-700">
                <Building2 className="h-5 w-5" />
                <h2 className="font-bold">GST &amp; MSME (Optional)</h2>
              </div>
              <p className="text-sm text-ink-600">
                If you have a GSTIN or Udyam (MSME) number, enter them here.
                You can skip GST verification, but a business name is required.
              </p>

              {/* GST */}
              <div className="space-y-2">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <Label>GSTIN</Label>
                    <Input
                      value={form.gstin}
                      onChange={(e) =>
                        updateForm("gstin", e.target.value.toUpperCase())
                      }
                      placeholder="22AAAAA0000A1Z5"
                      maxLength={15}
                      className="uppercase"
                      disabled={!!gstResult}
                    />
                  </div>
                  {!gstResult && (
                    <Button
                      type="button"
                      onClick={verifyGst}
                      disabled={verifying || form.gstin.length !== 15}
                      className="w-full sm:w-auto"
                    >
                      {verifying ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-4 w-4" />
                      )}
                      Verify
                    </Button>
                  )}
                </div>
                {gstResult && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-emerald-800">
                        GST Verified
                      </p>
                      <button
                        type="button"
                        onClick={editGst}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
                      <p>
                        <span className="text-emerald-700">Legal Name:</span>{" "}
                        {gstResult.legal_name}
                      </p>
                      <p>
                        <span className="text-emerald-700">Trade Name:</span>{" "}
                        {gstResult.trade_name}
                      </p>
                      <p>
                        <span className="text-emerald-700">Status:</span>{" "}
                        {gstResult.gst_status}
                      </p>
                      <p>
                        <span className="text-emerald-700">Type:</span>{" "}
                        {gstResult.taxpayer_type}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Business name — required when GST is not verified (or returned no trade name) */}
              {(!gstResult || !gstShopName) && (
                <div>
                  <Label>Business Name *</Label>
                  <Input
                    required
                    value={form.shopName}
                    onChange={(e) => updateForm("shopName", e.target.value)}
                    placeholder="Enter your business / shop / firm name"
                    maxLength={120}
                  />
                  <p className="mt-1 text-xs text-ink-500">
                    Required when GST is not verified. This name is used on your
                    self-declaration form and saved to your profile.
                  </p>
                </div>
              )}

              {gstResult && gstShopName && (
                <div>
                  <Label>Business Name</Label>
                  <Input
                    value={gstShopName}
                    readOnly
                    disabled
                    className="bg-ink-50"
                  />
                  <p className="mt-1 text-xs text-ink-500">
                    Auto-filled from GST registration — will appear on your
                    self-declaration form.
                  </p>
                </div>
              )}

              {/* MSME */}
              <div>
                <Label>Udyam / MSME Number (Optional)</Label>
                <Input
                  value={form.msmeNumber}
                  onChange={(e) =>
                    updateForm("msmeNumber", e.target.value.toUpperCase())
                  }
                  placeholder="UDYAM-XX-00-0000000"
                  className="uppercase"
                />
                <p className="mt-1 text-xs text-ink-500">
                  Enter your Udyam registration number if applicable. This will be
                  stored for records.
                </p>
              </div>
            </div>
          )}

          {/* Step 7: Selfie & 10-Second Video */}
          {step === 7 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-brand-700">
                <Upload className="h-5 w-5" />
                <h2 className="font-bold">Retailer Live Photo &amp; Video</h2>
              </div>
              <p className="text-sm text-ink-600">
                Take a live selfie photo and record a 10-second video for identity verification.
                Both are mandatory.
              </p>

              {/* WebViews (WhatsApp/Instagram/…) auto-deny the camera — warn early. */}
              <InAppBrowserWarning />

              {/* Selfie Upload — live front camera */}
              <SelfieCapture
                uploaded={selfieUploaded}
                uploading={uploading === "SELFIE"}
                removing={removing === "SELFIE"}
                onCapture={(file) => uploadSelfieToS3(file)}
                onRemove={() => removeDocument("SELFIE")}
              />

              {/* 10-second Liveness Video */}
              <div className={`rounded-xl border p-4 ${videoCompleted ? "border-emerald-200 bg-emerald-50" : "border-ink-200 bg-white"}`}>
                <div className="flex items-center gap-2 mb-3">
                  {videoCompleted ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  ) : (
                    <FileText className="h-5 w-5 text-ink-400" />
                  )}
                  <p className="text-sm font-medium text-ink-900">
                    10-Second Liveness Video <span className="text-rose-500">*</span>
                  </p>
                </div>
                {videoCompleted ? (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-emerald-700">Video captured successfully</p>
                    <button
                      type="button"
                      onClick={() => setVideoCompleted(false)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                    >
                      <Pencil className="h-3 w-3" /> Record again
                    </button>
                  </div>
                ) : (
                  <LivenessVideoCapture onComplete={() => setVideoCompleted(true)} apiPrefix={`/api/onboard/${token}`} />
                )}
              </div>

            </div>
          )}

          {/* Step 8: All Required Documents */}
          {step === 8 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-brand-700">
                <FileText className="h-5 w-5" />
                <h2 className="font-bold">Documents Collection</h2>
              </div>
              <p className="text-sm text-ink-600">
                Upload all the required documents listed below. GPS-tagged photos
                are taken live with your camera and your location is captured
                automatically at that moment.
              </p>

              {nameMismatch && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <AlertTriangle className="mr-1 inline h-4 w-4" />
                  Name mismatch detected — please ensure documents clearly show your legal name.
                </div>
              )}

              <div className="space-y-3">
                {REQUIRED_DOCUMENTS.map((doc) => {
                  if (doc.requiresGps) {
                    return (
                      <GpsPhotoCapture
                        key={doc.type}
                        label={doc.label}
                        description={doc.description}
                        required={doc.required}
                        uploaded={!!uploadedDocs[doc.type]}
                        uploading={uploading === doc.type}
                        removing={removing === doc.type}
                        facing={doc.type === "GPS_SELFIE_DISTRIBUTOR" ? "user" : "environment"}
                        onCapture={(file, gps) => uploadDocument(doc.type, file, { gps })}
                        onRemove={() => removeDocument(doc.type)}
                      />
                    );
                  }
                  if (doc.type === "PG_FORM") {
                    const pgUploaded = !!uploadedDocs.PG_FORM;
                    return (
                      <div
                        key={doc.type}
                        className={`rounded-xl border p-4 ${
                          pgUploaded ? "border-emerald-200 bg-emerald-50" : "border-ink-200 bg-white"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-3">
                          {pgUploaded ? (
                            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                          ) : (
                            <FileText className="h-5 w-5 text-ink-400" />
                          )}
                          <p className="text-sm font-medium text-ink-900">
                            {doc.label} <span className="text-rose-500">*</span>
                          </p>
                        </div>

                        {!pgUploaded && (
                          <div className="space-y-3">
                            <a
                              href={`/api/onboard/${token}/pg-form/download`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm font-medium text-brand-700 hover:bg-brand-100 transition-colors"
                            >
                              <ArrowDown className="h-4 w-4" /> Download Prefilled PG Form
                            </a>
                            <p className="text-xs text-ink-500">
                              Download, print, sign, and upload the signed PG onboarding form.
                            </p>
                            <DocumentUploadField
                              label="Upload Signed PG Form"
                              type="PG_FORM"
                              uploaded={pgUploaded}
                              uploading={uploading === "PG_FORM"}
                              removing={removing === "PG_FORM"}
                              required
                              accept={doc.accept}
                              onUpload={(file) => uploadDocument("PG_FORM", file)}
                              onRemove={() => removeDocument("PG_FORM")}
                            />
                          </div>
                        )}

                        {pgUploaded && (
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-emerald-700">
                              Signed PG form uploaded successfully
                            </p>
                            <button
                              type="button"
                              onClick={() => removeDocument("PG_FORM")}
                              disabled={removing === "PG_FORM"}
                              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                            >
                              {removing === "PG_FORM" ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Trash2 className="h-3 w-3" />
                              )}
                              Remove & re-upload
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  }
                  return (
                    <DocumentUploadField
                      key={doc.type}
                      label={doc.label}
                      type={doc.type}
                      uploaded={!!uploadedDocs[doc.type]}
                      uploading={uploading === doc.type}
                      removing={removing === doc.type}
                      required={doc.required}
                      accept={doc.accept}
                      description={doc.description}
                      requiresGps={doc.requiresGps}
                      downloadUrl={doc.downloadUrl}
                      onUpload={(file) =>
                        uploadDocument(doc.type, file, { requiresGps: doc.requiresGps })
                      }
                      onRemove={() => removeDocument(doc.type)}
                    />
                  );
                })}
              </div>

              <div className="mt-2 rounded-xl bg-ink-50 p-3 text-xs text-ink-500">
                <strong>Note:</strong> GPS-tagged photos must be taken live with your
                camera. Your browser will ask for camera and location access — your
                location is recorded at the moment each photo is taken.
              </div>

            </div>
          )}

          {/* Step 9: Declaration */}
          {step === 9 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-brand-700">
                <FileSignature className="h-5 w-5" />
                <h2 className="font-bold">Declaration & Undertaking</h2>
              </div>
              <p className="text-sm text-ink-600">
                Download your prefilled <strong>self-declaration</strong>, sign it, and upload the signed copy.
                {declarationStatus?.requiresApproval && (
                  <> Additionally, your <strong>{declarationStatus.approverName}</strong> ({invite?.role === "MASTER_DISTRIBUTOR" ? "Super Distributor" : invite?.role === "DISTRIBUTOR" ? "Master Distributor" : "Distributor"}) must review the responsibility declaration and approve your onboarding with their signature &amp; selfie.</>
                )}
              </p>

              {/* Self Declaration Download & Upload */}
              <div className={`rounded-xl border p-4 ${selfDeclarationUploaded ? "border-emerald-200 bg-emerald-50" : "border-ink-200 bg-white"}`}>
                <div className="flex items-center gap-2 mb-3">
                  {selfDeclarationUploaded ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  ) : (
                    <FileText className="h-5 w-5 text-ink-400" />
                  )}
                  <p className="text-sm font-medium text-ink-900">
                    Self Declaration Form <span className="text-rose-500">*</span>
                  </p>
                </div>

                {!selfDeclarationUploaded && (
                  <div className="space-y-3">
                    <a
                      href={`/api/onboard/${token}/declaration/download`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm font-medium text-brand-700 hover:bg-brand-100 transition-colors"
                    >
                      <ArrowDown className="h-4 w-4" /> Download Prefilled Self-Declaration
                    </a>
                    <p className="text-xs text-ink-500">
                      Download, print, sign, and upload the signed self-declaration form.
                    </p>
                    <DocumentUploadField
                      label="Upload Signed Declaration"
                      type="SELF_DECLARATION"
                      uploaded={selfDeclarationUploaded}
                      uploading={uploading === "SELF_DECLARATION"}
                      required
                      accept="image/*,.pdf"
                      onUpload={(file) => {
                        uploadDocument("SELF_DECLARATION", file).then(() => {
                          setSelfDeclarationUploaded(true);
                        });
                      }}
                    />
                  </div>
                )}

                {selfDeclarationUploaded && (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-emerald-700">Self declaration uploaded successfully</p>
                    {/* Replacing a declaration that is under (or past) successor
                        review would invalidate the approval — block it then. */}
                    {(!declarationStatus?.approval ||
                      declarationStatus.approval.status === "REJECTED") && (
                      <button
                        type="button"
                        onClick={() => removeDocument("SELF_DECLARATION")}
                        disabled={removing === "SELF_DECLARATION"}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                      >
                        {removing === "SELF_DECLARATION" ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                        Remove & re-upload
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Successor Approval Section */}
              {declarationStatus?.requiresApproval && (
                <div className={`rounded-xl border p-4 ${
                  declarationStatus.approval?.status === "APPROVED"
                    ? "border-emerald-200 bg-emerald-50"
                    : declarationStatus.approval?.status === "REJECTED"
                    ? "border-rose-200 bg-rose-50"
                    : declarationStatus.approval?.status === "PENDING"
                    ? "border-amber-200 bg-amber-50"
                    : "border-ink-200 bg-white"
                }`}>
                  <div className="flex items-center gap-2 mb-3">
                    {declarationStatus.approval?.status === "APPROVED" ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    ) : declarationStatus.approval?.status === "REJECTED" ? (
                      <XCircle className="h-5 w-5 text-rose-600" />
                    ) : declarationStatus.approval?.status === "PENDING" ? (
                      <Clock className="h-5 w-5 text-amber-600" />
                    ) : (
                      <Send className="h-5 w-5 text-ink-400" />
                    )}
                    <p className="text-sm font-medium text-ink-900">
                      {declarationStatus.approverName ?? "Successor"} Approval <span className="text-rose-500">*</span>
                    </p>
                  </div>

                  {!declarationStatus.approval && (
                    <div className="space-y-3">
                      <p className="text-xs text-ink-600">
                        Send a declaration request to <strong>{declarationStatus.approverName}</strong>. They will review the declaration, provide their signature &amp; selfie, and approve your onboarding.
                      </p>
                      <button
                        type="button"
                        onClick={sendForApproval}
                        disabled={declarationSending || !selfDeclarationUploaded}
                        className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
                      >
                        {declarationSending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                        Send for Approval
                      </button>
                    </div>
                  )}

                  {declarationStatus.approval?.status === "PENDING" && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-amber-600" />
                        <p className="text-sm text-amber-800 font-medium">Waiting for approval...</p>
                      </div>
                      <p className="text-xs text-amber-700">
                        Sent on {new Date(declarationStatus.approval.sentAt).toLocaleString()}.
                        {declarationStatus.approverName} will review and approve from their portal.
                      </p>
                      {declarationPolling && (
                        <p className="text-xs text-amber-600">Checking for updates automatically...</p>
                      )}
                    </div>
                  )}

                  {declarationStatus.approval?.status === "APPROVED" && (
                    <div className="space-y-1">
                      <p className="text-sm text-emerald-800 font-medium">
                        Approved by {declarationStatus.approverName}
                      </p>
                      <p className="text-xs text-emerald-700">
                        Approved on {declarationStatus.approval.approvedAt ? new Date(declarationStatus.approval.approvedAt).toLocaleString() : ""}
                      </p>
                    </div>
                  )}

                  {declarationStatus.approval?.status === "REJECTED" && (
                    <div className="space-y-2">
                      <p className="text-sm text-rose-800 font-medium">
                        Rejected by {declarationStatus.approverName}
                      </p>
                      <p className="text-xs text-rose-700">
                        Reason: {declarationStatus.approval.rejectedReason}
                      </p>
                      <button
                        type="button"
                        onClick={sendForApproval}
                        disabled={declarationSending}
                        className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
                      >
                        {declarationSending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                        Re-send for Approval
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Partner Agreement eSign (Leegality) — shown when the rail is live */}
              {agreement && (agreement.configured || agreement.sent) && (
                <div className={`rounded-xl border p-4 ${
                  agreement.status === "Completed"
                    ? "border-emerald-200 bg-emerald-50"
                    : agreement.sent
                    ? "border-amber-200 bg-amber-50"
                    : "border-ink-200 bg-white"
                }`}>
                  <div className="flex items-center gap-2 mb-3">
                    {agreement.status === "Completed" ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    ) : agreement.sent ? (
                      <Clock className="h-5 w-5 text-amber-600" />
                    ) : (
                      <FileSignature className="h-5 w-5 text-ink-400" />
                    )}
                    <p className="text-sm font-medium text-ink-900">Partner Agreement (Aadhaar eSign)</p>
                  </div>

                  {!agreement.sent && (
                    <div className="space-y-3">
                      <p className="text-xs text-ink-600">
                        Digitally sign your partner agreement using Aadhaar eSign — no printing or
                        courier needed. A signing link will open in a new tab (also sent to your
                        email and phone).
                      </p>
                      <button
                        type="button"
                        onClick={sendAgreement}
                        disabled={agreementSending}
                        className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
                      >
                        {agreementSending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <FileSignature className="h-4 w-4" />
                        )}
                        Sign Agreement Digitally
                      </button>
                    </div>
                  )}

                  {agreement.sent && agreement.status !== "Completed" && agreement.status !== "Expired" && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-amber-600" />
                        <p className="text-sm text-amber-800 font-medium">Waiting for your signature...</p>
                      </div>
                      {agreement.signUrl && (
                        <a
                          href={agreement.signUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 transition-colors"
                        >
                          Open signing page
                        </a>
                      )}
                      <p className="text-xs text-amber-700">
                        Complete the Aadhaar OTP eSign on the signing page. This card updates automatically.
                      </p>
                    </div>
                  )}

                  {agreement.status === "Completed" && (
                    <p className="text-sm text-emerald-800 font-medium">
                      Agreement signed successfully
                    </p>
                  )}

                  {agreement.status === "Expired" && (
                    <div className="space-y-2">
                      <p className="text-sm text-rose-800 font-medium">The signing link expired.</p>
                      <button
                        type="button"
                        onClick={sendAgreement}
                        disabled={agreementSending}
                        className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
                      >
                        {agreementSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        Request a new signing link
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 10: Personal Details + Set Password */}
          {step === 10 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-brand-700">
                <User className="h-5 w-5" />
                <h2 className="font-bold">Business Details &amp; Password</h2>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Full Name (as per Aadhaar) *</Label>
                  <Input
                    value={form.aadhaarName || form.name}
                    readOnly
                    disabled
                    className="bg-ink-50"
                  />
                  {aadhaarVerified && (
                    <p className="mt-1 text-xs text-ink-500">Fetched from Aadhaar verification</p>
                  )}
                </div>
                <div>
                  <Label>Shop / Firm Name *</Label>
                  <Input
                    required
                    value={form.shopName}
                    onChange={(e) => updateForm("shopName", e.target.value)}
                    placeholder="Enter your business name"
                    readOnly={shopNameLocked}
                    disabled={shopNameLocked}
                    className={shopNameLocked ? "bg-ink-50" : ""}
                  />
                  {shopNameLocked ? (
                    <p className="mt-1 text-xs text-ink-500">
                      {gstShopName
                        ? "Auto-filled from GST registration"
                        : "Auto-filled from business name entered earlier"}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-ink-500">
                      Enter your shop / firm name to continue
                    </p>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <Label>Shop Address</Label>
                  <Input
                    value={form.shopAddress}
                    readOnly
                    disabled
                    className="bg-ink-50"
                  />
                </div>
                <div>
                  <Label>City</Label>
                  <Input
                    value={form.city}
                    readOnly
                    disabled
                    className="bg-ink-50"
                  />
                </div>
                <div>
                  <Label>Pin Code *</Label>
                  <Input
                    value={form.pincode}
                    readOnly
                    disabled
                    className="bg-ink-50"
                  />
                </div>
                <div>
                  <Label>State *</Label>
                  <Input
                    value={form.state}
                    readOnly
                    disabled
                    className="bg-ink-50"
                  />
                </div>
                <div>
                  <Label>Date of Birth</Label>
                  <Input
                    value={form.dob || form.aadhaarDob || ""}
                    readOnly
                    disabled
                    className="bg-ink-50"
                  />
                </div>
              </div>

              <hr className="border-ink-100" />

              <div className="flex items-center gap-2 text-brand-700">
                <Lock className="h-5 w-5" />
                <h2 className="font-bold">Set Your Password</h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Password *</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={form.password}
                      onChange={(e) =>
                        updateForm("password", e.target.value.slice(0, 20))
                      }
                      placeholder="8–20 characters"
                      minLength={8}
                      maxLength={20}
                      autoComplete="new-password"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <Label>Confirm Password *</Label>
                  <div className="relative">
                    <Input
                      type={showConfirmPassword ? "text" : "password"}
                      value={form.confirmPassword}
                      onChange={(e) =>
                        updateForm(
                          "confirmPassword",
                          e.target.value.slice(0, 20)
                        )
                      }
                      placeholder="Re-enter password"
                      minLength={8}
                      maxLength={20}
                      autoComplete="new-password"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-xs text-ink-500">
                Password must be alphanumeric with special characters, minimum 8
                and maximum 20 characters.
              </p>

              {/* Summary */}
              <div className="mt-4 rounded-xl border border-ink-100 bg-ink-50 p-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-500">
                  Registration Summary
                </p>
                <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                  <p>
                    <span className="text-ink-500">Phone:</span>{" "}
                    {phoneVerified ? "\u2713 Verified" : "\u2717 Not verified"}
                  </p>
                  <p>
                    <span className="text-ink-500">Email:</span>{" "}
                    {emailVerified ? "\u2713 Verified" : "\u2717 Not verified"}
                  </p>
                  <p>
                    <span className="text-ink-500">Aadhaar:</span>{" "}
                    {aadhaarVerified
                      ? `\u2713 ${form.aadhaarName || "Verified"}`
                      : "\u2717 Not verified"}
                  </p>
                  <p>
                    <span className="text-ink-500">PAN:</span>{" "}
                    {panResult
                      ? `\u2713 ${form.panNumber}`
                      : form.panNumber || "\u2014"}
                  </p>
                  <p>
                    <span className="text-ink-500">Bank:</span>{" "}
                    {bankResult ? "\u2713 Verified" : "\u2014"}
                  </p>
                  <p>
                    <span className="text-ink-500">GST:</span>{" "}
                    {gstResult
                      ? `\u2713 ${form.gstin}`
                      : form.gstin || "Skipped"}
                  </p>
                  <p>
                    <span className="text-ink-500">Selfie &amp; Video:</span>{" "}
                    {selfieUploaded && videoCompleted
                      ? "\u2713 Complete"
                      : `${selfieUploaded ? "Selfie \u2713" : ""} ${videoCompleted ? "Video \u2713" : ""}`}
                  </p>
                  <p>
                    <span className="text-ink-500">Documents:</span>{" "}
                    {REQUIRED_DOCUMENTS.filter((d) => uploadedDocs[d.type]).length}/{REQUIRED_DOCUMENTS.length} uploaded
                  </p>
                  <p>
                    <span className="text-ink-500">Declaration:</span>{" "}
                    {selfDeclarationUploaded ? "\u2713 Uploaded" : "\u2717 Not uploaded"}
                    {declarationStatus?.requiresApproval && (
                      <> | Approval: {declarationStatus.approval?.status === "APPROVED" ? "\u2713 Approved" : declarationStatus.approval?.status ?? "Not sent"}</>
                    )}
                  </p>
                  {form.msmeNumber && (
                    <p>
                      <span className="text-ink-500">MSME:</span>{" "}
                      {form.msmeNumber}
                    </p>
                  )}
                  <p>
                    <span className="text-ink-500">Name Match:</span>{" "}
                    {nameMismatch ? (
                      <span className="text-amber-600">Mismatch (docs uploaded)</span>
                    ) : (
                      <span className="text-emerald-600">All match</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="mt-6 flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={handleBack}
              disabled={step === 0}
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button
                type="button"
                onClick={handleNext}
                disabled={!canProceed() || verifying}
              >
                {verifying && step === 6 ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {step === 0 ? "Get Started" : "Continue"}{" "}
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={verifying || !canProceed()}
              >
                {verifying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Submit Registration
              </Button>
            )}
          </div>
        </div>
      </div>

      {showNameDeclaration && (
        <NameDeclarationModal
          aadhaarName={aadhaarResult?.name || form.aadhaarName || null}
          panName={panResult?.registered_name || null}
          bankName={bankResult?.nameAtBank || form.bankName || null}
          checked={nameDeclarationChecked}
          onCheckedChange={setNameDeclarationChecked}
          submitting={verifying}
          onCancel={() => setShowNameDeclaration(false)}
          onConfirm={submitRegistration}
        />
      )}
    </div>
  );
}

function NameDeclarationModal({
  aadhaarName,
  panName,
  bankName,
  checked,
  onCheckedChange,
  submitting,
  onCancel,
  onConfirm,
}: {
  aadhaarName: string | null;
  panName: string | null;
  bankName: string | null;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const rows: { label: string; value: string | null }[] = [
    { label: "As per Aadhaar", value: aadhaarName },
    { label: "As per PAN", value: panName },
    { label: "As per Bank Account", value: bankName },
  ].filter((r) => !!r.value);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink-900/50 px-4 py-6"
      onClick={submitting ? undefined : onCancel}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-amber-100 bg-amber-50 px-6 py-5">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" />
          <div>
            <h3 className="text-lg font-bold text-amber-900">
              Name Difference Detected
            </h3>
            <p className="mt-1 text-sm text-amber-800">
              The name on your documents does not match exactly. Please review
              the names below and confirm they all belong to you.
            </p>
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-auto px-6 py-5">
          {rows.map((r) => (
            <div
              key={r.label}
              className="rounded-xl border border-ink-100 bg-ink-50/60 px-4 py-3"
            >
              <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400">
                {r.label}
              </p>
              <p className="mt-0.5 text-sm font-semibold text-ink-900 break-words">
                {r.value}
              </p>
            </div>
          ))}

          <label className="mt-2 flex cursor-pointer items-start gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3 hover:border-brand-300">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => onCheckedChange(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-sm text-ink-700">
              I declare that all the names shown above belong to me and are
              variations of my own legal name. I understand my account will be
              submitted for manual verification and approval by the admin team.
            </span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-ink-100 bg-ink-50/40 px-6 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={!checked || submitting}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Accept &amp; Submit
          </Button>
        </div>
      </div>
    </div>
  );
}

// ----- Helper Components -----

function NameMatchBadge({
  label,
  name1,
  name2,
}: {
  label: string;
  name1: string;
  name2: string;
}) {
  const match = namesMatch(name1, name2);
  return (
    <div
      className={`flex items-center gap-2 rounded-lg p-3 text-sm ${
        match
          ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border border-amber-200 bg-amber-50 text-amber-800"
      }`}
    >
      {match ? (
        <CheckCircle2 className="h-4 w-4 shrink-0" />
      ) : (
        <AlertTriangle className="h-4 w-4 shrink-0" />
      )}
      <span>
        Name {match ? "matches" : "mismatch"} with {label}:{" "}
        <strong>{name1}</strong> vs <strong>{name2}</strong>
      </span>
    </div>
  );
}

function DocumentUploadField({
  label,
  type,
  uploaded,
  uploading,
  removing,
  required,
  accept,
  capture,
  description,
  requiresGps,
  downloadUrl,
  onUpload,
  onRemove,
}: {
  label: string;
  type: string;
  uploaded: boolean;
  uploading: boolean;
  removing?: boolean;
  required?: boolean;
  accept?: string;
  capture?: string;
  description?: string;
  requiresGps?: boolean;
  downloadUrl?: string;
  onUpload: (file: File) => void;
  onRemove?: () => void;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        uploaded
          ? "border-emerald-200 bg-emerald-50"
          : "border-ink-200 bg-white"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {uploaded ? (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          ) : (
            <FileText className="h-5 w-5 shrink-0 text-ink-400" />
          )}
          <div>
            <p className="text-sm font-medium text-ink-900">
              {label} {required ? <span className="text-rose-500">*</span> : <span className="text-ink-400 text-xs">(Optional)</span>}
              {requiresGps && (
                <span className="ml-1 inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                  GPS
                </span>
              )}
            </p>
            {description && !uploaded && (
              <p className="text-xs text-ink-500">{description}</p>
            )}
            {downloadUrl && !uploaded && (
              <a
                href={downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                download
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline mt-0.5"
              >
                <ArrowDown className="h-3 w-3" /> Download template
              </a>
            )}
            {uploaded && (
              <p className="text-xs text-emerald-700">Uploaded successfully</p>
            )}
          </div>
        </div>
        {!uploaded && (
          <label className="cursor-pointer shrink-0">
            <input
              type="file"
              accept={accept || "image/*,.pdf"}
              capture={capture as any}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUpload(file);
              }}
              disabled={uploading}
            />
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {uploading ? "Uploading..." : "Upload"}
            </span>
          </label>
        )}
        {uploaded && onRemove && (
          <button
            type="button"
            onClick={onRemove}
            disabled={removing}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-rose-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
          >
            {removing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
