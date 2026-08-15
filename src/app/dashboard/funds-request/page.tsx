"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Plus,
  Send,
  RefreshCw,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input, Label, Select } from "@/components/ui/Input";
import { ReportActions } from "@/components/dashboard/ReportActions";
import { type Role } from "@/lib/auth";
import { useAuth } from "@/lib/useAuth";
import { formatINR } from "@/lib/utils";

type FundReq = {
  id: string;
  amount: number;
  mode: string;
  utr: string | null;
  bankName: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  remarks: string | null;
  createdAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  requester: { id: string; name: string; email: string; phone: string };
  approver: { id: string; name: string; email: string } | null;
};

const STATUS_BADGE: Record<string, "success" | "danger" | "warning"> = {
  APPROVED: "success",
  REJECTED: "danger",
  PENDING: "warning",
  CANCELLED: "danger",
};

export default function FundsRequestPage() {
  const { session } = useAuth();
  const role: Role = session?.role ?? "retailer";
  const [rows, setRows] = useState<FundReq[]>([]);
  const [fetching, setFetching] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isApprover = role !== "retailer";

  const fetchRequests = useCallback(async () => {
    try {
      setFetching(true);
      setError(null);
      const res = await fetch("/api/fund-request");
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      setRows(json.requests);
    } catch {
      setError("Could not load fund requests.");
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const [deciding, setDeciding] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<FundReq | null>(null);

  async function decide(id: string, action: "approve" | "reject", remarks?: string) {
    setDeciding(id);
    try {
      const res = await fetch(`/api/fund-request/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, remarks: remarks ?? undefined }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error ?? "Action failed");
        return;
      }
      toast.success(
        action === "approve" ? "Fund request approved — wallet credited" : "Fund request rejected"
      );
      await fetchRequests();
    } finally {
      setDeciding(null);
    }
  }

  const reportRows = rows.map((r) => ({
    id: r.id,
    fromName: r.requester.name,
    fromEmail: r.requester.email,
    amount: r.amount,
    mode: r.mode,
    utr: r.utr ?? "—",
    status: r.status,
    date: new Date(r.createdAt).toLocaleString("en-IN"),
  }));

  const cols: Column<FundReq>[] = [
    {
      key: "id",
      header: "Request",
      render: (r) => (
        <span className="font-mono text-xs">{r.id.slice(0, 12)}…</span>
      ),
    },
    {
      key: "requester",
      header: isApprover ? "From" : "Requested by",
      render: (r) => (
        <div>
          <div className="font-semibold text-ink-900">{r.requester.name}</div>
          <div className="text-xs text-ink-500">{r.requester.email}</div>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (r) => (
        <span className="font-semibold">{formatINR(r.amount)}</span>
      ),
    },
    { key: "mode", header: "Mode" },
    {
      key: "utr",
      header: "UTR / Ref",
      render: (r) => (
        <span className="font-mono text-xs">{r.utr ?? "—"}</span>
      ),
    },
    {
      key: "createdAt",
      header: "When",
      render: (r) => (
        <span className="whitespace-nowrap text-xs text-ink-500">
          {new Date(r.createdAt).toLocaleString("en-IN", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge variant={STATUS_BADGE[r.status] ?? "warning"}>
          {r.status}
        </Badge>
      ),
    },
    ...(isApprover
      ? [
          {
            key: "actions" as keyof FundReq,
            header: "",
            align: "right" as const,
            render: (r: FundReq) => {
              if (r.status !== "PENDING") return null;
              const busy = deciding === r.id;
              return (
                <div className="flex justify-end gap-1">
                  <button
                    onClick={() => decide(r.id, "approve")}
                    disabled={busy}
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
                    onClick={() => setRejectTarget(r)}
                    disabled={busy}
                    className="grid h-8 w-8 place-items-center rounded-lg text-rose-700 hover:bg-rose-50 disabled:opacity-30"
                    title="Reject"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                </div>
              );
            },
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isApprover ? "Approvals" : "Wallet"}
        title={
          isApprover ? "Fund requests from your network" : "Request funds"
        }
        description={
          isApprover
            ? "Approve incoming wallet top-up requests with bank reference. Auto-credit on approval."
            : "Submit your bank deposit reference to top up your Paybridgex wallet within minutes."
        }
        actions={
          <>
            <ReportActions
              filename="fund-requests"
              title="Paybridgex · Fund Requests"
              subtitle={isApprover ? "Incoming approvals" : "My requests"}
              columns={[
                { key: "id", header: "Request ID" },
                { key: "fromName", header: "Requested by" },
                { key: "fromEmail", header: "Email" },
                { key: "amount", header: "Amount (INR)" },
                { key: "mode", header: "Mode" },
                { key: "utr", header: "UTR / Reference" },
                { key: "status", header: "Status" },
                { key: "date", header: "When" },
              ]}
              rows={reportRows}
            />
            <Button
              variant="outline"
              onClick={fetchRequests}
              disabled={fetching}
            >
              <RefreshCw
                className={`h-4 w-4 ${fetching ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
            {!isApprover && (
              <Button onClick={() => setShowNew(true)}>
                <Plus className="h-4 w-4" /> New request
              </Button>
            )}
          </>
        }
      />

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {showNew && !isApprover && (
        <NewRequestForm
          onCancel={() => setShowNew(false)}
          onSubmitted={() => {
            setShowNew(false);
            fetchRequests();
          }}
        />
      )}

      <DataTable
        title={`${rows.length} request${rows.length === 1 ? "" : "s"}`}
        columns={cols}
        data={rows}
        loading={fetching}
        empty="No fund requests yet. Click 'New request' to create one."
      />

      <ConfirmDialog
        open={rejectTarget !== null}
        onClose={() => setRejectTarget(null)}
        busy={rejectTarget ? deciding === rejectTarget.id : false}
        title="Reject this fund request?"
        description={
          rejectTarget && (
            <>
              {formatINR(rejectTarget.amount)} requested by{" "}
              <span className="font-semibold text-ink-900">{rejectTarget.requester.name}</span>{" "}
              will be declined. No wallet credit will happen.
            </>
          )
        }
        confirmLabel="Reject"
        input={{ label: "Reason for rejection (optional)", placeholder: "UTR not found, wrong amount…" }}
        onConfirm={async (remarks) => {
          if (!rejectTarget) return;
          await decide(rejectTarget.id, "reject", remarks || undefined);
          setRejectTarget(null);
        }}
      />
    </div>
  );
}

function NewRequestForm({
  onSubmitted,
  onCancel,
}: {
  onSubmitted: () => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState("10000");
  const [mode, setMode] = useState("IMPS");
  const [utr, setUtr] = useState("");
  const [bankName, setBankName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Single-use submit nonce + idempotency key → a captured/cached POST
      // cannot be replayed to raise a duplicate fund request.
      const nonceRes = await fetch("/api/security/nonce");
      if (!nonceRes.ok) throw new Error("Could not start a secure session. Please retry.");
      const { nonce } = (await nonceRes.json()) as { nonce: string };

      const res = await fetch("/api/fund-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          "x-submit-nonce": nonce,
        },
        body: JSON.stringify({
          amount: Number(amount),
          mode,
          utr: utr || undefined,
          bankName: bankName || undefined,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error?.toString() ?? "Failed to create request");
      }
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50/60 to-white p-5"
    >
      <div className="grid gap-4 md:grid-cols-4">
        <div>
          <Label>Amount (₹)</Label>
          <Input
            type="number"
            required
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div>
          <Label>Deposit mode</Label>
          <Select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option>IMPS</option>
            <option>NEFT</option>
            <option>RTGS</option>
            <option>UPI</option>
            <option>Cash Deposit</option>
          </Select>
        </div>
        <div>
          <Label>Bank name (optional)</Label>
          <Input
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="SBI, HDFC…"
          />
        </div>
        <div>
          <Label>UTR / Reference</Label>
          <Input
            value={utr}
            onChange={(e) => setUtr(e.target.value)}
            placeholder="P2A8765 / NEFT123…"
          />
        </div>
      </div>
      {error && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting} isLoading={submitting}>
          <Send className="h-4 w-4" />
          Submit request
        </Button>
      </div>
    </form>
  );
}
