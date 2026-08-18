"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  FileText,
  Fingerprint,
  MapPin,
  Shield,
  User,
  Video,
  X,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";

/* ─── Shared types ───────────────────────────────────────────────────── */

export type OnboardDoc = {
  id: string;
  type: string;
  originalType: string;
  status: string;
  url: string | null;
  format: string | null;
  publicId: string | null;
  resourceType: string;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  rejectionReason: string | null;
  createdAt: string;
};

export type VerificationEntry = {
  id: string;
  type: string;
  status: string;
  verifiedName: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  responsePayload: any;
  createdAt: string;
};

export type KycDoc = {
  id: string;
  type: string;
  url: string;
  format: string | null;
  resourceType: string | null;
  uploadedAt: string;
};

export type KycStatus =
  | "NOT_STARTED"
  | "PENDING_REVIEW"
  | "AWAITING_RESUBMISSION"
  | "APPROVED"
  | "REJECTED";

/** The display payload rendered by the KYC detail tabs (see `buildKycDetail`). */
export type KycDetailData = {
  id: string;
  status: KycStatus;
  panNumber: string | null;
  panName: string | null;
  panVerifiedAt: string | null;
  aadhaarLast4: string | null;
  aadhaarNumber: string | null;
  aadhaarName: string | null;
  aadhaarDob: string | null;
  aadhaarGender: string | null;
  aadhaarAddress: string | null;
  aadhaarMobile: string | null;
  aadhaarVerifiedAt: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  bankAccountStatus: string | null;
  bankVerifiedAt: string | null;
  gstin: string | null;
  gstVerified: boolean;
  gstLegalName: string | null;
  gstTradeName: string | null;
  msmeNumber: string | null;
  nameMismatch: boolean;
  nameDeclarationAccepted: boolean;
  nameDeclarationAt: string | null;
  dob: string | null;
  rejectedReason: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  user: {
    id: string;
    userCode: string | null;
    name: string;
    email: string;
    phone: string;
    role: string;
    status: string;
    shopName: string | null;
    shopAddress: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
  };
  documents: KycDoc[];
  verifications: VerificationEntry[];
  onboardingDocs: OnboardDoc[];
};

/* ─── Shared label maps ──────────────────────────────────────────────── */

export const STATUS_MAP: Record<
  string,
  { label: string; variant: "warning" | "success" | "danger" | "default" | "brand" }
> = {
  NOT_STARTED: { label: "Not started", variant: "default" },
  PENDING_REVIEW: { label: "Awaiting review", variant: "warning" },
  AWAITING_RESUBMISSION: { label: "Awaiting re-upload", variant: "brand" },
  APPROVED: { label: "Verified", variant: "success" },
  REJECTED: { label: "Rejected", variant: "danger" },
};

export const ROLE_LABEL: Record<string, string> = {
  RETAILER: "Retailer",
  DISTRIBUTOR: "Distributor",
  MASTER_DISTRIBUTOR: "Master Dist.",
  SUPER_DISTRIBUTOR: "Super Dist.",
  ADMIN: "Admin",
  SUPPORT: "Sub-admin",
};

const DOC_TYPE_LABEL: Record<string, string> = {
  PAN: "PAN Card",
  AADHAAR_FRONT: "Aadhaar (Front)",
  AADHAAR_BACK: "Aadhaar (Back)",
  SHOP_PHOTO: "Shop Photo",
  BANK_PROOF: "Bank Proof",
  CANCEL_CHEQUE: "Cancelled Cheque / Passbook",
  PASSBOOK: "Bank Passbook",
  GST_CERT: "GST Certificate",
  SELFIE: "Live Selfie",
  LIVE_VIDEO: "Liveness Video",
  VIDEO: "Liveness Video",
  ONBOARD_VIDEO: "Onboarding Liveness Video",
  AGREEMENT: "Agreement",
  SHOP_ESTABLISHMENT: "Shop & Establishment Certificate",
  GUMASTA_LICENSE: "Gumasta License",
  SIGNATURE: "Signature",
  ELECTRICITY_BILL: "Electricity Bill",
  ADDITIONAL_ID: "Additional ID Proof",
  FAMILY_REFERENCE: "Family Reference Document",
  PG_FORM: "PG Form",
  GPS_PHOTO_OUTSIDE: "GPS Photo — Outside",
  GPS_PHOTO_INSIDE: "GPS Photo — Inside",
  GPS_SELFIE_DISTRIBUTOR: "GPS Selfie with Distributor",
  DISTRIBUTOR_DECLARATION: "Distributor Declaration",
  SELF_DECLARATION: "Self Declaration Form",
  SUCCESSOR_DECLARATION: "Successor Declaration",
  OTHER: "Other Document",
};

