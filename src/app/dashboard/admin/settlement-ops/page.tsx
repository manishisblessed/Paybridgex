"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Panel, StatTile, StatusPill, SectionTitle } from "@/components/dashboard/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { formatINR, formatNumber } from "@/lib/utils";
import {
  Timer,
  RefreshCw,
  Play,
  Pause,
  AlertTriangle,
  CheckCircle2,
  Settings2,
  Banknote,
  MinusCircle,
  XCircle,
  Users,
  Wallet,
} from "lucide-react";

type Run = {
  id: string;
  dayKey: string;
  trigger: string;
  status: "SUCCESS" | "SKIPPED" | "FAILED";
  amount: number;
  detail: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string; role: string };
};

type Alert = {
  id: string;
  severity: string;
  title: string;
  detail: unknown;
  createdAt: string;
  user: { name: string; email: string } | null;
};

type Overview = {
  config: { enabled: boolean; hour: number; paused: boolean; minAmount: number };
  today: {
    dayKey: string;
    settledCount: number;
    settledAmount: number;
    skippedCount: number;
    failedCount: number;
    pendingUsers: number;
    pendingAmount: number;
  };
  runs: Run[];
  runTotal: number;
  page: number;
  pageSize: number;
  alerts: Alert[];
};

const inputCls =
  "rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

