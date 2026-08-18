"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  RefreshCw,
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Info,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { ReportActions } from "@/components/dashboard/ReportActions";
import {
  Panel,
  StatTile,
  FilterBar,
  FilterField,
  TablePro,
  TableEmptyRow,
  TableSkeletonRows,
  StatusPill,
  type StatTone,
  type PillTone,
} from "@/components/dashboard/ui";
import { Button } from "@/components/ui/Button";
import { Input, Select, Label } from "@/components/ui/Input";
import { REPORTS } from "@/lib/reports/registry";
import { brandLogoUrl, brandBadge, brandLocalLogos } from "@/lib/brand/logos";
import type { ReportColumnDef, Accent } from "@/lib/reports/registry";
import type { ReportType, ReportResult } from "@/lib/reports/types";
import type { ReportColumn } from "@/lib/reports";

type Row = Record<string, unknown>;

const ACCENT_TEXT: Record<Accent, string> = {
  brand: "text-brand-700",
  accent: "text-accent-700",
  emerald: "text-emerald-700",
  violet: "text-violet-700",
};
const ACCENT_BG: Record<Accent, string> = {
  brand: "from-brand-500 to-brand-700",
  accent: "from-accent-500 to-accent-700",
  emerald: "from-emerald-500 to-emerald-700",
  violet: "from-violet-500 to-violet-700",
};
const ACCENT_HEX: Record<Accent, string> = {
  brand: "#3164f6",
  accent: "#10b981",
  emerald: "#059669",
  violet: "#7c3aed",
};
const ACCENT_STAT_TONE: Record<Accent, StatTone> = {
  brand: "brand",
  accent: "emerald",
  emerald: "emerald",
  violet: "violet",
};

