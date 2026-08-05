"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  ArrowRight,
  Download,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  CircleDollarSign,
} from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import { formatINRFull } from "./CumulativeWalletCard";

/**
 * Daily User Report — the ops team's "who moved what today" snapshot.
 *
 * For every network user (Retailer / Distributor / Master Distributor / Super Distributor)
 * shows on the picked IST day:
 *   Opening → Credits → Debits (by service) → Commission (by service) → Closing
 *
 * Each row expands to reveal the per-service breakdown of both debits and
 * commission, plus the credit-reason split. A reconciliation delta column
 * lights red the instant closing ≠ opening + credits − debits — that column
 * is a continuous ledger-integrity canary.
 */

const ROLE_TABS = [
  { key: "ALL",                 label: "All" },
  { key: "RETAILER",            label: "Retailers" },
  { key: "DISTRIBUTOR",         label: "Distributors" },
  { key: "MASTER_DISTRIBUTOR",  label: "Master Dist." },
  { key: "SUPER_DISTRIBUTOR",   label: "Super Dist." },
] as const;

type RoleKey = (typeof ROLE_TABS)[number]["key"];

type ServiceDebitRow = {
  service: string;
  txns: number;
  amount: number;
  fee: number;
  gst: number;
};

type ServiceCommissionRow = {
  service: string;
  gross: number;
  tds: number;
  net: number;
};

type CreditsBreakdown = {
  topup: number;
  commission: number;
  reversal: number;
  parentPush: number;
  posSettle: number;
  adjustment: number;
  fundTransferIn: number;
  other: number;
  total: number;
};

type OtherDebitsBreakdown = {
  payout: number;
  parentPull: number;
  penalty: number;
  fee: number;
  withdraw: number;
  fundTransferOut: number;
  adjustment: number;
  other: number;
  total: number;
};

type DailyRow = {
  userId: string;
  name: string;
  code: string | null;
  email: string | null;
  role: string;
  opening: number;
  credits: CreditsBreakdown;
  debitsByService: ServiceDebitRow[];
  otherDebits: OtherDebitsBreakdown;
  commissionByService: ServiceCommissionRow[];
  totalDebits: number;
  totalCommission: number;
  closing: number;
  reconDelta: number;
};

type ApiResp = {
  date: string;
  dayStart: string;
  dayEnd: string;
  rows: DailyRow[];
  total: number;
  page: number;
  pageSize: number;
  totals: {
    opening: number;
    creditsTotal: number;
    debitsTotal: number;
    commissionNet: number;
    closing: number;
  };
  services: string[];
};