const VERIFICATION_LABEL: Record<string, string> = {
  AADHAAR_DIGILOCKER: "Aadhaar (DigiLocker)",
  AADHAAR_DIGILOCKER_INIT: "Aadhaar Init",
  PAN_360: "PAN Verification",
  BANK_PENNY_DROP: "Bank (Penny Drop)",
  BANK_ADVANCE: "Bank (Advance)",
  GST: "GST Verification",
  CIN: "CIN Verification",
};

/* ─── Merged document row (onboarding + direct), deduped by type ─────── */

export type MergedDoc = {
  id: string;
  type: string;
  url: string | null;
  format: string | null;
  resourceType: string;
  hasGps: boolean;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  docStatus: string;
  rejectionReason: string | null;
  uploadedAt: string;
  source: "onboarding" | "direct";
};

/** Merge onboarding + directly-uploaded documents, keeping the newest per type. */
export function buildDocList(kyc: Pick<KycDetailData, "onboardingDocs" | "documents">): MergedDoc[] {
  const allDocs: MergedDoc[] = [
    ...kyc.onboardingDocs.map((d) => ({
      id: d.id,
      type: d.type,
      url: d.url,
      format: d.format,
      resourceType: d.resourceType,
      hasGps: !!(d.gpsLatitude && d.gpsLongitude),
      gpsLatitude: d.gpsLatitude,
      gpsLongitude: d.gpsLongitude,
      docStatus: d.status,
      rejectionReason: d.rejectionReason,
      uploadedAt: d.createdAt,
      source: "onboarding" as const,
    })),
    ...kyc.documents.map((d) => ({
      id: d.id,
      type: d.type,
      url: d.url,
      format: d.format,
      resourceType: d.resourceType ?? "image",
      hasGps: false,
      gpsLatitude: null,
      gpsLongitude: null,
      docStatus: "Uploaded",
      rejectionReason: null,
      uploadedAt: d.uploadedAt,
      source: "direct" as const,
    })),
  ];

  const uniqueDocs = new Map<string, MergedDoc>();
  for (const doc of allDocs) {
    if (!uniqueDocs.has(doc.type)) uniqueDocs.set(doc.type, doc);
  }
  return Array.from(uniqueDocs.values());
}

/* ─── Top-level tabbed view (Personal / Documents / KYC Results) ─────── */