const ACRONYMS = new Set(["AEPS", "DMT", "UPI", "DTH", "PAN", "GST", "IMPS", "NEFT", "RTGS", "POS", "QR", "PG", "BBPS", "ID"]);
function humanize(code: string): string {
  return String(code)
    .split("_")
    .map((w) => (ACRONYMS.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(" ");
}

function inr2(n: number): string {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function badgeVariant(raw: string): "success" | "warning" | "danger" | "brand" | "accent" | "default" {
  const v = String(raw).toUpperCase().trim();
  if (["SUCCESS", "APPROVED", "CREDIT", "ACTIVE", "SETTLED", "RECEIVED", "COMMISSION", "TOPUP", "REFUNDED"].includes(v)) return "success";
  if (["FAILED", "REJECTED", "REVERSED", "DEBIT", "DECOMMISSIONED", "CANCELLED", "PENALTY"].includes(v)) return "danger";
  if (["PENDING", "PENDING_APPROVAL", "PROCESSING", "INITIATED", "HOLD", "RECONCILING", "MAINTENANCE", "IN BANK", "INACTIVE"].includes(v)) return "warning";
  if (["FUND_TRANSFER_IN", "DRAFT", "TRANSACTION"].includes(v)) return "brand";
  if (["WITHDRAW", "FUND_TRANSFER_OUT", "FEE", "ADJUSTMENT", "PAYOUT"].includes(v)) return "accent";
  return "default";
}

/** StatusPill tone for each badgeVariant (accent is emerald-toned, like success). */
const PILL_TONE: Record<ReturnType<typeof badgeVariant>, PillTone> = {
  success: "success",
  warning: "warning",
  danger: "danger",
  brand: "brand",
  accent: "success",
  default: "neutral",
};

/** Coloured wordmark/monogram tile used when no logo image is available. */
function BrandBadge({ name }: { name: string }) {
  const badge = brandBadge(name);
  const label = badge.label.length > 6 ? badge.label.slice(0, 6) : badge.label;
  return (
    <span
      title={name || undefined}
      style={{ backgroundColor: badge.bg, color: badge.fg }}
      className="mx-auto inline-flex h-7 min-w-[2.5rem] items-center justify-center rounded-md px-1.5 text-[9px] font-bold tracking-wide"
    >
      {label}
    </span>
  );
}

/**
 * Bank / operator logo cell. Resolves an image through a cascade and gracefully
 * degrades on each failure:
 *   self-hosted asset (/banks/<slug>.svg|png)  →  CDN logo  →  coloured monogram
 * When the value is an explicit URL (e.g. a stored Operator.logoUrl) it is used
 * directly, falling back to a neutral placeholder if it fails to load.
 */
function AvatarCell({ value }: { value: string }) {
  const [attempt, setAttempt] = useState(0);
  const s = String(value ?? "").trim();
  if (!s || s === "—") return <span className="text-ink-400">—</span>;

  const isUrl = /^https?:\/\//i.test(s) || s.startsWith("/");
  const sources = isUrl
    ? [s]
    : [...brandLocalLogos(s), brandLogoUrl(s)].filter((u): u is string => !!u);

  if (attempt < sources.length) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={sources[attempt]}
        alt=""
        onError={() => setAttempt((a) => a + 1)}
        className="mx-auto h-7 w-7 rounded-md bg-white object-contain ring-1 ring-ink-100"
      />
    );
  }
  // Everything failed: branded monogram for a name, neutral dash for a bare URL.
  return isUrl ? <span className="text-ink-400">—</span> : <BrandBadge name={s} />;
}

/** Display node for the on-screen table. */
function displayCell(value: unknown, format?: ReportColumnDef["format"]) {
  if (format === "avatar") return <AvatarCell value={String(value ?? "")} />;
  if (value === null || value === undefined || value === "") return <span className="text-ink-400">—</span>;
  switch (format) {
    case "money":
      return typeof value === "number" ? <span className="font-semibold tabular-nums">{inr2(value)}</span> : <span>{String(value)}</span>;
    case "int":
      return typeof value === "number" ? <span className="tabular-nums">{value.toLocaleString("en-IN")}</span> : <span>{String(value)}</span>;
    case "percent":
      return typeof value === "number" ? <span className="tabular-nums">{value.toFixed(1)}%</span> : <span>{String(value)}</span>;
    case "date":
      return <span className="whitespace-nowrap text-ink-600">{toDateStr(value)}</span>;
    case "datetime":
      return <span className="whitespace-nowrap text-ink-600">{toDateTimeStr(value)}</span>;
    case "badge":
      return (
        <StatusPill status={String(value)} tone={PILL_TONE[badgeVariant(String(value))]}>
          {humanize(String(value))}
        </StatusPill>
      );
    case "mono":
      return <span className="font-mono text-xs">{String(value)}</span>;
    default:
      return <span>{String(value)}</span>;
  }
}

function toDateStr(value: unknown): string {
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function toDateTimeStr(value: unknown): string {
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

/** String for CSV/PDF export cells (numeric XLSX cells use the raw value). */
function exportString(value: unknown, format?: ReportColumnDef["format"]): string {
  if (value === null || value === undefined) return "";
  switch (format) {
    case "avatar":
      return "";
    case "money":
      return typeof value === "number" ? inr2(value) : String(value);
    case "percent":
      return typeof value === "number" ? `${value.toFixed(1)}%` : String(value);
    case "date":
      return toDateStr(value);
    case "datetime":
      return toDateTimeStr(value);
    case "badge":
      return humanize(String(value));
    default:
      return String(value);
  }
}

function toColFormat(f?: ReportColumnDef["format"]): ReportColumn<Row>["format"] {
  if (f === "money" || f === "int" || f === "date" || f === "datetime") return f;
  return "text";
}

export function ReportView({ type }: { type: ReportType }) {
  const config = REPORTS[type];
  const f = config.filters;

  const today = useMemo(() => new Date(), []);
  const monthAgo = useMemo(() => new Date(today.getTime() - 30 * 86_400_000), [today]);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);

  const [from, setFrom] = useState(f.dateRange ? ymd(monthAgo) : "");
  const [to, setTo] = useState(f.dateRange ? ymd(today) : "");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [service, setService] = useState("");
  const [mode, setMode] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [data, setData] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce free-text search.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [qInput]);

  const baseQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (f.dateRange) {
      if (from) p.set("from", from);
      if (to) p.set("to", to);
    }
    if (q) p.set("q", q);
    if (status) p.set("status", status);
    if (service) p.set("service", service);
    if (mode) p.set("mode", mode);
    return p;
  }, [f.dateRange, from, to, q, status, service, mode]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = baseQuery();
      p.set("page", String(page));
      p.set("pageSize", String(pageSize));
      const res = await fetch(`/api/reports/${type}?${p.toString()}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : "Failed to load report");
      }
      setData((await res.json()) as ReportResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load report");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [baseQuery, page, pageSize, type]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Full filtered dataset for exports (capped server-side), with a totals row.
  const fetchAllRows = useCallback(async (): Promise<Row[]> => {
    const p = baseQuery();
    p.set("export", "1");
    const res = await fetch(`/api/reports/${type}?${p.toString()}`);
    if (!res.ok) return data?.rows ?? [];
    const json = (await res.json()) as ReportResult;
    const rows = [...json.rows];
    if (json.totals && Object.keys(json.totals).length > 0) rows.push(json.totals as Row);
    return rows;
  }, [baseQuery, type, data]);

  const exportColumns: ReportColumn<Row>[] = useMemo(
    () =>
      config.columns.map((c) => ({
        key: c.key,
        header: c.header,
        format: toColFormat(c.format),
        render: (row: Row) => exportString(row[c.key], c.format),
      })),
    [config.columns]
  );

  const rows = data?.rows ?? [];
  const totals = data?.totals ?? {};
  const hasTotals = Object.keys(totals).length > 0;
  const totalRecords = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const startIdx = totalRecords === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIdx = Math.min(page * pageSize, totalRecords);

  const resetFilters = () => {
    setFrom(f.dateRange ? ymd(monthAgo) : "");
    setTo(f.dateRange ? ymd(today) : "");
    setQInput("");
    setQ("");
    setStatus("");
    setService("");
    setMode("");
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/reports"
        className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800"
      >
        <ArrowLeft className="h-4 w-4" /> Back to reports
      </Link>

      <PageHeader
        eyebrow="Reports"
        title={config.title}
        description={config.description}
        actions={
          <>
            <ReportActions
              filename={`${type}-report`}
              title={`Paybridgex · ${config.title}`}
              subtitle={
                f.dateRange && from && to ? `${toDateStr(from)} – ${toDateStr(to)}` : "All records"
              }
              columns={exportColumns}
              rows={rows}
              fetchRows={fetchAllRows}
            />
            <Button variant="outline" onClick={fetchData} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </>
        }
      />

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(data?.summary ?? []).map((s) => (
          <StatTile
            key={s.label}
            label={s.label}
            tone={ACCENT_STAT_TONE[s.accent ?? config.accent]}
            value={
              <span className={ACCENT_TEXT[s.accent ?? config.accent]}>
                {loading && !data ? "—" : s.value}
              </span>
            }
          />
        ))}
      </div>

      {/* Trend sparkline */}
      {data?.trend && data.trend.values.length > 1 && (
        <Panel>
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-widest text-ink-500">{data.trend.label}</p>
            <span className={`h-2.5 w-2.5 rounded-full bg-gradient-to-br ${ACCENT_BG[config.accent]}`} />
          </div>
          <div className="mt-3">
            <Sparkline values={data.trend.values} color={data.trend.color || ACCENT_HEX[config.accent]} height={70} />
          </div>
        </Panel>
      )}

      {/* Filters */}
      <FilterBar className="items-end p-4" hideIcon>
        {f.dateRange && (
          <>
            <FilterField>
              <Label htmlFor="from">From</Label>
              <Input id="from" type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="w-44" />
            </FilterField>
            <FilterField>
              <Label htmlFor="to">To</Label>
              <Input id="to" type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="w-44" />
            </FilterField>
          </>
        )}

        {f.status && (
          <FilterField>
            <Label htmlFor="status">{f.status.label}</Label>
            <Select id="status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-44">
              <option value="">All</option>
              {f.status.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </FilterField>
        )}

        {f.service && (
          <FilterField>
            <Label htmlFor="service">{f.service.label}</Label>
            <Select id="service" value={service} onChange={(e) => { setService(e.target.value); setPage(1); }} className="w-48">
              <option value="">All</option>
              {f.service.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </FilterField>
        )}

        {f.mode && (
          <FilterField>
            <Label htmlFor="mode">{f.mode.label}</Label>
            <Select id="mode" value={mode} onChange={(e) => { setMode(e.target.value); setPage(1); }} className="w-40">
              <option value="">All</option>
              {f.mode.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </FilterField>
        )}

        {f.search && (
          <FilterField className="min-w-[220px] flex-1">
            <Label htmlFor="q">Search</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <Input id="q" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder={f.search} className="pl-9" />
            </div>
          </FilterField>
        )}

        <Button variant="outline" onClick={resetFilters}>Reset</Button>
      </FilterBar>

      {/* Note / errors */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {data?.note && !error && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Info className="h-4 w-4 shrink-0" />
          {data.note}
        </div>
      )}

      {/* Table */}
      <TablePro
        title={loading ? "Loading…" : `${totalRecords.toLocaleString("en-IN")} record${totalRecords === 1 ? "" : "s"}`}
        action={
          <div className="flex items-center gap-2">
            <Label htmlFor="pageSize" className="mb-0 text-xs text-ink-500">Rows</Label>
            <Select id="pageSize" value={String(pageSize)} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="h-9 w-20">
              {[20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </div>
        }
        footer={
          !loading && totalRecords > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-600">
              <span>Showing {startIdx.toLocaleString("en-IN")}–{endIdx.toLocaleString("en-IN")} of {totalRecords.toLocaleString("en-IN")}</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                  <ChevronLeft className="h-4 w-4" /> Prev
                </Button>
                <span className="px-2 text-xs">Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : undefined
        }
      >
        <table>
          <thead>
            <tr>
              {config.columns.map((c) => (
                <th key={c.key} className={c.align === "right" ? "text-right" : undefined}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeletonRows rows={6} cols={config.columns.length} />
            ) : rows.length === 0 ? (
              <TableEmptyRow colSpan={config.columns.length} message="No records match your filters." />
            ) : (
              rows.map((row, i) => (
                <tr key={i}>
                  {config.columns.map((c) => (
                    <td key={c.key} className={c.align === "right" ? "text-right" : undefined}>
                      {displayCell(row[c.key], c.format)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {!loading && rows.length > 0 && hasTotals && (
            <tfoot>
              <tr className="border-t-2 border-ink-200 bg-ink-50/60 font-semibold text-ink-900">
                {config.columns.map((c, idx) => {
                  const tv = totals[c.key];
                  return (
                    <td key={c.key} className={`whitespace-nowrap px-5 py-3 ${c.align === "right" ? "text-right" : ""}`}>
                      {tv === undefined
                        ? idx === 0 && !("service" in totals || "date" in totals || "tid" in totals)
                          ? "Total"
                          : ""
                        : c.format === "money" || c.format === "int" || c.format === "percent"
                          ? displayCell(tv, c.format)
                          : <span className="text-ink-700">{String(tv)}</span>}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </TablePro>
    </div>
  );
}
