"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertTriangle,
  Loader2,
  Eye,
  X,
  ShieldCheck,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Label, Select } from "@/components/ui/Input";
import { ReportActions } from "@/components/dashboard/ReportActions";
import { formatINR } from "@/lib/utils";

type PayoutStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "PROCESSING"
  | "SUCCESS"
  | "FAILED"
  | "REJECTED"
  | "REVERSED";

type Payout = {
  id: string;
  beneficiaryName: string;
  accountLast4: string;
  mode: string;
  amount: number;
  serviceCharge: number;
  gst: number;
  totalDebit: number;
  status: PayoutStatus;
  utr: string | null;
  failureReason: string | null;
  remarks: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string; role: string };
};

type PayoutDetail = Payout & {
  maskedAccount: string;
  ifsc: string | null;
  bulkpeReferenceId: string;
  bulkpeTxnId: string | null;
  makerId: string;
  checker: { id: string; name: string } | null;
  approvedAt: string | null;
  processedAt: string | null;
  completedAt: string | null;
};

const STATUS_BADGE: Record<PayoutStatus, "success" | "danger" | "warning" | "brand" | "default"> = {
  SUCCESS: "success",
  FAILED: "danger",
  REJECTED: "danger",
  REVERSED: "danger",
  PROCESSING: "brand",
  APPROVED: "brand",
  PENDING_APPROVAL: "warning",
  DRAFT: "default",
};

const STATUS_LABEL: Record<PayoutStatus, string> = {
  SUCCESS: "Success",
  FAILED: "Failed",
  REJECTED: "Rejected",
  REVERSED: "Reversed",
  PROCESSING: "Processing",
  APPROVED: "Approved",
  PENDING_APPROVAL: "Pending",
  DRAFT: "Draft",
};

