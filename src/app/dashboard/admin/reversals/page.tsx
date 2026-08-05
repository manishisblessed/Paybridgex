"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatINR, formatNumber } from "@/lib/utils";
import { RefreshCw, Undo2, Search } from "lucide-react";

type Reversal = {
  id: string;
  kind: string;
  refType: string;
  refId: string;
  refLabel: string | null;
  direction: "CREDIT" | "DEBIT";
  walletType: string;
  amount: number;
  reason: string;
  status: string;
  rejectedNote: string | null;
  createdAt: string;
  target: { id: string; name: string; email: string };
  maker: { name: string } | null;
  checker: { name: string } | null;
};

const STATUSES = ["all", "PENDING_APPROVAL", "COMPLETED", "REJECTED", "CANCELLED"];

const inputCls =
  "rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

export default function ReversalDeskPage() {
  const [rows, setRows] = useState<Reversal[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const notify = useCallback((text: string, ok: boolean) => {
    if (ok) toast.success(text);
    else toast.error(text);
  }, []);
  const pageSize = 25;

  // Raise form
  const [lookupRef, setLookupRef] = useState("");
  const [form, setForm] = useState({
    kind: "TRANSACTION",
    refType: "Transaction",
    refId: "",
    refLabel: "",
    targetUserId: "",
    targetLabel: "",
    direction: "CREDIT",
    walletType: "PRIMARY",
    amount: "",
    reason: "",
  });
  const [busy, setBusy] = useState(false);

  // Pending approve/reject/cancel decision awaiting confirmation
  const [decision, setDecision] = useState<{ id: string; action: "APPROVE" | "REJECT" | "CANCEL" } | null>(null);
  const [decideBusy, setDecideBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (status !== "all") params.set("status", status);
      const res = await fetch(`/api/admin/reversals?${params}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Failed to load reversals");
      setRows(d.reversals);
      setTotal(d.total);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Load failed", false);
    } finally {
      setLoading(false);
    }
  }, [page, status, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const lookup = async () => {
    if (!lookupRef.trim()) return;
    try {
      const res = await fetch(`/api/admin/reversals?lookup=${encodeURIComponent(lookupRef.trim())}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Lookup failed");
      const p = d.prefill;
      setForm((f) => ({
        ...f,
        kind: "TRANSACTION",
        refType: p.refType,
        refId: p.refId,
        refLabel: p.refLabel,
        targetUserId: p.targetUserId,
        targetLabel: p.owner ? `${p.owner.name} (${p.owner.email})` : p.targetUserId,
        amount: String(p.amount),
        direction: "CREDIT",
      }));
      notify(`Found ${p.refLabel} — prefilled the refund of ${formatINR(p.amount)}.`, true);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Lookup failed", false);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/reversals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: form.kind,
          refType: form.refType,
          refId: form.refId,
          refLabel: form.refLabel || undefined,
          targetUserId: form.targetUserId,
          direction: form.direction,
          walletType: form.walletType,
          amount: Number(form.amount),
          reason: form.reason,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(typeof d?.error === "string" ? d.error : "Failed to raise reversal");
      notify("Reversal executed and posted to the ledger.", true);
      setForm((f) => ({ ...f, refId: "", refLabel: "", targetUserId: "", targetLabel: "", amount: "", reason: "" }));
      setLookupRef("");
      load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to raise reversal", false);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (id: string, action: "APPROVE" | "REJECT" | "CANCEL", note?: string) => {
    setDecideBusy(true);
    try {
      const res = await fetch(`/api/admin/reversals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(typeof d?.error === "string" ? d.error : "Action failed");
      notify(`Reversal ${d.status.toLowerCase().replace(/_/g, " ")}.`, true);
      load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Action failed", false);
    } finally {
      setDecideBusy(false);
    }
  };

  const columns: Column<Reversal>[] = [
    {
      key: "ref",
      header: "Reference",
      render: (r) => (
        <div>
          <p className="font-medium text-ink-900">{r.refLabel ?? r.refId.slice(0, 12)}</p>
          <p className="text-xs text-ink-400">
            {r.kind.toLowerCase()} · {new Date(r.createdAt).toLocaleString("en-IN")}
          </p>
        </div>
      ),
    },
    {
      key: "target",
      header: "User",
      render: (r) => (
        <div>
          <p className="font-medium text-ink-900">{r.target.name}</p>
          <p className="text-xs text-ink-400">{r.target.email}</p>
        </div>
      ),
    },
    {
      key: "movement",
      header: "Movement",
      render: (r) => (
        <div>
          <span className={`font-semibold ${r.direction === "CREDIT" ? "text-emerald-600" : "text-rose-600"}`}>
            {r.direction === "CREDIT" ? "+" : "−"}
            {formatINR(r.amount)}
          </span>
          <p className="text-xs text-ink-400">{r.walletType.toLowerCase()} wallet</p>
        </div>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      render: (r) => (
        <div className="max-w-[220px]">
          <p className="truncate text-xs text-ink-600" title={r.reason}>{r.reason}</p>
          {r.rejectedNote && <p className="truncate text-xs text-rose-500" title={r.rejectedNote}>{r.rejectedNote}</p>}
        </div>
      ),
    },
    {
      key: "makers",
      header: "Maker / Checker",
      render: (r) => (
        <p className="text-xs text-ink-500">
          {r.maker?.name ?? "—"} / {r.checker?.name ?? "—"}
        </p>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge
          variant={
            r.status === "COMPLETED"
              ? "success"
              : r.status === "PENDING_APPROVAL"
              ? "warning"
              : "danger"
          }
        >
          {r.status.toLowerCase().replace(/_/g, " ")}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (r) =>
        r.status === "PENDING_APPROVAL" ? (
          <div className="flex justify-end gap-1.5">
            <Button size="sm" onClick={() => setDecision({ id: r.id, action: "APPROVE" })}>Approve</Button>
            <Button size="sm" variant="outline" onClick={() => setDecision({ id: r.id, action: "REJECT" })}>Reject</Button>
            <Button size="sm" variant="outline" onClick={() => setDecision({ id: r.id, action: "CANCEL" })}>Cancel</Button>
          </div>
        ) : null,
    },
  ];

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reversal Desk"
        description="Compensating ledger entries against settled transactions and settlements — history is never edited, only reversed."
        actions={
          <Button variant="outline" onClick={load}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        }
      />

      {/* Raise a reversal */}
      <div className="rounded-2xl border border-ink-100 bg-white p-5">
        <p className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink-800">
          <Undo2 className="h-4 w-4 text-brand-600" /> Raise a reversal
        </p>

        <div className="mb-4 flex gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              className={`${inputCls} w-full pl-9`}
              placeholder="Transaction ref (TXN…) — auto-fills the refund"
              value={lookupRef}
              onChange={(e) => setLookupRef(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && lookup()}
            />
          </div>
          <Button variant="outline" onClick={lookup}>Look up</Button>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <label className="text-xs text-ink-500">
            Kind
            <select
              className={`${inputCls} mt-1 w-full`}
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
            >
              <option value="TRANSACTION">Transaction</option>
              <option value="SETTLEMENT">Settlement</option>
              <option value="AEPS">AEPS</option>
              <option value="WALLET_ENTRY">Wallet entry</option>
            </select>
          </label>
          <label className="text-xs text-ink-500">
            Direction (user&apos;s view)
            <select
              className={`${inputCls} mt-1 w-full`}
              value={form.direction}
              onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value }))}
            >
              <option value="CREDIT">CREDIT — return money</option>
              <option value="DEBIT">DEBIT — claw back</option>
            </select>
          </label>
          <label className="text-xs text-ink-500">
            Wallet
            <select
              className={`${inputCls} mt-1 w-full`}
              value={form.walletType}
              onChange={(e) => setForm((f) => ({ ...f, walletType: e.target.value }))}
            >
              <option value="PRIMARY">Primary</option>
              <option value="AEPS">AEPS</option>
            </select>
          </label>
          <label className="text-xs text-ink-500">
            Amount ₹
            <input
              type="number"
              className={`${inputCls} mt-1 w-full`}
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </label>
        </div>

        {form.targetLabel && (
          <p className="mt-3 text-sm text-ink-600">
            Target: <span className="font-semibold">{form.targetLabel}</span> · ref{" "}
            <span className="font-mono text-xs">{form.refLabel || form.refId}</span>
          </p>
        )}

        <label className="mt-3 block text-xs text-ink-500">
          Reason (mandatory, min 5 chars)
          <input
            className={`${inputCls} mt-1 w-full`}
            value={form.reason}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            placeholder="e.g. Customer charged twice — refunding duplicate debit"
          />
        </label>

        <div className="mt-4">
          <Button
            onClick={submit}
            disabled={busy || !form.refId || !form.targetUserId || !form.amount || form.reason.trim().length < 5}
            isLoading={busy}
          >
            Raise reversal
          </Button>
        </div>
      </div>

      {/* Filter + table */}
      <div className="flex items-center gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => {
              setStatus(s);
              setPage(1);
            }}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              status === s ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-600 hover:bg-ink-200"
            }`}
          >
            {s === "all" ? "All" : s.toLowerCase().replace(/_/g, " ")}
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
      />

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-500">
          <span>
            Page {page} of {pages} · {formatNumber(total)} reversals
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={decision !== null}
        onClose={() => setDecision(null)}
        busy={decideBusy}
        tone={decision?.action === "APPROVE" ? "default" : "danger"}
        title={
          decision?.action === "APPROVE"
            ? "Approve this reversal?"
            : decision?.action === "REJECT"
            ? "Reject this reversal?"
            : "Cancel this reversal?"
        }
        description={
          decision?.action === "APPROVE"
            ? "The reversal will be executed and posted to the ledger."
            : decision?.action === "REJECT"
            ? "The reversal will be rejected and no ledger entry will be made."
            : "The pending reversal will be withdrawn without posting anything."
        }
        confirmLabel={
          decision?.action === "APPROVE" ? "Approve" : decision?.action === "REJECT" ? "Reject" : "Cancel reversal"
        }
        cancelLabel="Back"
        input={
          decision?.action === "REJECT"
            ? { label: "Rejection note (optional)", placeholder: "Why is this being rejected?" }
            : undefined
        }
        onConfirm={async (note) => {
          if (!decision) return;
          await decide(decision.id, decision.action, decision.action === "REJECT" ? note || undefined : undefined);
          setDecision(null);
        }}
      />
    </div>
  );
}
