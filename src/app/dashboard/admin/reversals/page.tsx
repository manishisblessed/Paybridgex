"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Panel, SectionTitle, StatusPill, SegmentedNav } from "@/components/dashboard/ui";
import { Reveal } from "@/components/motion";
import { formatINR, formatNumber, formatIST } from "@/lib/utils";
import { RefreshCw, Search, AlertTriangle, ShieldAlert, Clock, CircleDollarSign } from "lucide-react";

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

type Anomaly = {
  id: string;
  type:
    | "FAILED_NO_REVERSAL"
    | "SUCCESS_NO_PROVIDER"
    | "DUPLICATE_PROVIDER_REF"
    | "STUCK_NON_TERMINAL";
  txnId: string;
  refId: string;
  amount: number;
  fee: number;
  service: string;
  status: string;
  partner: string | null;
  detectedAt: string;
  ageMinutes: number;
  user: { name: string; email: string; userCode: string | null } | null;
};

const ANOMALY_LABELS: Record<Anomaly["type"], { label: string; tone: "danger" | "warning"; icon: typeof AlertTriangle }> = {
  FAILED_NO_REVERSAL: { label: "Failed — not refunded", tone: "danger", icon: CircleDollarSign },
  SUCCESS_NO_PROVIDER: { label: "Success — no provider record", tone: "danger", icon: ShieldAlert },
  DUPLICATE_PROVIDER_REF: { label: "Duplicate charge — same provider ref", tone: "danger", icon: ShieldAlert },
  STUCK_NON_TERMINAL: { label: "Stuck in processing", tone: "warning", icon: Clock },
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
  const [reconBusy, setReconBusy] = useState(false);
  const [resolveBusy, setResolveBusy] = useState(false);
  // When the provider can't confirm from stored refs, prompt for the pay-step ref.
  const [resolveNeedRef, setResolveNeedRef] = useState<string | null>(null);

  // Auto-detected anomalies
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [anomalyTotal, setAnomalyTotal] = useState(0);
  const [anomalyExposure, setAnomalyExposure] = useState(0);
  const [anomalyLoading, setAnomalyLoading] = useState(true);

  // Pending approve/reject/cancel decision awaiting confirmation
  const [decision, setDecision] = useState<{ id: string; action: "APPROVE" | "REJECT" | "CANCEL" } | null>(null);
  const [decideBusy, setDecideBusy] = useState(false);

  // One-click anomaly refund — confirmation + busy state
  const [refundTarget, setRefundTarget] = useState<Anomaly | null>(null);
  const [refundBusy, setRefundBusy] = useState(false);

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

  const loadAnomalies = useCallback(async () => {
    setAnomalyLoading(true);
    try {
      const res = await fetch("/api/admin/transactions/anomalies");
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Failed to load anomalies");
      setAnomalies(d.items ?? []);
      setAnomalyTotal(d.total ?? 0);
      setAnomalyExposure(d.exposure ?? 0);
    } catch {
      // silent — anomaly panel is supplementary
    } finally {
      setAnomalyLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadAnomalies();
  }, [load, loadAnomalies]);

  // Auto-refresh anomalies every 5 minutes
  useEffect(() => {
    const interval = setInterval(loadAnomalies, 5 * 60_000);
    return () => clearInterval(interval);
  }, [loadAnomalies]);

  const handleAnomalyAction = (anomaly: Anomaly, action: "lookup" | "reconcile" | "resolve") => {
    setLookupRef(anomaly.refId);
    if (action === "lookup") {
      // Trigger lookup with the correct refId
      setTimeout(async () => {
        try {
          const res = await fetch(`/api/admin/reversals?lookup=${encodeURIComponent(anomaly.refId)}`);
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
            reason: ANOMALY_LABELS[anomaly.type].label + " — auto-detected by anomaly sweep",
          }));
          notify(`Found ${p.refLabel} — prefilled the refund of ${formatINR(p.amount)}.`, true);
        } catch (e) {
          notify(e instanceof Error ? e.message : "Lookup failed", false);
        }
      }, 0);
    } else if (action === "reconcile") {
      setTimeout(() => reconcile(), 0);
    } else if (action === "resolve") {
      setTimeout(() => resolveTxn(), 0);
    }
  };

  // One-click refund for a money-loss anomaly: look up the transaction, then
  // execute the reversal in a single flow (no manual form step). The reversal
  // service already blocks a duplicate refund (ALREADY_REVERSED), so this is
  // safe even if clicked twice or if another admin already acted.
  const refundAnomaly = async (anomaly: Anomaly) => {
    setRefundBusy(true);
    try {
      // 1. Resolve the transaction's owner + refundable amount (amount + fee).
      const lookupRes = await fetch(
        `/api/admin/reversals?lookup=${encodeURIComponent(anomaly.refId)}`
      );
      const lookupData = await lookupRes.json();
      if (!lookupRes.ok) throw new Error(lookupData?.error ?? "Could not find the transaction");
      const p = lookupData.prefill;

      // 2. Execute the reversal (credit the retailer's wallet back).
      const res = await fetch("/api/admin/reversals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "TRANSACTION",
          refType: p.refType,
          refId: p.refId,
          refLabel: p.refLabel,
          targetUserId: p.targetUserId,
          direction: "CREDIT",
          walletType: "PRIMARY",
          amount: Number(p.amount),
          reason: `${ANOMALY_LABELS[anomaly.type].label} — auto-detected, refunded from Reversal Desk`,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        throw new Error(typeof d?.error === "string" ? d.error : "Refund failed");
      }
      notify(
        `${anomaly.refId}: ${formatINR(Number(p.amount))} refunded to ${
          p.owner?.name ?? "the retailer"
        }'s wallet.`,
        true
      );
      setRefundTarget(null);
      load();
      loadAnomalies();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Refund failed", false);
    } finally {
      setRefundBusy(false);
    }
  };

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

  // Safe-first resolution for a stuck PROCESSING payment: re-poll the provider
  // and settle/auto-refund via the shared finalizer BEFORE anyone raises a
  // blind manual reversal (which could double-refund a card that was charged).
  const reconcile = async () => {
    const ref = lookupRef.trim();
    if (!ref) return;
    setReconBusy(true);
    try {
      const res = await fetch("/api/admin/transactions/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refId: ref }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(typeof d?.error === "string" ? d.error : "Reconcile failed");
      const label = d.refId ?? ref;
      switch (d.outcome) {
        case "settled":
          notify(`${label}: provider confirmed SUCCESS — transaction settled.`, true);
          break;
        case "refunded":
          notify(`${label}: provider reported failure — reserve auto-refunded to the wallet.`, true);
          break;
        case "pending":
          notify(`${label}: provider still shows PENDING — will retry automatically.`, true);
          break;
        default:
          notify(
            d.alreadyTerminal
              ? `${label} is already ${String(d.status ?? "finalized").toLowerCase()} — nothing to reconcile.`
              : `${label}: couldn't reach the provider (${d.rail ?? "unsupported"} rail). Try again shortly.`,
            d.alreadyTerminal ? true : false
          );
      }
      load();
      loadAnomalies();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Reconcile failed", false);
    } finally {
      setReconBusy(false);
    }
  };

  // CORRECTIVE resolve — can also promote an already-FAILED/REFUNDED row to
  // SUCCESS (with a lien clawback) when the provider confirms the money moved.
  // Always provider-verified; never a blind manual flip. On a 422 (provider
  // couldn't resolve from stored refs) it prompts for the pay-step reference.
  const resolveTxn = async (providerRef?: string): Promise<boolean> => {
    const ref = (resolveNeedRef ?? lookupRef).trim();
    if (!ref) return false;
    setResolveBusy(true);
    try {
      const res = await fetch("/api/admin/transactions/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refId: ref, ...(providerRef ? { providerRef } : {}) }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 422 || d?.outcome === "unresolved") {
        toast.info(`${ref}: provider couldn't confirm — enter the pay-step reference from the panel.`);
        setResolveNeedRef(ref);
        return false;
      }
      if (!res.ok) throw new Error(typeof d?.error === "string" ? d.error : "Resolve failed");
      switch (d.outcome) {
        case "corrected":
          notify(
            d.clawback?.placed
              ? `${ref}: confirmed SUCCESS — ${formatINR(d.clawback.refunded)} clawed back via lien.`
              : `${ref}: confirmed SUCCESS and settled.`,
            true
          );
          break;
        case "settled":
          notify(`${ref}: provider confirmed SUCCESS — settled.`, true);
          break;
        case "refunded":
          notify(`${ref}: provider reported failure — reserve refunded to the wallet.`, true);
          break;
        case "noop":
          notify(`${ref}: already consistent with the provider (${d.providerStatus ?? "—"}).`, true);
          break;
        default:
          notify(`${ref}: ${d.outcome ?? "no change"}.`, true);
      }
      load();
      loadAnomalies();
      return true;
    } catch (e) {
      notify(e instanceof Error ? e.message : "Resolve failed", false);
      return false;
    } finally {
      setResolveBusy(false);
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
      loadAnomalies();
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
            {r.kind.toLowerCase()} · {formatIST(r.createdAt)}
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
        <StatusPill
          status={r.status}
          tone={
            r.status === "COMPLETED"
              ? "success"
              : r.status === "PENDING_APPROVAL"
              ? "warning"
              : "danger"
          }
        >
          {r.status.toLowerCase().replace(/_/g, " ")}
        </StatusPill>
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
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          title="Reversal Desk"
          description="Compensating ledger entries against settled transactions and settlements — history is never edited, only reversed."
          actions={
            <Button variant="outline" onClick={load}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
          }
        />
      </Reveal>

      {/* Auto-detected Issues */}
      {anomalyTotal > 0 && (
        <Reveal distance={16} duration={0.45}>
          <Panel>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-rose-100 text-rose-600">
                  <AlertTriangle className="h-4 w-4" />
                </span>
                <div>
                  <SectionTitle title="Auto-detected Issues" />
                  <p className="text-xs text-ink-500">
                    {anomalyTotal} issue{anomalyTotal !== 1 ? "s" : ""} · exposure{" "}
                    <span className="font-semibold text-rose-600">{formatINR(anomalyExposure)}</span>
                    {" "}· auto-refreshes every 5 min
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={loadAnomalies}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
              </Button>
            </div>

            <div className="mt-4 space-y-2">
              {anomalyLoading ? (
                <p className="py-6 text-center text-sm text-ink-400">Checking for anomalies…</p>
              ) : (
                anomalies.map((a) => {
                  const config = ANOMALY_LABELS[a.type];
                  const Icon = config.icon;
                  const ageLabel =
                    a.ageMinutes < 60
                      ? `${a.ageMinutes}m ago`
                      : a.ageMinutes < 1440
                        ? `${Math.floor(a.ageMinutes / 60)}h ${a.ageMinutes % 60}m ago`
                        : `${Math.floor(a.ageMinutes / 1440)}d ${Math.floor((a.ageMinutes % 1440) / 60)}h ago`;
                  return (
                    <div
                      key={a.id}
                      className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                        config.tone === "danger"
                          ? "border-rose-200 bg-rose-50/60"
                          : "border-amber-200 bg-amber-50/60"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`grid h-8 w-8 place-items-center rounded-lg ${
                            config.tone === "danger"
                              ? "bg-rose-100 text-rose-600"
                              : "bg-amber-100 text-amber-600"
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-medium text-ink-800">
                              {a.refId}
                            </span>
                            <StatusPill
                              status={config.label}
                              tone={config.tone === "danger" ? "danger" : "warning"}
                            >
                              {config.label}
                            </StatusPill>
                          </div>
                          <p className="mt-0.5 text-xs text-ink-500">
                            {a.user?.name ?? "—"}
                            {a.user?.userCode ? ` (${a.user.userCode})` : ""} ·{" "}
                            {a.service.replace(/_/g, " ").toLowerCase()} · {formatINR(a.amount)}
                            {a.fee > 0 ? ` + ${formatINR(a.fee)} fee` : ""} ·{" "}
                            <span className="text-ink-400">{ageLabel}</span>
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        {a.type === "STUCK_NON_TERMINAL" ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleAnomalyAction(a, "reconcile")}
                            >
                              Reconcile
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleAnomalyAction(a, "resolve")}
                            >
                              Resolve
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleAnomalyAction(a, "lookup")}
                              title="Prefill the reversal form to review before refunding"
                            >
                              Review
                            </Button>
                            <Button size="sm" onClick={() => setRefundTarget(a)}>
                              Refund
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Panel>
        </Reveal>
      )}

      {/* Raise a reversal */}
      <Reveal distance={16} duration={0.45}>
      <Panel>
        <SectionTitle title="Raise a reversal" />

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
          <Button variant="outline" onClick={reconcile} isLoading={reconBusy} disabled={reconBusy || !lookupRef.trim()}>
            Reconcile with provider
          </Button>
          <Button
            variant="outline"
            onClick={() => resolveTxn()}
            isLoading={resolveBusy}
            disabled={resolveBusy || !lookupRef.trim()}
          >
            Resolve / verify with provider
          </Button>
        </div>
        <p className="mb-4 -mt-2 text-xs text-ink-500">
          For a payment stuck in <span className="font-medium">Processing</span> (BBPS / credit-card), try{" "}
          <span className="font-medium">Reconcile with provider</span> first — it re-polls the provider and
          settles or auto-refunds safely, so you only raise a manual reversal if that can&apos;t resolve it.{" "}
          <span className="font-medium">Resolve / verify with provider</span> also corrects a row that was wrongly
          marked FAILED/refunded — if the provider confirms the money moved, it settles and claws back the refund via a
          lien (never a negative wallet).
        </p>

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
      </Panel>
      </Reveal>

      {/* Filter + table */}
      <SegmentedNav
        tabs={STATUSES.map((s) => ({
          key: s,
          label: s === "all" ? "All" : s.toLowerCase().replace(/_/g, " "),
        }))}
        active={status}
        onChange={(s) => {
          setStatus(s);
          setPage(1);
        }}
      />

      <Reveal distance={16} duration={0.45}>
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
        />
      </Reveal>

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

      <ConfirmDialog
        open={resolveNeedRef !== null}
        onClose={() => setResolveNeedRef(null)}
        busy={resolveBusy}
        tone="default"
        title="Enter the pay-step reference"
        description={
          <>
            The provider couldn&apos;t confirm <span className="font-mono text-xs">{resolveNeedRef}</span> from any stored
            reference. Open it in the provider panel, copy its pay-step order_id / request_id, and paste it below to
            verify and resolve.
          </>
        }
        confirmLabel="Verify with this ref"
        cancelLabel="Cancel"
        input={{ label: "Pay-step order_id / request_id", placeholder: "P2N_PAY_… or SDS…", required: true }}
        onConfirm={async (providerRef) => {
          if (providerRef) {
            const done = await resolveTxn(providerRef);
            if (done) setResolveNeedRef(null);
          }
        }}
      />

      <ConfirmDialog
        open={refundTarget !== null}
        onClose={() => setRefundTarget(null)}
        busy={refundBusy}
        tone="default"
        title="Refund this transaction?"
        description={
          refundTarget ? (
            <>
              This will credit{" "}
              <span className="font-semibold">
                {formatINR(refundTarget.amount + refundTarget.fee)}
              </span>{" "}
              (amount + fee) back to{" "}
              <span className="font-semibold">{refundTarget.user?.name ?? "the retailer"}</span>
              &apos;s wallet and mark{" "}
              <span className="font-mono text-xs">{refundTarget.refId}</span> as REFUNDED. If a
              refund already exists for this transaction, it will be safely blocked — no double
              refund.
            </>
          ) : null
        }
        confirmLabel="Refund now"
        cancelLabel="Cancel"
        onConfirm={async () => {
          if (refundTarget) await refundAnomaly(refundTarget);
        }}
      />
    </div>
  );
}
