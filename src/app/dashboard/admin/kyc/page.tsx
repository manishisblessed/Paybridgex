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
  Phone,
  Mail,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ReportActions } from "@/components/dashboard/ReportActions";
import { Pagination } from "@/components/ui/Pagination";
import {
  KycDetailView,
  STATUS_MAP,
  ROLE_LABEL,
  type KycDetailData,
} from "@/components/kyc/KycDetailView";

type KycRow = KycDetailData & {
  /**
   * Present only while `status === "AWAITING_RESUBMISSION"`. Reflects whether
   * the applicant has re-uploaded every flagged document (so the admin can act
   * even if the applicant never pressed the final "submit" button).
   */
  resubmit: { ready: boolean; pending: number; done: number; total: number } | null;
};

type Stats = { pending: number; approved: number; rejected: number; awaitingResubmission: number };

/**
 * An application can be approved/rejected when it's freshly submitted, OR when
 * it was awaiting a re-upload and the applicant has already replaced every
 * flagged document (even without hitting the final "submit" button).
 */
function isReviewable(r: Pick<KycRow, "status" | "resubmit">): boolean {
  return (
    r.status === "PENDING_REVIEW" ||
    (r.status === "AWAITING_RESUBMISSION" && !!r.resubmit?.ready)
  );
}

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
              disabled={!isReviewable(r) || busy}
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
              disabled={!isReviewable(r) || busy}
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
              title="Paybridgex · KYC Queue"
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
  // Per-document re-upload flags: docId → reason. Only onboarding docs qualify.
  const [flagged, setFlagged] = useState<Record<string, string>>({});
  const busy = deciding === kyc.id;
  const s = STATUS_MAP[kyc.status];
  const canReview = isReviewable(kyc);

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

        {/* Tabs + body */}
        <div className="flex-1 overflow-auto">
          <KycDetailView
            kyc={kyc}
            docsSelectable={canReview}
            flagged={flagged}
            onToggleFlag={toggleFlag}
            onReason={setReason}
          />
        </div>

        {/* Footer with actions */}
        <div className="flex items-center justify-between gap-3 border-t border-ink-100 bg-ink-50/40 px-6 py-3">
          <div className="text-xs text-ink-500">
            {flaggedList.length > 0 ? (
              <span className="font-semibold text-brand-700">
                {flaggedList.length} document{flaggedList.length === 1 ? "" : "s"} flagged for re-upload
              </span>
            ) : kyc.status === "AWAITING_RESUBMISSION" ? (
              kyc.resubmit?.ready ? (
                <span className="font-semibold text-emerald-700">
                  Documents re-uploaded — ready for review
                </span>
              ) : (
                <span className="font-semibold text-brand-700">
                  Waiting for the applicant to re-upload
                  {kyc.resubmit && kyc.resubmit.total > 0
                    ? ` (${kyc.resubmit.done}/${kyc.resubmit.total} re-uploaded)`
                    : ""}
                </span>
              )
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

/* ─── Helper Components ──────────────────────────────────────────────── */

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