const inr2 = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PayoutApprovalsPage() {
  const [rows, setRows] = useState<Payout[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"PENDING" | "ALL">("PENDING");
  const [deciding, setDeciding] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [decisionTarget, setDecisionTarget] = useState<{ row: Payout; action: "approve" | "reject" } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setFetching(true);
      setError(null);
      const res = await fetch("/api/payout");
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      setRows(json.payouts);
    } catch {
      setError("Could not load payout approvals.");
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function decide(id: string, action: "approve" | "reject", remarks?: string) {
    setDeciding(id);
    try {
      const res = await fetch(`/api/payout/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, remarks }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(typeof json.error === "string" ? json.error : "Action failed");
        return;
      }
      toast.success(action === "approve" ? "Payout approved" : "Payout rejected — funds released back");
      await fetchData();
    } finally {
      setDeciding(null);
    }
  }

  const visible = useMemo(
    () => (filter === "PENDING" ? rows.filter((r) => r.status === "PENDING_APPROVAL") : rows),
    [rows, filter]
  );

  const pendingCount = rows.filter((r) => r.status === "PENDING_APPROVAL").length;

  const reportRows = visible.map((r) => ({
    id: r.id,
    maker: r.user.name,
    beneficiary: r.beneficiaryName,
    account: `****${r.accountLast4}`,
    mode: r.mode,
    amount: r.amount,
    total: r.totalDebit,
    status: STATUS_LABEL[r.status],
    date: new Date(r.createdAt).toLocaleString("en-IN"),
  }));

  const cols: Column<Payout>[] = [
    {
      key: "user",
      header: "Maker",
      render: (r) => (
        <div>
          <div className="font-semibold text-ink-900">{r.user.name}</div>
          <div className="text-xs text-ink-500">{r.user.email}</div>
        </div>
      ),
    },
    {
      key: "beneficiaryName",
      header: "Beneficiary",
      render: (r) => (
        <div>
          <div className="font-semibold text-ink-900">{r.beneficiaryName}</div>
          <div className="font-mono text-xs text-ink-500">****{r.accountLast4} · {r.mode}</div>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (r) => <span className="font-semibold">{formatINR(r.amount)}</span>,
    },
    {
      key: "totalDebit",
      header: "Total debit",
      align: "right",
      render: (r) => <span className="font-semibold">{inr2(r.totalDebit)}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <Badge variant={STATUS_BADGE[r.status]}>{STATUS_LABEL[r.status]}</Badge>,
    },
    {
      key: "actions" as keyof Payout,
      header: "",
      align: "right",
      render: (r) => {
        const busy = deciding === r.id;
        return (
          <div className="flex justify-end gap-1">
            <button
              onClick={() => setDetailId(r.id)}
              className="grid h-8 w-8 place-items-center rounded-lg text-ink-600 hover:bg-ink-100"
              title="View details"
            >
              <Eye className="h-4 w-4" />
            </button>
            {r.status === "PENDING_APPROVAL" && (
              <>
                <button
                  onClick={() => setDecisionTarget({ row: r, action: "approve" })}
                  disabled={busy}
                  className="grid h-8 w-8 place-items-center rounded-lg text-emerald-700 hover:bg-emerald-50 disabled:opacity-30"
                  title="Approve"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => setDecisionTarget({ row: r, action: "reject" })}
                  disabled={busy}
                  className="grid h-8 w-8 place-items-center rounded-lg text-rose-700 hover:bg-rose-50 disabled:opacity-30"
                  title="Reject"
                >
                  <XCircle className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Approvals"
        title="Payout approvals"
        description="Network self-withdrawals now auto-approve (a payout debits the requester's own wallet). This queue only holds any earlier requests still awaiting a decision; funds are released back if you reject."
        actions={
          <>
            <ReportActions
              filename="payout-approvals"
              title="JMP NextGenPay · Payout Approvals"
              subtitle={filter === "PENDING" ? "Pending queue" : "All payouts"}
              columns={[
                { key: "id", header: "Payout ID" },
                { key: "maker", header: "Maker" },
                { key: "beneficiary", header: "Beneficiary" },
                { key: "account", header: "Account" },
                { key: "mode", header: "Mode" },
                { key: "amount", header: "Amount (INR)" },
                { key: "total", header: "Total debit" },
                { key: "status", header: "Status" },
                { key: "date", header: "When" },
              ]}
              rows={reportRows}
            />
            <Button variant="outline" onClick={fetchData} disabled={fetching}>
              <RefreshCw className={`h-4 w-4 ${fetching ? "animate-spin" : ""}`} />
              Refresh
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

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700">
          <ShieldCheck className="h-4 w-4" />
          {pendingCount} pending approval{pendingCount === 1 ? "" : "s"}
        </div>
        <div className="w-44">
          <Select value={filter} onChange={(e) => setFilter(e.target.value as "PENDING" | "ALL")}>
            <option value="PENDING">Pending only</option>
            <option value="ALL">All statuses</option>
          </Select>
        </div>
      </div>

      <DataTable
        title={fetching ? "Loading…" : `${visible.length} payout${visible.length === 1 ? "" : "s"}`}
        columns={cols}
        data={visible}
        loading={fetching}
        empty="Nothing here. The queue is clear."
      />

      {detailId && <DetailDrawer id={detailId} onClose={() => setDetailId(null)} />}

      <ConfirmDialog
        open={decisionTarget !== null}
        onClose={() => setDecisionTarget(null)}
        busy={decisionTarget ? deciding === decisionTarget.row.id : false}
        tone={decisionTarget?.action === "reject" ? "danger" : "default"}
        title={decisionTarget?.action === "reject" ? "Reject this payout?" : "Approve this payout?"}
        description={
          decisionTarget && (
            <>
              {formatINR(decisionTarget.row.amount)} to{" "}
              <span className="font-semibold text-ink-900">{decisionTarget.row.beneficiaryName}</span>
              {decisionTarget.action === "reject"
                ? " — funds will be released back to the maker."
                : " will be released for processing."}
            </>
          )
        }
        confirmLabel={decisionTarget?.action === "reject" ? "Reject" : "Approve"}
        input={{
          label:
            decisionTarget?.action === "reject"
              ? "Reason for rejection (optional)"
              : "Approval remarks (optional)",
          placeholder: "Add a note for the audit trail…",
        }}
        onConfirm={async (remarks) => {
          if (!decisionTarget) return;
          await decide(decisionTarget.row.id, decisionTarget.action, remarks || undefined);
          setDecisionTarget(null);
        }}
      />
    </div>
  );
}

function DetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<PayoutDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/payout/${id}`);
        if (!res.ok) throw new Error("Failed to load");
        const json = await res.json();
        if (active) setDetail(json.payout);
      } catch {
        if (active) setErr("Could not load payout details.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-ink-100 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <h3 className="font-display text-lg font-semibold text-ink-900">Payout details</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="grid flex-1 place-items-center text-ink-500">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : err ? (
          <div className="p-5 text-sm text-rose-700">{err}</div>
        ) : detail ? (
          <div className="space-y-5 p-5">
            <div className="flex items-center justify-between">
              <Badge variant={STATUS_BADGE[detail.status]}>{STATUS_LABEL[detail.status]}</Badge>
              <span className="font-mono text-xs text-ink-500">{detail.bulkpeReferenceId}</span>
            </div>

            <div className="rounded-xl border border-ink-100 bg-ink-50/50 p-4">
              <Field label="Beneficiary" value={detail.beneficiaryName} />
              <Field label="Account" value={detail.maskedAccount} mono />
              {detail.ifsc && <Field label="IFSC" value={detail.ifsc} mono />}
              <Field label="Mode" value={detail.mode} />
            </div>

            <div className="rounded-xl border border-ink-100 p-4">
              <Row label="Amount to beneficiary" value={inr2(detail.amount)} />
              <Row label="Service charge" value={inr2(detail.serviceCharge)} />
              <Row label="GST" value={inr2(detail.gst)} />
              <div className="mt-2 border-t border-ink-100 pt-2">
                <Row label="Total debit" value={inr2(detail.totalDebit)} strong />
              </div>
            </div>

            <div className="rounded-xl border border-ink-100 p-4">
              <Field label="Maker (owner)" value={`${detail.user.name} · ${detail.user.email}`} />
              {detail.checker && <Field label="Checker" value={detail.checker.name} />}
              {detail.utr && <Field label="UTR" value={detail.utr} mono />}
              {detail.bulkpeTxnId && <Field label="BulkPe txn" value={detail.bulkpeTxnId} mono />}
              {detail.failureReason && (
                <Field label="Failure reason" value={detail.failureReason} />
              )}
              {detail.remarks && <Field label="Remarks" value={detail.remarks} />}
              <Field label="Created" value={new Date(detail.createdAt).toLocaleString("en-IN")} />
              {detail.completedAt && (
                <Field label="Completed" value={new Date(detail.completedAt).toLocaleString("en-IN")} />
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="text-ink-500">{label}</span>
      <span className={`text-right text-ink-900 ${mono ? "font-mono text-xs" : "font-medium"}`}>{value}</span>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className={strong ? "font-semibold text-ink-900" : "text-ink-600"}>{label}</span>
      <span className={strong ? "font-display text-base font-bold text-brand-700" : "text-ink-800"}>{value}</span>
    </div>
  );
}
