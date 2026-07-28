"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatINR } from "@/lib/utils";
import { CreditCard, RefreshCw, Clock, PlayCircle, DownloadCloud, Zap, Save } from "lucide-react";

type PosT1 = { enabled: boolean; hour: number; paused: boolean; minAmount: number };
type PosInstant = { defaultEnabled: boolean; paused: boolean };
type PosIngest = { enabled: boolean; paused: boolean; lookbackDays: number; maxPages: number };
type InstantButton = { posEnabled: boolean; qrEnabled: boolean };

type Entry = {
  id: string;
  transactionRef: string;
  user: { id: string; name: string; role: string };
  grossAmount: number;
  mdrAmount: number;
  netAmount: number;
  mode: string;
  status: string;
  paymentMode: string | null;
  settledAt: string | null;
  createdAt: string;
};

type SummaryRow = { status: string; count: number; totalNet: number };

type ApiData = {
  config: { posInstant: PosInstant; posT1: PosT1; posIngest: PosIngest; instantButton: InstantButton };
  summary: SummaryRow[];
  entries: Entry[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

const inputCls =
  "rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

function statusVariant(s: string): "success" | "warning" | "danger" | "default" {
  if (s === "SETTLED") return "success";
  if (s === "PENDING") return "warning";
  if (s === "FAILED") return "danger";
  return "default";
}

function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-ink-100 bg-white px-4 py-3">
      <div>
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-ink-800">{label}</p>
          <Badge variant={checked ? "success" : "default"}>{checked ? "ON" : "OFF"}</Badge>
        </div>
        <p className="mt-0.5 text-[11px] text-ink-400">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? "bg-brand-600" : "bg-ink-200"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

export default function PosSettlementPage() {
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [t1, setT1] = useState<PosT1>({ enabled: true, hour: 10, paused: false, minAmount: 50 });
  const [ingest, setIngest] = useState<PosIngest>({ enabled: true, paused: false, lookbackDays: 3, maxPages: 50 });
  const [instantButton, setInstantButton] = useState<InstantButton>({ posEnabled: false, qrEnabled: false });
  const [savingT1, setSavingT1] = useState(false);
  const [savingIngest, setSavingIngest] = useState(false);
  const [savingButton, setSavingButton] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const notify = useCallback((text: string, ok: boolean) => {
    if (ok) toast.success(text);
    else toast.error(text);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/pos-settlement");
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Failed to load");
      setData(d);
      setT1(d.config.posT1);
      setIngest(d.config.posIngest);
      if (d.config.instantButton) setInstantButton(d.config.instantButton);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Load failed", false);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/admin/pos-settlement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(typeof d?.error === "string" ? d.error : "Request failed");
    return d;
  };

  const saveT1 = async () => {
    setSavingT1(true);
    try {
      await post({
        action: "configure",
        key: "settlement.pos_t1",
        value: {
          enabled: t1.enabled,
          hour: Number(t1.hour),
          paused: t1.paused,
          minAmount: Number(t1.minAmount),
        },
      });
      notify(`Settlement time saved — runs ~${hh(Number(t1.hour))}:10 IST.`, true);
      load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Save failed", false);
    } finally {
      setSavingT1(false);
    }
  };

  const saveIngest = async () => {
    setSavingIngest(true);
    try {
      await post({
        action: "configure",
        key: "settlement.pos_ingest",
        value: {
          enabled: ingest.enabled,
          paused: ingest.paused,
          lookbackDays: Number(ingest.lookbackDays),
          maxPages: Number(ingest.maxPages),
        },
      });
      notify("Ingestion settings saved.", true);
      load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Save failed", false);
    } finally {
      setSavingIngest(false);
    }
  };

  const saveButton = async (next: InstantButton) => {
    setSavingButton(true);
    try {
      await post({
        action: "configure",
        key: "settlement.instant_button",
        value: { posEnabled: next.posEnabled, qrEnabled: next.qrEnabled },
      });
      setInstantButton(next);
      notify("Instant settlement button updated.", true);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Save failed", false);
    } finally {
      setSavingButton(false);
    }
  };

  const runAction = async (action: string, label: string, extra?: Record<string, unknown>) => {
    setRunning(action);
    try {
      const d = await post({ action, ...extra });
      const parts: string[] = [];
      if (typeof d.scanned === "number") parts.push(`scanned ${d.scanned}`);
      if (typeof d.queued === "number") parts.push(`queued ${d.queued}`);
      if (typeof d.settled === "number") parts.push(`settled ${d.settled}`);
      if (typeof d.duplicate === "number" && d.duplicate) parts.push(`dup ${d.duplicate}`);
      if (typeof d.noScheme === "number" && d.noScheme) parts.push(`noScheme ${d.noScheme}`);
      if (typeof d.failed === "number" && d.failed) parts.push(`failed ${d.failed}`);
      if (typeof d.totalAmount === "number") parts.push(`₹${d.totalAmount.toFixed(2)}`);
      notify(`${label}: ${parts.length ? parts.join(" · ") : "done"}.`, true);
      load();
    } catch (e) {
      notify(e instanceof Error ? e.message : `${label} failed`, false);
    } finally {
      setRunning(null);
    }
  };

  const runIngest = () => {
    const extra: Record<string, unknown> = {};
    if (from) extra.dateFrom = `${from}T00:00:00.000Z`;
    if (to) extra.dateTo = `${to}T23:59:59.999Z`;
    runAction("run_ingest", "Ingestion", extra);
  };

  const columns: Column<Entry>[] = [
    {
      key: "ref",
      header: "Txn ref",
      render: (e) => (
        <div>
          <span className="font-mono text-xs font-semibold text-ink-800">{e.transactionRef}</span>
          <p className="text-xs text-ink-400">
            {e.user.role} · {e.user.name}
          </p>
        </div>
      ),
    },
    { key: "gross", header: "Gross", render: (e) => formatINR(e.grossAmount) },
    { key: "mdr", header: "MDR", render: (e) => <span className="text-ink-500">{formatINR(e.mdrAmount)}</span> },
    { key: "net", header: "Net", render: (e) => <span className="font-semibold">{formatINR(e.netAmount)}</span> },
    {
      key: "mode",
      header: "Mode",
      render: (e) => <Badge variant={e.mode === "INSTANT" ? "brand" : "default"}>{e.mode}</Badge>,
    },
    { key: "status", header: "Status", render: (e) => <Badge variant={statusVariant(e.status)}>{e.status}</Badge> },
    {
      key: "when",
      header: "Settled / Captured",
      render: (e) => (
        <span className="text-xs text-ink-400">
          {e.settledAt ? new Date(e.settledAt).toLocaleString("en-IN") : new Date(e.createdAt).toLocaleString("en-IN")}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="POS Settlement"
        description="Configure when POS T+1 settlement runs, and trigger ingestion / settlement sweeps on demand. Same Day sends no capture webhooks, so ingestion pulls captured transactions into the queue; the T+1 sweep credits retailers on their capture's next day."
        actions={
          <Button variant="outline" onClick={load}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        }
      />

      {/* Instant settlement — prominent, retailer-controlled control */}
      <div className="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-ink-900">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-600/10">
                <Zap className="h-4 w-4 text-brand-600" />
              </span>
              Instant settlement (retailer-controlled)
            </h3>
            <p className="text-xs text-ink-500">
              When <strong>ON</strong>, retailers see an <strong>&quot;Instant settle&quot;</strong> action and can
              hand-pick individual transactions to settle now at the T0 rate. Anything they don&apos;t pick
              auto-settles on the next-day T+1 sweep. When <strong>OFF</strong>, every transaction simply settles T+1.
            </p>
          </div>
          {savingButton && (
            <span className="flex items-center gap-1.5 text-xs text-ink-400">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Saving…
            </span>
          )}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <ToggleRow
            label="POS instant settle"
            hint="Retailers can instant-settle selected POS captures"
            checked={instantButton.posEnabled}
            disabled={savingButton}
            onChange={(v) => saveButton({ ...instantButton, posEnabled: v })}
          />
          <ToggleRow
            label="QR instant settle"
            hint="Retailers can instant-settle approved QR claims"
            checked={instantButton.qrEnabled}
            disabled={savingButton}
            onChange={(v) => saveButton({ ...instantButton, qrEnabled: v })}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* T+1 time config */}
        <div className="rounded-2xl border border-ink-100 bg-white p-5">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-ink-900">
            <Clock className="h-4 w-4 text-brand-600" /> T+1 settlement time
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-ink-500">
              Run at (IST hour)
              <select
                className={`${inputCls} mt-1 w-full`}
                value={t1.hour}
                onChange={(e) => setT1((s) => ({ ...s, hour: Number(e.target.value) }))}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hh(h)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-ink-500">
              Min amount (₹)
              <input
                type="number"
                className={`${inputCls} mt-1 w-full`}
                value={t1.minAmount}
                onChange={(e) => setT1((s) => ({ ...s, minAmount: Number(e.target.value) }))}
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={t1.enabled}
                onChange={(e) => setT1((s) => ({ ...s, enabled: e.target.checked }))}
              />
              Enabled
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={t1.paused}
                onChange={(e) => setT1((s) => ({ ...s, paused: e.target.checked }))}
              />
              Paused
            </label>
          </div>
          <p className="mt-3 text-[11px] text-ink-400">
            The worker checks hourly and fires the sweep in the selected hour (~{hh(Number(t1.hour))}:10 IST). Only
            captures from previous IST days settle.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <Button size="sm" onClick={saveT1} isLoading={savingT1} disabled={savingT1}>
              <Save className="mr-2 h-4 w-4" /> Save time
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => runAction("run_t1_sweep", "T+1 sweep")}
              isLoading={running === "run_t1_sweep"}
              disabled={running !== null}
            >
              <PlayCircle className="mr-2 h-4 w-4" /> Run T+1 sweep now
            </Button>
          </div>
        </div>

        {/* Ingestion config + run */}
        <div className="rounded-2xl border border-ink-100 bg-white p-5">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-ink-900">
            <DownloadCloud className="h-4 w-4 text-brand-600" /> Capture ingestion
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-ink-500">
              Lookback (days)
              <input
                type="number"
                className={`${inputCls} mt-1 w-full`}
                value={ingest.lookbackDays}
                onChange={(e) => setIngest((s) => ({ ...s, lookbackDays: Number(e.target.value) }))}
              />
            </label>
            <label className="text-xs text-ink-500">
              Max pages / run
              <input
                type="number"
                className={`${inputCls} mt-1 w-full`}
                value={ingest.maxPages}
                onChange={(e) => setIngest((s) => ({ ...s, maxPages: Number(e.target.value) }))}
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={ingest.enabled}
                onChange={(e) => setIngest((s) => ({ ...s, enabled: e.target.checked }))}
              />
              Enabled
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={ingest.paused}
                onChange={(e) => setIngest((s) => ({ ...s, paused: e.target.checked }))}
              />
              Paused
            </label>
            <Button size="sm" variant="outline" onClick={saveIngest} isLoading={savingIngest} disabled={savingIngest}>
              <Save className="mr-2 h-4 w-4" /> Save
            </Button>
          </div>

          <div className="mt-4 rounded-xl bg-ink-50/60 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">Backfill / run now</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-ink-500">
                From (optional)
                <input type="date" className={`${inputCls} mt-1 w-full`} value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="text-xs text-ink-500">
                To (optional)
                <input type="date" className={`${inputCls} mt-1 w-full`} value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={runIngest} isLoading={running === "run_ingest"} disabled={running !== null}>
                <DownloadCloud className="mr-2 h-4 w-4" /> Run ingestion now
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => runAction("run_instant_sweep", "Instant sweep")}
                isLoading={running === "run_instant_sweep"}
                disabled={running !== null}
              >
                <Zap className="mr-2 h-4 w-4" /> Instant safety-net
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-ink-400">Leave dates empty to use the configured lookback window.</p>
          </div>
        </div>
      </div>

      {/* Summary */}
      {data && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {["PENDING", "SETTLED", "FAILED"].map((st) => {
            const row = data.summary.find((s) => s.status === st);
            return (
              <div key={st} className="rounded-2xl border border-ink-100 bg-white p-4">
                <div className="flex items-center justify-between">
                  <Badge variant={statusVariant(st)}>{st}</Badge>
                  <CreditCard className="h-4 w-4 text-ink-300" />
                </div>
                <p className="mt-2 text-2xl font-bold text-ink-900">{row?.count ?? 0}</p>
                <p className="text-xs text-ink-400">net {formatINR(row?.totalNet ?? 0)}</p>
              </div>
            );
          })}
          <div className="rounded-2xl border border-ink-100 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Total entries</p>
            <p className="mt-2 text-2xl font-bold text-ink-900">{data.pagination.total}</p>
          </div>
        </div>
      )}

      {/* Recent entries */}
      <div className="rounded-2xl border border-ink-100 bg-white p-5">
        <h3 className="mb-4 text-sm font-bold text-ink-900">Recent settlement entries</h3>
        <DataTable columns={columns} data={data?.entries ?? []} loading={loading} />
      </div>
    </div>
  );
}