const ACRONYMS = new Set(["AEPS", "DMT", "UPI", "DTH", "PAN", "GST", "IMPS", "NEFT", "RTGS", "POS", "QR", "PG", "BBPS", "ID"]);
function humanize(code: string): string {
  return code
    .split("_")
    .map((w) => (ACRONYMS.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(" ");
}

/* ── date helpers (IST-anchored) ──────────────────────────────────── */

function todayIST(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function shiftIST(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

function prettyDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/* ── main component ───────────────────────────────────────────────── */

export function DailyUserReportCard() {
  const [date, setDate] = useState<string>(() => todayIST());
  const [role, setRole] = useState<RoleKey>("ALL");
  const [service, setService] = useState<string>("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [downloading, setDownloading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setQ(qInput.trim());
      setPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [qInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      p.set("date", date);
      if (role !== "ALL") p.set("role", role);
      if (service) p.set("service", service);
      if (q) p.set("q", q);
      p.set("page", String(page));
      p.set("pageSize", String(pageSize));
      const res = await fetch(`/api/admin/reports/daily?${p.toString()}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j?.error === "string" ? j.error : "Failed to load report");
      }
      const json = (await res.json()) as ApiResp;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load report");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [date, role, service, q, page, pageSize]);

  useEffect(() => { load(); }, [load]);

  // Reset expanded state when the dataset changes underneath.
  useEffect(() => { setExpanded({}); }, [date, role, service, q, page]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const activeServices = data?.services ?? [];

  const downloadCsv = useCallback(async () => {
    if (!data) return;
    setDownloading(true);
    try {
      const p = new URLSearchParams();
      p.set("from", data.date);
      p.set("to", data.date);
      if (role !== "ALL") p.set("status", role);
      if (service) p.set("service", service);
      if (q) p.set("q", q);
      p.set("export", "1");
      const res = await fetch(`/api/reports/daily-user?${p.toString()}`);
      if (!res.ok) throw new Error("Export failed");
      const json = await res.json();
      const rows: Record<string, unknown>[] = json.rows ?? [];
      const cols = ["code", "name", "role", "opening", "creditsTotal", "topup", "commissionEarned", "debitsTotal", "servicesUsed", "closing"];
      const header = ["User ID", "Name", "Role", "Opening", "Credits", "Top-up", "Commission", "Debits", "Services used", "Closing"];
      const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = [header.map(esc).join(",")];
      for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(","));
      const totals = json.totals ?? {};
      if (Object.keys(totals).length) lines.push(cols.map((c) => esc(totals[c] ?? "")).join(","));
      const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `daily-user-report-${data.date}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setDownloading(false);
    }
  }, [data, role, service, q]);

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-3xl border border-white/10 p-5 text-white shadow-[0_25px_80px_-25px_rgba(9,13,37,0.55)]",
        "bg-[radial-gradient(120%_120%_at_100%_100%,#1a2456_0%,#0a1030_45%,#070a1c_100%)]"
      )}
    >
      <div className="pointer-events-none absolute -top-24 left-16 h-56 w-72 rounded-full bg-brand-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 right-0 h-48 w-64 rounded-full bg-emerald-400/10 blur-3xl" />

      {/* ── header ─────────────────────────────────────────────── */}
      <header className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-indigo-400 to-brand-600 text-white shadow-lg shadow-brand-950/30">
            <CalendarClock className="h-5 w-5" strokeWidth={2.2} />
          </span>
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight">
              Daily User Report
            </h2>
            <p className="text-xs text-slate-400">
              Opening → credits → service-wise usage → commission → closing (Primary wallet)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DatePicker value={date} onChange={(d) => { setDate(d); setPage(1); }} />
          <button
            type="button"
            onClick={load}
            className="grid h-8 w-8 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
          <button
            type="button"
            onClick={downloadCsv}
            disabled={downloading || !data}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow-md shadow-emerald-900/30 transition hover:brightness-110 disabled:opacity-60"
          >
            <Download className={cn("h-3.5 w-3.5", downloading && "animate-pulse")} />
            {downloading ? "Preparing…" : "CSV"}
          </button>
          <Link
            href="/dashboard/reports/daily-user"
            className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/[0.08]"
          >
            Full report <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </header>

      {/* ── KPI row ─────────────────────────────────────────────── */}
      <div className="relative mt-4 grid gap-3 grid-cols-2 lg:grid-cols-5">
        <KpiTile label="Opening" value={data?.totals.opening ?? 0} loading={loading} tint="brand" />
        <KpiTile label="Credits" value={data?.totals.creditsTotal ?? 0} loading={loading} tint="emerald" up />
        <KpiTile label="Debits" value={data?.totals.debitsTotal ?? 0} loading={loading} tint="rose" down />
        <KpiTile label="Commission" value={data?.totals.commissionNet ?? 0} loading={loading} tint="amber" />
        <KpiTile label="Closing" value={data?.totals.closing ?? 0} loading={loading} tint="violet" />
      </div>

      {/* ── filter strip ────────────────────────────────────────── */}
      <div className="relative mt-4 flex flex-wrap items-center gap-2">
        <RolePills value={role} onChange={(r) => { setRole(r); setPage(1); }} />
        <ServiceSelect
          value={service}
          onChange={(s) => { setService(s); setPage(1); }}
          options={activeServices}
        />
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search name / ID / shop…"
            className="h-8 w-56 rounded-xl border border-white/10 bg-white/[0.04] pl-8 pr-3 text-xs text-white placeholder:text-slate-500 outline-none transition focus:border-brand-400/60 focus:bg-white/[0.06]"
          />
        </div>
        <span className="ml-auto text-[11px] text-slate-400">
          {loading
            ? "loading…"
            : data
            ? `${formatNumber(data.rows.length)} shown · ${formatNumber(data.total)} total`
            : "—"}
        </span>
      </div>

      {/* ── error banner ────────────────────────────────────────── */}
      {error && (
        <div className="relative mt-3 flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-xs text-rose-100">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── table ───────────────────────────────────────────────── */}
      <div className="relative mt-4 overflow-hidden rounded-2xl border border-white/[0.06] bg-black/25">
        <div className="max-h-[600px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-[#0b1030]/95 backdrop-blur">
              <tr className="text-left text-[11px] font-bold uppercase tracking-widest text-slate-400">
                <th className="w-6 px-3 py-3"></th>
                <th className="px-3 py-3">User</th>
                <th className="px-3 py-3 text-right">Opening</th>
                <th className="px-3 py-3 text-right">Credits</th>
                <th className="px-3 py-3 text-right">Debits</th>
                <th className="px-3 py-3 text-right">Commission</th>
                <th className="px-3 py-3 text-right">Closing</th>
                <th className="px-3 py-3 text-right">Δ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {loading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="animate-pulse">
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j} className="px-3 py-3.5">
                        <div className="h-3 rounded bg-white/10" />
                      </td>
                    ))}
                  </tr>
                ))}

              {!loading && data && data.rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-14 text-center text-xs text-slate-500">
                    No user activity for this filter on {prettyDate(data.date)}.
                  </td>
                </tr>
              )}

              {!loading && data?.rows.map((r) => (
                <RowGroup
                  key={r.userId}
                  row={r}
                  open={!!expanded[r.userId]}
                  onToggle={() => setExpanded((m) => ({ ...m, [r.userId]: !m[r.userId] }))}
                />
              ))}
            </tbody>
            {!loading && data && data.rows.length > 0 && (
              <tfoot>
                <tr className="border-t border-white/10 bg-white/[0.04] font-display font-bold">
                  <td className="px-3 py-3"></td>
                  <td className="px-3 py-3 text-xs text-slate-400">
                    Page total ({formatNumber(data.rows.length)})
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-white">
                    {formatINRFull(data.totals.opening)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-emerald-300">
                    {formatINRFull(data.totals.creditsTotal)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-rose-300">
                    {formatINRFull(data.totals.debitsTotal)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-amber-300">
                    {formatINRFull(data.totals.commissionNet)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-white">
                    {formatINRFull(data.totals.closing)}
                  </td>
                  <td className="px-3 py-3 text-right"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── pagination ──────────────────────────────────────────── */}
      {data && data.total > pageSize && (
        <div className="relative mt-3 flex items-center justify-between text-xs text-slate-400">
          <span>Page {data.page} of {totalPages}</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={data.page <= 1}
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-slate-200 transition hover:bg-white/[0.08] disabled:opacity-40"
            >
              <ChevronLeft className="h-3 w-3" /> Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={data.page >= totalPages}
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-slate-200 transition hover:bg-white/[0.08] disabled:opacity-40"
            >
              Next <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      <p className="relative mt-3 text-[11px] text-slate-500">
        Snapshot for <b className="text-slate-300">{data ? prettyDate(data.date) : "…"}</b> (Asia/Kolkata) ·
        Primary wallet · Reconciles against WalletTxn ledger.
      </p>
    </section>
  );
}

/* ── sub-components ────────────────────────────────────────────────── */

function DatePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const today = todayIST();
  const isToday = value === today;
  return (
    <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1 pl-2">
      <button
        type="button"
        onClick={() => onChange(shiftIST(value, -1))}
        className="grid h-6 w-6 place-items-center rounded-lg text-slate-300 transition hover:bg-white/[0.08]"
        aria-label="Previous day"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <input
        type="date"
        value={value}
        max={today}
        onChange={(e) => onChange(e.target.value || today)}
        className="h-6 border-none bg-transparent text-xs font-semibold text-white outline-none [color-scheme:dark]"
      />
      <button
        type="button"
        disabled={isToday}
        onClick={() => onChange(shiftIST(value, 1))}
        className="grid h-6 w-6 place-items-center rounded-lg text-slate-300 transition hover:bg-white/[0.08] disabled:opacity-40"
        aria-label="Next day"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
      {!isToday && (
        <button
          type="button"
          onClick={() => onChange(today)}
          className="ml-1 rounded-lg bg-brand-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-brand-100 transition hover:bg-brand-500/30"
        >
          Today
        </button>
      )}
    </div>
  );
}

function RolePills({
  value,
  onChange,
}: {
  value: RoleKey;
  onChange: (r: RoleKey) => void;
}) {
  return (
    <div className="flex items-center rounded-xl border border-white/10 bg-white/[0.04] p-1">
      {ROLE_TABS.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={cn(
              "rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition",
              active
                ? "bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md shadow-emerald-900/30"
                : "text-slate-300 hover:text-white"
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function ServiceSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-xl border border-white/10 bg-white/[0.04] px-2 text-xs font-semibold text-white outline-none transition focus:border-brand-400/60 focus:bg-white/[0.06] [color-scheme:dark]"
    >
      <option value="" className="bg-[#0b1030]">All services</option>
      {options.map((s) => (
        <option key={s} value={s} className="bg-[#0b1030]">
          {humanize(s)}
        </option>
      ))}
    </select>
  );
}

function KpiTile({
  label,
  value,
  loading,
  tint,
  up,
  down,
}: {
  label: string;
  value: number;
  loading: boolean;
  tint: "brand" | "emerald" | "rose" | "amber" | "violet";
  up?: boolean;
  down?: boolean;
}) {
  const iconBg: Record<typeof tint, string> = {
    brand: "from-brand-400 to-brand-600 shadow-brand-950/30",
    emerald: "from-emerald-400 to-emerald-600 shadow-emerald-900/30",
    rose: "from-rose-400 to-rose-600 shadow-rose-900/30",
    amber: "from-amber-400 to-orange-500 shadow-orange-900/30",
    violet: "from-violet-400 to-fuchsia-600 shadow-violet-900/30",
  };
  const valueText: Record<typeof tint, string> = {
    brand: "text-white",
    emerald: "text-emerald-200",
    rose: "text-rose-200",
    amber: "text-amber-200",
    violet: "text-violet-100",
  };
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {label}
        </span>
        <span className={cn("grid h-6 w-6 place-items-center rounded-lg bg-gradient-to-br text-white shadow", iconBg[tint])}>
          {up ? <ArrowUpRight className="h-3 w-3" /> :
           down ? <ArrowDownRight className="h-3 w-3" /> :
           <CircleDollarSign className="h-3 w-3" />}
        </span>
      </div>
      <p className={cn("mt-1 font-display text-lg font-bold tabular-nums", valueText[tint], loading && "animate-pulse text-white/30")}>
        {loading ? "₹ ———" : formatINRFull(value)}
      </p>
    </div>
  );
}

function ROLE_LABEL(role: string): string {
  return (
    {
      RETAILER: "Retailer",
      DISTRIBUTOR: "Distributor",
      MASTER_DISTRIBUTOR: "Master Dist.",
      SUPER_DISTRIBUTOR: "Super Dist.",
    } as Record<string, string>
  )[role] ?? role;
}

function ROLE_BADGE(role: string): string {
  return (
    {
      RETAILER: "bg-sky-500/15 text-sky-200 ring-sky-400/30",
      DISTRIBUTOR: "bg-emerald-500/15 text-emerald-200 ring-emerald-400/30",
      MASTER_DISTRIBUTOR: "bg-amber-500/15 text-amber-200 ring-amber-400/30",
      SUPER_DISTRIBUTOR: "bg-violet-500/15 text-violet-200 ring-violet-400/30",
    } as Record<string, string>
  )[role] ?? "bg-slate-500/15 text-slate-200 ring-slate-400/20";
}

function RowGroup({
  row,
  open,
  onToggle,
}: {
  row: DailyRow;
  open: boolean;
  onToggle: () => void;
}) {
  const delta = row.reconDelta;
  const deltaOk = Math.abs(delta) < 0.01;
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer transition hover:bg-white/[0.04]"
      >
        <td className="px-3 py-3 align-top">
          <ChevronDown
            className={cn(
              "h-4 w-4 text-slate-400 transition",
              open && "rotate-180 text-white"
            )}
          />
        </td>
        <td className="px-3 py-3 align-top">
          <div className="flex items-center gap-2">
            <div className="min-w-0">
              <p className="truncate font-semibold uppercase leading-tight tracking-wide text-white">
                {row.name || row.email || "Unnamed"}
              </p>
              <p className="mt-0.5 truncate text-[11px] font-mono uppercase tracking-wider text-rose-300/70">
                {row.code ?? row.userId.slice(0, 10).toUpperCase()}
              </p>
            </div>
            <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest ring-1", ROLE_BADGE(row.role))}>
              {ROLE_LABEL(row.role)}
            </span>
          </div>
        </td>
        <td className="px-3 py-3 text-right align-top tabular-nums text-white">
          {formatINRFull(row.opening)}
        </td>
        <td className="px-3 py-3 text-right align-top tabular-nums text-emerald-300">
          {row.credits.total > 0 ? formatINRFull(row.credits.total) : "—"}
        </td>
        <td className="px-3 py-3 text-right align-top tabular-nums text-rose-300">
          {row.totalDebits > 0 ? formatINRFull(row.totalDebits) : "—"}
        </td>
        <td className="px-3 py-3 text-right align-top tabular-nums text-amber-300">
          {row.totalCommission > 0 ? formatINRFull(row.totalCommission) : "—"}
        </td>
        <td className="px-3 py-3 text-right align-top font-bold tabular-nums text-white">
          {formatINRFull(row.closing)}
        </td>
        <td className="px-3 py-3 text-right align-top">
          <span
            className={cn(
              "inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
              deltaOk
                ? "bg-emerald-500/10 text-emerald-300"
                : "bg-rose-500/20 text-rose-200"
            )}
            title={deltaOk ? "Ledger reconciles" : "Ledger drift — investigate"}
          >
            {deltaOk ? "OK" : formatINRFull(delta)}
          </span>
        </td>
      </tr>
      {open && <ExpandedDrawer row={row} />}
    </>
  );
}

function ExpandedDrawer({ row }: { row: DailyRow }) {
  return (
    <tr className="bg-black/30">
      <td colSpan={8} className="p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <BreakdownBlock
            title="Credits (by reason)"
            tint="emerald"
            rows={creditBreakdownRows(row.credits)}
            totalLabel="Total credits"
            total={row.credits.total}
          />
          <BreakdownBlock
            title="Balance used (by service)"
            tint="rose"
            rows={[
              ...row.debitsByService.map((d) => ({
                label: humanize(d.service),
                // Wallet impact = amount + fee (what was actually debited), so
                // this breakdown ties out to the ledger-driven debit total.
                value: d.amount + d.fee,
                sub: `${d.txns} txn${d.txns === 1 ? "" : "s"}${d.fee > 0 ? ` · incl. fee ${formatINRFull(d.fee)}` : ""}`,
              })),
              ...otherDebitRows(row.otherDebits),
            ]}
            emptyText="No spend today"
            totalLabel="Total debits"
            total={row.totalDebits}
          />
          <BreakdownBlock
            title="Commission earned (by service)"
            tint="amber"
            rows={row.commissionByService.map((c) => ({
              label: humanize(c.service),
              value: c.net,
              sub:
                c.tds > 0
                  ? `Gross ${formatINRFull(c.gross)} · TDS ${formatINRFull(c.tds)}`
                  : `Gross ${formatINRFull(c.gross)}`,
            }))}
            emptyText="No commission today"
            totalLabel="Net commission"
            total={row.totalCommission}
          />
        </div>

        {/* Reconciliation strip */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] text-slate-300">
          <span>
            <b className="text-white">{formatINRFull(row.opening)}</b> opening
            <span className="mx-1 text-slate-500">+</span>
            <b className="text-emerald-300">{formatINRFull(row.credits.total)}</b> credits
            <span className="mx-1 text-slate-500">−</span>
            <b className="text-rose-300">{formatINRFull(row.totalDebits)}</b> debits
            <span className="mx-1 text-slate-500">=</span>
            <b className="text-white">{formatINRFull(row.closing)}</b> closing
          </span>
          <Link
            href={`/dashboard/admin/wallet-ops?user=${row.userId}`}
            className="inline-flex items-center gap-1 font-semibold text-brand-200 transition hover:text-white"
          >
            Open ledger <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </td>
    </tr>
  );
}

function creditBreakdownRows(c: CreditsBreakdown) {
  const rows: { label: string; value: number; sub?: string }[] = [];
  if (c.topup > 0) rows.push({ label: "Wallet top-up", value: c.topup });
  if (c.commission > 0) rows.push({ label: "Commission credit", value: c.commission });
  if (c.reversal > 0) rows.push({ label: "Reversals / refunds", value: c.reversal });
  if (c.parentPush > 0) rows.push({ label: "Push from parent", value: c.parentPush });
  if (c.posSettle > 0) rows.push({ label: "POS settlement", value: c.posSettle });
  if (c.fundTransferIn > 0) rows.push({ label: "Fund transfer in", value: c.fundTransferIn });
  if (c.adjustment > 0) rows.push({ label: "Admin adjustment", value: c.adjustment });
  if (c.other > 0) rows.push({ label: "Other", value: c.other });
  return rows;
}

function otherDebitRows(d: OtherDebitsBreakdown) {
  const rows: { label: string; value: number; sub?: string }[] = [];
  if (d.payout > 0) rows.push({ label: "Payout / bank transfer", value: d.payout });
  if (d.parentPull > 0) rows.push({ label: "Pull by parent", value: d.parentPull });
  if (d.withdraw > 0) rows.push({ label: "Wallet withdraw", value: d.withdraw });
  if (d.fundTransferOut > 0) rows.push({ label: "Fund transfer out", value: d.fundTransferOut });
  if (d.penalty > 0) rows.push({ label: "Penalty", value: d.penalty });
  if (d.fee > 0) rows.push({ label: "Fees", value: d.fee });
  if (d.adjustment > 0) rows.push({ label: "Admin adjustment", value: d.adjustment });
  if (d.other > 0) rows.push({ label: "Other", value: d.other });
  return rows;
}

function BreakdownBlock({
  title,
  tint,
  rows,
  emptyText,
  totalLabel,
  total,
}: {
  title: string;
  tint: "emerald" | "rose" | "amber";
  rows: { label: string; value: number; sub?: string }[];
  emptyText?: string;
  totalLabel: string;
  total: number;
}) {
  const tintClass = {
    emerald: "text-emerald-300",
    rose: "text-rose-300",
    amber: "text-amber-300",
  }[tint];

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
        {title}
      </p>
      <ul className="mt-2 divide-y divide-white/[0.04]">
        {rows.length === 0 ? (
          <li className="py-2 text-[11px] text-slate-500">{emptyText ?? "—"}</li>
        ) : (
          rows.map((r, i) => (
            <li key={`${r.label}-${i}`} className="flex items-start justify-between gap-2 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-[12px] text-slate-200">{r.label}</p>
                {r.sub && (
                  <p className="truncate text-[10px] text-slate-500">{r.sub}</p>
                )}
              </div>
              <span className={cn("shrink-0 font-semibold tabular-nums text-[12px]", tintClass)}>
                {formatINRFull(r.value)}
              </span>
            </li>
          ))
        )}
      </ul>
      <div className="mt-2 flex items-center justify-between border-t border-white/[0.06] pt-2 text-[11px]">
        <span className="text-slate-400">{totalLabel}</span>
        <span className={cn("font-display font-bold tabular-nums", tintClass)}>
          {formatINRFull(total)}
        </span>
      </div>
    </div>
  );
}