export function KycDetailView({
  kyc,
  getDocHref = (docId: string) => `/api/kyc/document/${docId}`,
  docsSelectable = false,
  flagged = {},
  onToggleFlag,
  onReason,
}: {
  kyc: KycDetailData;
  /** Where document open/preview links point. Defaults to the admin endpoint. */
  getDocHref?: (docId: string) => string;
  /** Admin-only: enable per-document "request re-upload" flagging. */
  docsSelectable?: boolean;
  flagged?: Record<string, string>;
  onToggleFlag?: (docId: string) => void;
  onReason?: (docId: string, reason: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<"details" | "docs" | "verifications">("details");
  const docList = useMemo(() => buildDocList(kyc), [kyc]);

  const tabs = [
    { key: "details" as const, label: "Personal & Business", icon: User },
    { key: "docs" as const, label: `Documents (${docList.length})`, icon: FileText },
    {
      key: "verifications" as const,
      label: `KYC Results (${kyc.verifications.length})`,
      icon: Shield,
    },
  ];

  return (
    <div className="flex flex-col">
      {/* Tabs */}
      <div className="flex gap-0 border-b border-ink-100 bg-ink-50/40 px-1">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors ${
                active
                  ? "border-brand-600 text-brand-700"
                  : "border-transparent text-ink-500 hover:text-ink-700"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div className="p-6">
        {activeTab === "details" && <DetailsTab kyc={kyc} />}
        {activeTab === "docs" && (
          <DocsTab
            docs={docList}
            getDocHref={getDocHref}
            selectable={docsSelectable}
            flagged={flagged}
            onToggleFlag={onToggleFlag}
            onReason={onReason}
          />
        )}
        {activeTab === "verifications" && (
          <VerificationsTab verifications={kyc.verifications} />
        )}
      </div>
    </div>
  );
}

/* ─── Details Tab ────────────────────────────────────────────────────── */

export function DetailsTab({ kyc }: { kyc: KycDetailData }) {
  return (
    <div className="space-y-6">
      <Section title="Personal Information" icon={User}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <InfoField label="Full Name" value={kyc.user.name} />
          <InfoField label="Email" value={kyc.user.email} />
          <InfoField label="Phone" value={kyc.user.phone} />
          <InfoField
            label="Date of Birth"
            value={
              kyc.aadhaarDob ??
              (kyc.dob ? new Date(kyc.dob).toLocaleDateString("en-IN") : "—")
            }
          />
          <InfoField label="Gender" value={kyc.aadhaarGender ?? "—"} />
          <InfoField label="Role" value={ROLE_LABEL[kyc.user.role] ?? kyc.user.role} />
        </div>
      </Section>

      <Section title="Business Details" icon={Building2} verified={kyc.gstVerified}>
        <div className="grid gap-3 sm:grid-cols-2">
          <InfoField label="Shop / Firm Name" value={kyc.user.shopName ?? "—"} />
          <InfoField label="GSTIN" value={kyc.gstin ?? "—"} />
          {kyc.gstLegalName && <InfoField label="GST Legal Name" value={kyc.gstLegalName} />}
          {kyc.gstTradeName && <InfoField label="GST Trade Name" value={kyc.gstTradeName} />}
          <InfoField label="MSME / Udyam No." value={kyc.msmeNumber ?? "—"} />
          <div className="sm:col-span-2">
            <InfoField label="Shop Address" value={kyc.user.shopAddress ?? "—"} />
          </div>
          <InfoField label="City" value={kyc.user.city ?? "—"} />
          <InfoField label="State" value={kyc.user.state ?? "—"} />
          <InfoField label="Pincode" value={kyc.user.pincode ?? "—"} />
        </div>
      </Section>

      <Section title="Aadhaar Details" icon={Fingerprint} verified={!!kyc.aadhaarVerifiedAt}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <InfoField label="Name (as per Aadhaar)" value={kyc.aadhaarName ?? "—"} />
          <InfoField
            label="Aadhaar No."
            value={kyc.aadhaarNumber ? `XXXX-XXXX-${kyc.aadhaarLast4}` : "—"}
          />
          <InfoField label="DOB" value={kyc.aadhaarDob ?? "—"} />
          <InfoField label="Gender" value={kyc.aadhaarGender ?? "—"} />
          <InfoField label="Mobile (Aadhaar)" value={kyc.aadhaarMobile ?? "—"} />
          <div className="sm:col-span-2 lg:col-span-3">
            <InfoField label="Address (Aadhaar)" value={kyc.aadhaarAddress ?? "—"} />
          </div>
        </div>
      </Section>

      <Section title="PAN Details" icon={CreditCard} verified={!!kyc.panVerifiedAt}>
        <div className="grid gap-3 sm:grid-cols-2">
          <InfoField label="PAN Number" value={kyc.panNumber ?? "—"} />
          <InfoField label="Name (as per PAN)" value={kyc.panName ?? "—"} />
        </div>
      </Section>

      <Section title="Bank Account" icon={Building2} verified={!!kyc.bankVerifiedAt}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <InfoField label="Account Holder" value={kyc.bankAccountName ?? "—"} />
          <InfoField label="Account Number" value={kyc.bankAccountNumber ?? "—"} />
          <InfoField label="IFSC Code" value={kyc.bankIfsc ?? "—"} />
          <InfoField
            label="Account Status"
            value={kyc.bankAccountStatus?.toUpperCase() ?? "—"}
            highlight={kyc.bankAccountStatus === "active" ? "success" : undefined}
          />
        </div>
      </Section>

      {kyc.nameMismatch && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-800">Name Mismatch Detected</p>
            <p className="mt-1 text-xs text-amber-700">
              The names across Aadhaar, PAN, and/or Bank records do not match exactly. Compare
              them below before approving.
            </p>

            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {[
                { label: "As per Aadhaar", value: kyc.aadhaarName },
                { label: "As per PAN", value: kyc.panName },
                { label: "As per Bank", value: kyc.bankAccountName },
              ]
                .filter((r) => !!r.value)
                .map((r) => (
                  <div
                    key={r.label}
                    className="rounded-lg border border-amber-200 bg-white/70 px-3 py-2"
                  >
                    <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500">
                      {r.label}
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-ink-900 break-words">
                      {r.value}
                    </p>
                  </div>
                ))}
            </div>

            {kyc.nameDeclarationAccepted && (
              <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                Applicant self-declared that all names belong to them
                {kyc.nameDeclarationAt
                  ? ` on ${new Date(kyc.nameDeclarationAt).toLocaleString("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}`
                  : ""}
                .
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Documents Tab ──────────────────────────────────────────────────── */

export function DocsTab({
  docs,
  getDocHref,
  selectable = false,
  flagged = {},
  onToggleFlag,
  onReason,
}: {
  docs: MergedDoc[];
  getDocHref: (docId: string) => string;
  selectable?: boolean;
  flagged?: Record<string, string>;
  onToggleFlag?: (docId: string) => void;
  onReason?: (docId: string, reason: string) => void;
}) {
  const [lightbox, setLightbox] = useState<string | null>(null);

  if (docs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-ink-400">
        <FileText className="h-10 w-10 mb-3" />
        <p className="text-sm font-medium">No documents uploaded</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {docs.map((doc) => {
          const isImage = doc.resourceType === "image" && doc.format !== "pdf";
          const isVideo =
            doc.resourceType === "video" || ["mp4", "webm", "mov"].includes(doc.format ?? "");
          const isPdf = doc.format === "pdf";
          // Always open through the signed endpoint so private PDFs (and any
          // asset whose stored URL signature is unavailable) resolve reliably.
          const openHref = getDocHref(doc.id);
          // For S3-backed previews the stored url IS an internal endpoint, so
          // route the inline <img> through the signed endpoint too.
          const imgSrc =
            doc.url && !doc.url.startsWith("/api/") ? doc.url : openHref;
          const isRejected = doc.docStatus === "Rejected";
          const isFlagged = doc.id in flagged;
          const canFlag = selectable && doc.source === "onboarding";

          return (
            <div
              key={doc.id}
              className={`group rounded-xl border bg-white overflow-hidden transition hover:shadow-sm ${
                isFlagged
                  ? "border-brand-400 ring-1 ring-brand-300"
                  : isRejected
                  ? "border-rose-200"
                  : "border-ink-200 hover:border-brand-300"
              }`}
            >
              {doc.url && isImage ? (
                <button
                  type="button"
                  onClick={() => setLightbox(imgSrc)}
                  className="relative block h-40 w-full bg-ink-50 overflow-hidden"
                >
                  <img
                    src={imgSrc}
                    alt={DOC_TYPE_LABEL[doc.type] ?? doc.type}
                    className="h-full w-full object-contain transition group-hover:scale-[1.02]"
                    loading="lazy"
                  />
                </button>
              ) : isVideo ? (
                <a
                  href={openHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group/vid relative flex h-40 w-full items-center justify-center bg-ink-900 transition hover:bg-ink-800"
                >
                  <Video className="h-10 w-10 text-white/60 transition group-hover/vid:text-white/90" />
                  <span className="absolute bottom-2 text-[11px] font-medium text-white/70">
                    Click to play
                  </span>
                </a>
              ) : isPdf ? (
                <a
                  href={openHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative flex h-28 w-full items-center justify-center bg-rose-50 hover:bg-rose-100 transition"
                >
                  <FileText className="h-8 w-8 text-rose-400" />
                  <span className="ml-2 text-xs font-bold text-rose-500 uppercase">PDF</span>
                </a>
              ) : (
                <div className="relative h-28 w-full bg-ink-50 flex items-center justify-center">
                  <FileText className="h-8 w-8 text-ink-300" />
                </div>
              )}

              <div className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink-800 truncate">
                    {DOC_TYPE_LABEL[doc.type] ?? doc.type.replace(/_/g, " ")}
                  </p>
                  {isRejected ? (
                    <XCircle className="h-4 w-4 shrink-0 text-rose-500" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-500">
                  {doc.format && (
                    <span className="rounded bg-ink-100 px-1.5 py-0.5 font-medium uppercase">
                      {doc.format}
                    </span>
                  )}
                  <span>{new Date(doc.uploadedAt).toLocaleDateString("en-IN")}</span>
                  {doc.hasGps && doc.gpsLatitude && doc.gpsLongitude && (
                    <a
                      href={`https://www.google.com/maps?q=${doc.gpsLatitude},${doc.gpsLongitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-0.5 font-medium text-amber-600 hover:underline"
                    >
                      <MapPin className="h-3 w-3" /> GPS
                    </a>
                  )}
                </div>

                {isRejected && doc.rejectionReason && (
                  <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700">
                    <span className="font-semibold">Re-upload requested:</span> {doc.rejectionReason}
                  </div>
                )}

                <div className="mt-2 flex items-center justify-between gap-2">
                  <a
                    href={openHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                  >
                    Open in new tab <ExternalLink className="h-3 w-3" />
                  </a>
                  {canFlag && (
                    <button
                      type="button"
                      onClick={() => onToggleFlag?.(doc.id)}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
                        isFlagged
                          ? "border-brand-300 bg-brand-50 text-brand-700"
                          : "border-ink-200 text-ink-500 hover:border-rose-200 hover:text-rose-600"
                      }`}
                    >
                      {isFlagged ? (
                        <>
                          <X className="h-3 w-3" /> Flagged
                        </>
                      ) : (
                        <>
                          <XCircle className="h-3 w-3" /> Request re-upload
                        </>
                      )}
                    </button>
                  )}
                </div>

                {canFlag && isFlagged && (
                  <div className="mt-2">
                    <textarea
                      autoFocus
                      value={flagged[doc.id] ?? ""}
                      onChange={(e) => onReason?.(doc.id, e.target.value)}
                      placeholder="Reason the applicant will see (e.g. Photo is blurry / wrong document)"
                      rows={2}
                      className="w-full resize-none rounded-lg border border-brand-200 bg-white px-2.5 py-1.5 text-xs text-ink-800 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-300"
                    />
                    {(flagged[doc.id] ?? "").trim().length < 3 && (
                      <p className="mt-1 text-[10px] text-rose-500">
                        Add a short reason (min 3 characters).
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-ink-900/80 p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
            onClick={() => setLightbox(null)}
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightbox}
            alt="Document preview"
            className="max-h-[88vh] max-w-[92vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

/* ─── Verifications Tab ──────────────────────────────────────────────── */

export function VerificationsTab({ verifications }: { verifications: VerificationEntry[] }) {
  if (verifications.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-ink-400">
        <Shield className="h-10 w-10 mb-3" />
        <p className="text-sm font-medium">No verification results found</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {verifications.map((v) => {
        const isSuccess = v.status === "Success";
        const payload = v.responsePayload ?? {};
        return (
          <div
            key={v.id}
            className={`rounded-xl border p-4 ${
              isSuccess ? "border-emerald-200 bg-emerald-50/50" : "border-rose-200 bg-rose-50/50"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isSuccess ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-rose-600" />
                )}
                <span className="text-sm font-semibold text-ink-900">
                  {VERIFICATION_LABEL[v.type] ?? v.type.replace(/_/g, " ")}
                </span>
              </div>
              <Badge variant={isSuccess ? "success" : "danger"}>{v.status}</Badge>
            </div>
            {v.verifiedName && (
              <p className="mt-2 text-xs text-ink-600">
                <span className="font-medium">Verified Name:</span> {v.verifiedName}
              </p>
            )}
            {v.type === "GST" && payload && (
              <div className="mt-2 grid gap-1 text-xs text-ink-600 sm:grid-cols-2">
                {payload.trade_name && (
                  <p>
                    <span className="font-medium">Trade Name:</span> {payload.trade_name}
                  </p>
                )}
                {payload.legal_name && (
                  <p>
                    <span className="font-medium">Legal Name:</span> {payload.legal_name}
                  </p>
                )}
                {payload.gst_status && (
                  <p>
                    <span className="font-medium">Status:</span> {payload.gst_status}
                  </p>
                )}
                {payload.taxpayer_type && (
                  <p>
                    <span className="font-medium">Type:</span> {payload.taxpayer_type}
                  </p>
                )}
              </div>
            )}
            {(v.type === "BANK_PENNY_DROP" || v.type === "BANK_ADVANCE") && payload && (
              <div className="mt-2 grid gap-1 text-xs text-ink-600 sm:grid-cols-2">
                {payload.nameAtBank && (
                  <p>
                    <span className="font-medium">Name at Bank:</span> {payload.nameAtBank}
                  </p>
                )}
                {payload.accountStatus && (
                  <p>
                    <span className="font-medium">Account Status:</span> {payload.accountStatus}
                  </p>
                )}
                {payload.utr && (
                  <p>
                    <span className="font-medium">UTR:</span> {payload.utr}
                  </p>
                )}
              </div>
            )}
            <p className="mt-2 text-[11px] text-ink-400">
              {new Date(v.createdAt).toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Helper components ──────────────────────────────────────────────── */

export function Section({
  title,
  icon: Icon,
  verified,
  children,
}: {
  title: string;
  icon: typeof User;
  verified?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-brand-600" />
        <h4 className="text-xs font-bold uppercase tracking-widest text-ink-500">{title}</h4>
        {verified && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
            <CheckCircle2 className="h-3 w-3" /> Verified
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

export function InfoField({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "success" | "danger";
}) {
  const highlightClass =
    highlight === "success"
      ? "text-emerald-700 font-bold"
      : highlight === "danger"
      ? "text-rose-700 font-bold"
      : "text-ink-900";

  return (
    <div className="rounded-xl border border-ink-100 bg-ink-50/50 px-4 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${highlightClass} break-words`}>{value}</p>
    </div>
  );
}