export default function SettlementOpsPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const notify = useCallback((text: string, ok: boolean) => {
    if (ok) toast.success(text);
    else toast.error(text);
  }, []);
  const [showConfig, setShowConfig] = useState(false);
  const [sweepOpen, setSweepOpen] = useState(false);
  const [cfgForm, setCfgForm] = useState({ enabled: false, hour: "7", minAmount: "100" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/settlement-ops?page=${page}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Failed to load settlement ops");
      setData(d);
      setCfgForm({
        enabled: d.config.enabled,
        hour: String(d.config.hour),
        minAmount: String(d.config.minAmount),
      });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Load failed", false);
    } finally {
      setLoading(false);
    }
  }, [page, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    try {
      const res = await fetch("/api/admin/settlement-ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(typeof d?.error === "string" ? d.error : "Action failed");
      if (body.action === "run_sweep" && d.result) {
        notify(
          `Sweep done — settled ${d.result.settled}, skipped ${d.result.skipped}, failed ${d.result.failed} (₹${formatNumber(d.result.totalAmount)}).`,
          d.result.failed === 0
        );
      } else {
        notify(`${label} done.`, true);
      }
      load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Action failed", false);
    } finally {
      setBusy(null);
    }
  };

  const cfg = data?.config;
  const today = data?.today;

  const columns: Column<Run>[] = [
    {
      key: "user",
      header: "User",
      render: (r) => (
        <div>
          <p className="font-medium text-ink-900">{r.user.name}</p>
          <p className="text-xs text-ink-400">{r.user.email}</p>
        </div>
      ),
    },
    { key: "dayKey", header: "Cycle day", render: (r) => <span>{r.dayKey}</span> },
    {
      key: "trigger",
      header: "Trigger",
      render: (r) => (
        <StatusPill status={r.trigger} tone={r.trigger === "MANUAL" ? "warning" : "neutral"}>
          {r.trigger.toLowerCase()}
        </StatusPill>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <StatusPill
          status={r.status}
          tone={r.status === "SUCCESS" ? "success" : r.status === "FAILED" ? "danger" : "neutral"}
        >
          {r.status.toLowerCase()}
        </StatusPill>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      render: (r) => <span className="font-semibold">{r.amount > 0 ? formatINR(r.amount) : "—"}</span>,
    },
    {
      key: "detail",
      header: "Detail",
      render: (r) => <span className="text-xs text-ink-500">{r.detail ?? "—"}</span>,
    },
    {
      key: "createdAt",
      header: "At",
      render: (r) => (
        <span className="text-xs text-ink-500">{new Date(r.createdAt).toLocaleString("en-IN")}</span>
      ),
    },
  ];

  const pages = data ? Math.max(1, Math.ceil(data.runTotal / data.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
      <PageHeader
        title="Settlement Ops"
        description="T+1 AEPS → primary wallet settlement — engine controls, daily cycle status, run history and alerts."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setShowConfig((s) => !s)}>
              <Settings2 className="mr-2 h-4 w-4" /> Configure
            </Button>
            {cfg?.paused ? (
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() => act({ action: "resume" }, "Resume")}
              >
                <Play className="mr-2 h-4 w-4" /> Resume engine
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() => act({ action: "pause" }, "Pause")}
              >
                <Pause className="mr-2 h-4 w-4" /> Pause engine
              </Button>
            )}
            <Button disabled={busy !== null} onClick={() => setSweepOpen(true)}>
              <Timer className="mr-2 h-4 w-4" />
              {busy === "Run sweep" ? "Running…" : "Run sweep now"}
            </Button>
            <Button variant="outline" onClick={load}>
              <RefreshCw className="mr-2 h-4 w-4" />
            </Button>
          </div>
        }
      />
      </Reveal>

      {cfg && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusPill status={cfg.enabled ? "enabled" : "disabled"}>
            engine {cfg.enabled ? "enabled" : "disabled"}
          </StatusPill>
          {cfg.paused && <StatusPill status="paused" tone="warning" />}
          <span className="text-ink-500">
            Daily at {String(cfg.hour).padStart(2, "0")}:00 IST · minimum {formatINR(cfg.minAmount)}
          </span>
        </div>
      )}

      {showConfig && (
        <Panel className="border-brand-200">
          <SectionTitle title="Engine configuration" className="mb-3" />
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={cfgForm.enabled}
                onChange={(e) => setCfgForm((f) => ({ ...f, enabled: e.target.checked }))}
              />
              Auto-settlement enabled
            </label>
            <label className="text-xs text-ink-500">
              Run hour (IST, 0–23)
              <input
                type="number"
                min={0}
                max={23}
                className={`${inputCls} mt-1 block w-28`}
                value={cfgForm.hour}
                onChange={(e) => setCfgForm((f) => ({ ...f, hour: e.target.value }))}
              />
            </label>
            <label className="text-xs text-ink-500">
              Minimum amount ₹
              <input
                type="number"
                min={0}
                className={`${inputCls} mt-1 block w-36`}
                value={cfgForm.minAmount}
                onChange={(e) => setCfgForm((f) => ({ ...f, minAmount: e.target.value }))}
              />
            </label>
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                act(
                  {
                    action: "configure",
                    enabled: cfgForm.enabled,
                    hour: Number(cfgForm.hour),
                    minAmount: Number(cfgForm.minAmount),
                  },
                  "Configure"
                )
              }
            >
              Save configuration
            </Button>
          </div>
        </Panel>
      )}

      {today && (
        <Stagger stagger={0.05} className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          <StaggerItem distance={14} duration={0.35}>
            <StatTile
              label={`Settled today (${today.dayKey})`}
              countTo={today.settledCount}
              icon={CheckCircle2}
              tone="emerald"
            />
          </StaggerItem>
          <StaggerItem distance={14} duration={0.35}>
            <StatTile
              label="Settled amount"
              countTo={today.settledAmount}
              prefix="₹"
              decimals={2}
              icon={Banknote}
              tone="emerald"
            />
          </StaggerItem>
          <StaggerItem distance={14} duration={0.35}>
            <StatTile label="Skipped" countTo={today.skippedCount} icon={MinusCircle} tone="ink" />
          </StaggerItem>
          <StaggerItem distance={14} duration={0.35}>
            <StatTile
              label="Failed"
              countTo={today.failedCount}
              icon={XCircle}
              tone={today.failedCount > 0 ? "rose" : "ink"}
            />
          </StaggerItem>
          <StaggerItem distance={14} duration={0.35}>
            <StatTile
              label="Users with AEPS balance"
              countTo={today.pendingUsers}
              icon={Users}
              tone="brand"
            />
          </StaggerItem>
          <StaggerItem distance={14} duration={0.35}>
            <StatTile
              label="Unsettled AEPS float"
              countTo={today.pendingAmount}
              prefix="₹"
              decimals={2}
              icon={Wallet}
              tone="dark"
            />
          </StaggerItem>
        </Stagger>
      )}

      {data && data.alerts.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-5 shadow-sm">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-800">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-amber-500 to-amber-600 text-white shadow-soft">
              <AlertTriangle className="h-4 w-4" />
            </span>
            Open alerts ({data.alerts.length})
          </p>
          <ul className="space-y-2">
            {data.alerts.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 rounded-xl border border-ink-100/60 bg-white p-3 shadow-sm">
                <div>
                  <p className="text-sm font-medium text-ink-900">
                    <StatusPill status={a.severity} tone={a.severity === "CRITICAL" ? "danger" : "warning"}>
                      {a.severity.toLowerCase()}
                    </StatusPill>{" "}
                    {a.title}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-400">
                    {a.user ? `${a.user.name} · ` : ""}
                    {new Date(a.createdAt).toLocaleString("en-IN")}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => act({ action: "ack_alert", alertId: a.id }, "Acknowledge")}
                >
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Ack
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Reveal distance={16} duration={0.45}>
        <DataTable
          columns={columns}
          data={data?.runs ?? []}
          loading={loading}
        />
      </Reveal>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-500">
          <span>
            Page {page} of {pages} · {formatNumber(data?.runTotal ?? 0)} runs
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
        open={sweepOpen}
        onClose={() => setSweepOpen(false)}
        busy={busy === "Run sweep"}
        tone="default"
        title="Run the T+1 settlement sweep now?"
        description="All eligible users' AEPS balances will be settled to their primary wallets immediately."
        confirmLabel="Run now"
        onConfirm={async () => {
          await act({ action: "run_sweep" }, "Run sweep");
          setSweepOpen(false);
        }}
      />
    </div>
  );
}
