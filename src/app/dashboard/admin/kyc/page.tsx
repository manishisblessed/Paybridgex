"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Eye,
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  Loader2,
  X,
  User,
  Building2,
  CreditCard,
  Fingerprint,
  Phone,
  Mail,
  MapPin,
  FileText,
  Video,
  ExternalLink,
  Shield,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ReportActions } from "@/components/dashboard/ReportActions";
import { Pagination } from "@/components/ui/Pagination";

type OnboardDoc = {
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

type VerificationEntry = {
  id: string;
  type: string;
  status: string;
  verifiedName: string | null;
  responsePayload: any;
  createdAt: string;
};

type KycDoc = {
  id: string;
  type: string;
  url: string;
  format: string | null;
  resourceType: string | null;
  uploadedAt: string;
};

type KycRow = {
  id: string;
  status: "NOT_STARTED" | "PENDING_REVIEW" | "AWAITING_RESUBMISSION" | "APPROVED" | "REJECTED";
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

type Stats = { pending: number; approved: number; rejected: number; awaitingResubmission: number };

const STATUS_MAP: Record<
  string,
  { label: string; variant: "warning" | "success" | "danger" | "default" | "brand" }
> = {
  NOT_STARTED: { label: "Not started", variant: "default" },
  PENDING_REVIEW: { label: "Awaiting review", variant: "warning" },
  AWAITING_RESUBMISSION: { label: "Awaiting re-upload", variant: "brand" },
  APPROVED: { label: "Verified", variant: "success" },
  REJECTED: { label: "Rejected", variant: "danger" },
};

const ROLE_LABEL: Record<string, string> = {
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

export default function AdminKycPage() {
  const [rows, setRows] = useState<KycRow[]>([]);
  const [stats, setStats] = useState<Stats>({
    pending: 0,
    approved: 0,
    rejected: 0,
    awaitingResubmission: 0,
  });
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [viewing, setViewing] = useState<KycRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 25;

  const fetchQueue = useCallback(async () => {
    try {
      setFetching(true);
      setError(null);
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      const res = await fetch(`/api/kyc/queue?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      setRows(json.kycs);
      setStats(json.stats);
      setTotal(json.total ?? json.kycs?.length ?? 0);
    } catch {
      setError("Could not load KYC queue.");
    } finally {
      setFetching(false);
    }
  }, [page]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  async function decide(id: string, action: "approve" | "reject", reason?: string) {
    setDeciding(id);
    try {
      const res = await fetch(`/api/kyc/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error ?? "Action failed");
        return;
      }
      toast.success(action === "approve" ? "KYC approved." : "KYC rejected.");
      await fetchQueue();
      if (viewing?.id === id) setViewing(null);
    } finally {
      setDeciding(null);
    }
  }

  async function requestResubmission(
    id: string,
    documents: { documentId: string; reason: string }[]
  ) {
    setDeciding(id);
    try {
      const res = await fetch(`/api/kyc/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request_resubmission", documents }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not request re-upload");
        return false;
      }
      toast.success(
        json.emailSent
          ? `Re-upload link sent for ${documents.length} document(s).`
          : `Re-upload requested — link generated (email delivery failed).`
      );
      await fetchQueue();
      if (viewing?.id === id) setViewing(null);
      return true;
    } finally {
      setDeciding(null);
    }
  }

  const reportRows = rows.map((r) => ({
    id: r.id,
    userCode: r.user.userCode ?? "—",
    name: r.user.name,
    email: r.user.email,
    role: ROLE_LABEL[r.user.role] ?? r.user.role,
    shop: r.user.shopName ?? "—",
    city: r.user.city ?? "—",
    pan: r.panNumber ?? "—",
    aadhaar: r.aadhaarLast4 ? `XXXX-${r.aadhaarLast4}` : "—",
    submitted: r.submittedAt
      ? new Date(r.submittedAt).toLocaleDateString("en-IN")
      : "—",
    status: STATUS_MAP[r.status]?.label ?? r.status,
  }));

  const cols: Column<KycRow>[] = [
    {
      key: "user",
      header: "Applicant",
      render: (r) => (
        <div>
          <div className="font-semibold text-ink-900">
            {r.user.name}
            {r.user.userCode && <span className="ml-2 font-medium text-brand-600">{r.user.userCode}</span>}
          </div>
          <div className="text-xs text-ink-500">
            {r.user.shopName ?? r.user.email}
            {r.user.city ? ` · ${r.user.city}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "role" as keyof KycRow,
      header: "Role",
      render: (r) => (
        <Badge
          variant={r.user.role === "DISTRIBUTOR" ? "brand" : "default"}
        >
          {ROLE_LABEL[r.user.role] ?? r.user.role}
        </Badge>
      ),
    },
    {
      key: "panNumber",
      header: "PAN",
      render: (r) => r.panNumber ?? "—",
    },
    {
      key: "aadhaarLast4",
      header: "Aadhaar",
      render: (r) =>
        r.aadhaarLast4 ? `XXXX-XXXX-${r.aadhaarLast4}` : "—",
    },
    {
      key: "submittedAt",
      header: "Submitted",
      render: (r) =>
        r.submittedAt
          ? new Date(r.submittedAt).toLocaleDateString("en-IN", {
              dateStyle: "medium",
            })
          : "—",
    },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        const s = STATUS_MAP[r.status];
        return <Badge variant={s?.variant ?? "default"}>{s?.label ?? r.status}</Badge>;
      },
    },
    {
      key: "id",
      header: "",
      align: "right",
      render: (r) => {
        const busy = deciding === r.id;
        return (
          <div className="flex justify-end gap-1">
            <button
              onClick={() => setViewing(r)}
              className="grid h-8 w-8 place-items-center rounded-lg text-brand-700 hover:bg-brand-50"
              title="View full details"
            >
              <Eye className="h-4 w-4" />
            </button>
            <button
              onClick={() => decide(r.id, "approve")}
              disabled={r.status !== "PENDING_REVIEW" || busy}
              className="grid h-8 w-8 place-items-center rounded-lg text-emerald-700 hover:bg-emerald-50 disabled:opacity-30"
              title="Approve"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={() => setRejectTarget(r.id)}
              disabled={r.status !== "PENDING_REVIEW" || busy}
              className="grid h-8 w-8 place-items-center rounded-lg text-rose-700 hover:bg-rose-50 disabled:opacity-30"
              title="Reject"
            >
              <XCircle className="h-4 w-4" />
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="KYC approvals"
        description="Review applicant documents, validate PAN/Aadhaar, and approve or reject."
        actions={
          <>
            <ReportActions
              filename="kyc-queue"
              title="JMP NextGenPay · KYC Queue"
              subtitle={`${rows.length} applicants`}
              columns={[
                { key: "id", header: "KYC ID" },
                { key: "name", header: "Applicant" },
                { key: "email", header: "Email" },
                { key: "role", header: "Role" },
                { key: "shop", header: "Shop / Firm" },
                { key: "city", header: "City" },
                { key: "pan", header: "PAN" },
                { key: "aadhaar", header: "Aadhaar" },
                { key: "submitted", header: "Submitted" },
                { key: "status", header: "Status" },
              ]}
              rows={reportRows}
            />
            <Button variant="outline" onClick={fetchQueue} disabled={fetching}>
              <RefreshCw
                className={`h-4 w-4 ${fetching ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
            <Button variant="outline" disabled>
              <ShieldCheck className="h-4 w-4" /> Auto-verify (DigiLocker)
            </Button>
          </>
        }
      />

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Awaiting review" value={stats.pending} tone="warning" />
        <Stat label="Awaiting re-upload" value={stats.awaitingResubmission} tone="brand" />
        <Stat label="Verified" value={stats.approved} tone="success" />
        <Stat label="Rejected" value={stats.rejected} tone="danger" />
      </div>

      <DataTable
        title="KYC queue"
        columns={cols}
        data={rows}
        loading={fetching}
        empty="No KYC applications found."
      />
      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />

      {viewing && (
        <DetailDrawer
          kyc={viewing}
          deciding={deciding}
          onDecide={(id, action) => {
            if (action === "reject") setRejectTarget(id);
            else decide(id, action);
          }}
          onRequestResubmission={requestResubmission}
          onClose={() => setViewing(null)}
        />
      )}

      <ConfirmDialog
        open={rejectTarget !== null}
        onClose={() => setRejectTarget(null)}
        busy={rejectTarget !== null && deciding === rejectTarget}
        title="Reject this KYC application?"
        description="The applicant will see the reason you provide and can resubmit their documents."
        confirmLabel="Reject"
        input={{
          label: "Rejection reason (required for the applicant)",
          placeholder: "e.g. Documents insufficient",
          required: true,
        }}
        onConfirm={async (reason) => {
          if (!rejectTarget) return;
          await decide(rejectTarget, "reject", reason);
          setRejectTarget(null);
        }}
      />
    </div>
  );
}

/* ─── Full Detail Drawer ─────────────────────────────────────────────── */

function DetailDrawer({
  kyc,
  deciding,
  onDecide,
  onRequestResubmission,
  onClose,
}: {
  kyc: KycRow;
  deciding: string | null;
  onDecide: (id: string, action: "approve" | "reject") => void;
  onRequestResubmission: (
    id: string,
    documents: { documentId: string; reason: string }[]
  ) => Promise<boolean>;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"details" | "docs" | "verifications">("details");
  // Per-document re-upload flags: docId → reason. Only onboarding docs qualify.
  const [flagged, setFlagged] = useState<Record<string, string>>({});
  const busy = deciding === kyc.id;
  const s = STATUS_MAP[kyc.status];
  const canReview = kyc.status === "PENDING_REVIEW";

  const allDocs = [
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
      gpsLatitude: null as number | null,
      gpsLongitude: null as number | null,
      docStatus: "Uploaded",
      rejectionReason: null as string | null,
      uploadedAt: d.uploadedAt,
      source: "direct" as const,
    })),
  ];

  const uniqueDocs = new Map<string, (typeof allDocs)[0]>();
  for (const doc of allDocs) {
    if (!uniqueDocs.has(doc.type)) {
      uniqueDocs.set(doc.type, doc);
    }
  }
  const docList = Array.from(uniqueDocs.values());

  const flaggedList = Object.entries(flagged);
  const canSubmitResubmission =
    flaggedList.length > 0 && flaggedList.every(([, reason]) => reason.trim().length >= 3);

  function toggleFlag(docId: string) {
    setFlagged((prev) => {
      const next = { ...prev };
      if (docId in next) delete next[docId];
      else next[docId] = "";
      return next;
    });
  }

  function setReason(docId: string, reason: string) {
    setFlagged((prev) => ({ ...prev, [docId]: reason }));
  }

  async function submitResubmission() {
    const documents = flaggedList.map(([documentId, reason]) => ({
      documentId,
      reason: reason.trim(),
    }));
    const ok = await onRequestResubmission(kyc.id, documents);
    if (ok) setFlagged({});
  }

  const tabs = [
    { key: "details" as const, label: "Personal & Business", icon: User },
    { key: "docs" as const, label: `Documents (${docList.length})`, icon: FileText },
    { key: "verifications" as const, label: `KYC Results (${kyc.verifications.length})`, icon: Shield },
  ];

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 px-4 py-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-ink-100 bg-gradient-to-br from-brand-50/60 to-white px-6 py-5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-700">
                KYC Review
              </p>
              <Badge variant={s?.variant ?? "default"}>
                {s?.label ?? kyc.status}
              </Badge>
              {kyc.nameMismatch && (
                <Badge variant="warning">
                  Name Mismatch{kyc.nameDeclarationAccepted ? " · Self-declared" : ""}
                </Badge>
              )}
            </div>
            <h3 className="mt-1 font-display text-xl font-bold text-ink-900 truncate">
              {kyc.user.name}
              {kyc.user.userCode && (
                <span className="ml-2 rounded-md bg-brand-50 px-2 py-0.5 text-sm font-semibold text-brand-600 align-middle">
                  {kyc.user.userCode}
                </span>
              )}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
              <span className="flex items-center gap-1">
                <Mail className="h-3 w-3" /> {kyc.user.email}
              </span>
              <span className="flex items-center gap-1">
                <Phone className="h-3 w-3" /> {kyc.user.phone}
              </span>
              <Badge variant={kyc.user.role === "DISTRIBUTOR" ? "brand" : "default"}>
                {ROLE_LABEL[kyc.user.role] ?? kyc.user.role}
              </Badge>
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-500 hover:bg-ink-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-ink-100 bg-ink-50/40 px-6">
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
        <div className="flex-1 overflow-auto p-6">
          {activeTab === "details" && <DetailsTab kyc={kyc} />}
          {activeTab === "docs" && (
            <DocsTab
              docs={docList}
              selectable={canReview}
              flagged={flagged}
              onToggleFlag={toggleFlag}
              onReason={setReason}
            />
          )}
          {activeTab === "verifications" && <VerificationsTab verifications={kyc.verifications} />}
        </div>

        {/* Footer with actions */}
        <div className="flex items-center justify-between gap-3 border-t border-ink-100 bg-ink-50/40 px-6 py-3">
          <div className="text-xs text-ink-500">
            {flaggedList.length > 0 ? (
              <span className="font-semibold text-brand-700">
                {flaggedList.length} document{flaggedList.length === 1 ? "" : "s"} flagged for re-upload
              </span>
            ) : kyc.status === "AWAITING_RESUBMISSION" ? (
              <span className="font-semibold text-brand-700">
                Waiting for the applicant to re-upload
              </span>
            ) : (
              kyc.submittedAt && (
                <>Submitted {new Date(kyc.submittedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</>
              )
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose}>Close</Button>
            {canReview && flaggedList.length > 0 ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setFlagged({})}
                  disabled={busy}
                >
                  Clear
                </Button>
                <Button
                  onClick={submitResubmission}
                  disabled={busy || !canSubmitResubmission}
                  className="bg-brand-600 hover:bg-brand-700"
                  title={!canSubmitResubmission ? "Add a reason (min 3 characters) for each flagged document" : undefined}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Request re-upload ({flaggedList.length})
                </Button>
              </>
            ) : (
              canReview && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => onDecide(kyc.id, "reject")}
                    disabled={busy}
                    className="border-rose-200 text-rose-700 hover:bg-rose-50"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                    Reject
                  </Button>
                  <Button
                    onClick={() => onDecide(kyc.id, "approve")}
                    disabled={busy}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Approve
                  </Button>
                </>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Details Tab ────────────────────────────────────────────────────── */

function DetailsTab({ kyc }: { kyc: KycRow }) {
  return (
    <div className="space-y-6">
      {/* Personal Info */}
      <Section title="Personal Information" icon={User}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <InfoField label="Full Name" value={kyc.user.name} />
          <InfoField label="Email" value={kyc.user.email} />
          <InfoField label="Phone" value={kyc.user.phone} />
          <InfoField label="Date of Birth" value={kyc.aadhaarDob ?? (kyc.dob ? new Date(kyc.dob).toLocaleDateString("en-IN") : "—")} />
          <InfoField label="Gender" value={kyc.aadhaarGender ?? "—"} />
          <InfoField label="Role" value={ROLE_LABEL[kyc.user.role] ?? kyc.user.role} />
        </div>
      </Section>

      {/* Business Info */}
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

      {/* Aadhaar */}
      <Section title="Aadhaar Details" icon={Fingerprint} verified={!!kyc.aadhaarVerifiedAt}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <InfoField label="Name (as per Aadhaar)" value={kyc.aadhaarName ?? "—"} />
          <InfoField label="Aadhaar No." value={kyc.aadhaarNumber ? `XXXX-XXXX-${kyc.aadhaarLast4}` : "—"} />
          <InfoField label="DOB" value={kyc.aadhaarDob ?? "—"} />
          <InfoField label="Gender" value={kyc.aadhaarGender ?? "—"} />
          <InfoField label="Mobile (Aadhaar)" value={kyc.aadhaarMobile ?? "—"} />
          <div className="sm:col-span-2 lg:col-span-3">
            <InfoField label="Address (Aadhaar)" value={kyc.aadhaarAddress ?? "—"} />
          </div>
        </div>
      </Section>

      {/* PAN */}
      <Section title="PAN Details" icon={CreditCard} verified={!!kyc.panVerifiedAt}>
        <div className="grid gap-3 sm:grid-cols-2">
          <InfoField label="PAN Number" value={kyc.panNumber ?? "—"} />
          <InfoField label="Name (as per PAN)" value={kyc.panName ?? "—"} />
        </div>
      </Section>

      {/* Bank */}
      <Section title="Bank Account" icon={Building2} verified={!!kyc.bankVerifiedAt}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <InfoField label="Account Holder" value={kyc.bankAccountName ?? "—"} />
          <InfoField label="Account Number" value={kyc.bankAccountNumber ?? "—"} />
          <InfoField label="IFSC Code" value={kyc.bankIfsc ?? "—"} />
          <InfoField label="Account Status" value={kyc.bankAccountStatus?.toUpperCase() ?? "—"} highlight={kyc.bankAccountStatus === "active" ? "success" : undefined} />
        </div>
      </Section>

      {/* Name Mismatch Warning */}
      {kyc.nameMismatch && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-800">Name Mismatch Detected</p>
            <p className="mt-1 text-xs text-amber-700">
              The names across Aadhaar, PAN, and/or Bank records do not match exactly. Compare them below before approving.
            </p>

            {/* Side-by-side comparison — the exact names the applicant reviewed */}
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
                  ? ` on ${new Date(kyc.nameDeclarationAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`
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

function DocsTab({
  docs,
  selectable = false,
  flagged = {},
  onToggleFlag,
  onReason,
}: {
  docs: Array<{ id: string; type: string; url: string | null; format: string | null; resourceType: string; hasGps: boolean; gpsLatitude: number | null; gpsLongitude: number | null; docStatus: string; rejectionReason: string | null; uploadedAt: string; source: "onboarding" | "direct" }>;
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
          const isVideo = doc.resourceType === "video" || ["mp4", "webm", "mov"].includes(doc.format ?? "");
          const isPdf = doc.format === "pdf";
          // Always open through the signed endpoint so private PDFs (and any
          // asset whose stored URL signature is unavailable) resolve reliably.
          const openHref = `/api/kyc/document/${doc.id}`;
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
              {/* Preview */}
              {doc.url && isImage ? (
                <button
                  type="button"
                  onClick={() => setLightbox(doc.url)}
                  className="relative block h-40 w-full bg-ink-50 overflow-hidden"
                >
                  <img
                    src={doc.url}
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

              {/* Info */}
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

                {/* Existing rejection (already requested) */}
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

                {/* Reason input for a freshly flagged document */}
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

      {/* Image lightbox */}
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

function VerificationsTab({ verifications }: { verifications: VerificationEntry[] }) {
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
              isSuccess
                ? "border-emerald-200 bg-emerald-50/50"
                : "border-rose-200 bg-rose-50/50"
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
              <Badge variant={isSuccess ? "success" : "danger"}>
                {v.status}
              </Badge>
            </div>
            {v.verifiedName && (
              <p className="mt-2 text-xs text-ink-600">
                <span className="font-medium">Verified Name:</span> {v.verifiedName}
              </p>
            )}
            {/* Show key details from response payload for common types */}
            {v.type === "GST" && payload && (
              <div className="mt-2 grid gap-1 text-xs text-ink-600 sm:grid-cols-2">
                {payload.trade_name && <p><span className="font-medium">Trade Name:</span> {payload.trade_name}</p>}
                {payload.legal_name && <p><span className="font-medium">Legal Name:</span> {payload.legal_name}</p>}
                {payload.gst_status && <p><span className="font-medium">Status:</span> {payload.gst_status}</p>}
                {payload.taxpayer_type && <p><span className="font-medium">Type:</span> {payload.taxpayer_type}</p>}
              </div>
            )}
            {(v.type === "BANK_PENNY_DROP" || v.type === "BANK_ADVANCE") && payload && (
              <div className="mt-2 grid gap-1 text-xs text-ink-600 sm:grid-cols-2">
                {payload.nameAtBank && <p><span className="font-medium">Name at Bank:</span> {payload.nameAtBank}</p>}
                {payload.accountStatus && <p><span className="font-medium">Account Status:</span> {payload.accountStatus}</p>}
                {payload.utr && <p><span className="font-medium">UTR:</span> {payload.utr}</p>}
              </div>
            )}
            <p className="mt-2 text-[11px] text-ink-400">
              {new Date(v.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Helper Components ──────────────────────────────────────────────── */

function Section({
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
        <h4 className="text-xs font-bold uppercase tracking-widest text-ink-500">
          {title}
        </h4>
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

function InfoField({
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
      <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400">
        {label}
      </p>
      <p className={`mt-0.5 text-sm font-semibold ${highlightClass} break-words`}>
        {value}
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "danger" | "warning" | "brand";
}) {
  const map = {
    success: "from-emerald-500 to-emerald-700 text-emerald-50",
    danger: "from-rose-500 to-rose-700 text-rose-50",
    warning: "from-amber-500 to-amber-700 text-amber-50",
    brand: "from-brand-500 to-brand-700 text-brand-50",
  };
  return (
    <div
      className={`rounded-2xl bg-gradient-to-br ${map[tone]} p-5 shadow-soft`}
    >
      <p className="text-xs font-bold uppercase tracking-widest opacity-90">
        {label}
      </p>
      <p className="mt-2 font-display text-3xl font-bold">{value}</p>
    </div>
  );
}
