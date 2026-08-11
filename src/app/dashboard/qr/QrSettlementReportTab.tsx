"use client";

import { useState, useCallback, useMemo } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  IndianRupee,
  Scissors,
  Banknote,
  Wallet,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Users,
  Receipt,
  X,
} from "lucide-react";
import { StatCard } from "@/components/dashboard/StatCard";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatINR } from "@/lib/utils";
import { type ReportColumn } from "@/lib/reports";
import { ReportActions } from "@/components/dashboard/ReportActions";

// ── API contract (mirrors src/lib/qr/settlementReport.ts) ──

type QrClaimStatus =
  | "PENDING"
  | "AWAITING_SECOND_APPROVAL"
  | "APPROVED"
  | "SETTLEABLE"
  | "SETTLED"
  | "REJECTED"
  | "CLAWED_BACK";

type ReportRetailer = {
  id: string;
  name: string;
  shopName: string | null;
  userCode: string | null;
  role: string;
};

type ReportRow = {
  id: string;
  utr: string | null;
  cardLast4: string | null;
  qrLabel: string | null;
  txnTime: string | null;
  submittedAt: string;
  retailer: ReportRetailer | null;
  grossAmount: number;
  mdrAmount: number | null;
  netSettled: number | null;
  status: QrClaimStatus;
  statusLabel: string;
  settledVia: string | null;
  settledAt: string | null;
  myCommission: number | null;
};

type RollupRow = {
  userId: string;
  name: string;
  shopName: string | null;
  userCode: string | null;
  role: string;
  txnCount: number;
  grossAmount: number;
  mdrAmount: number;
  netSettled: number;
  myCommission: number | null;
};

type ReportSummary = {
  totalTransactions: number;
  totalGross: number;
  totalMdr: number;
  totalSettled: number;
  totalCommission: number | null;
  settleableCount: number;
  settledCount: number;
  underReviewCount: number;
};

type ReportResponse = {
  rows: ReportRow[];
  rollup: RollupRow[];
  summary: ReportSummary;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasPrev: boolean;
    hasNext: boolean;
  };
  showCommission: boolean;
};

const ROLE_LABELS: Record<string, string> = {
  SUPER_DISTRIBUTOR: "Super Distributor",
  MASTER_DISTRIBUTOR: "Master Distributor",
  DISTRIBUTOR: "Distributor",
  RETAILER: "Retailer",
};

async function postFetcher<T>([url, body]: readonly [string, unknown]): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json: { error?: string } = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(r.ok ? "Invalid response from server" : `Request failed (${r.status})`);
  }
  if (!r.ok) throw new Error(typeof json?.error === "string" ? json.error : "Request failed");
  return json as T;
}

function defaultDateRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status: QrClaimStatus, label: string) {
  if (status === "SETTLED" || status === "APPROVED") return <Badge variant="success">{label}</Badge>;
  if (status === "SETTLEABLE") return <Badge variant="accent">{label}</Badge>;
  if (status === "REJECTED" || status === "CLAWED_BACK") return <Badge variant="danger">{label}</Badge>;
  return <Badge variant="warning">{label}</Badge>;
}

function retailerCell(r: { retailer: ReportRetailer | null }) {
  if (!r.retailer) return <span className="text-xs text-ink-400">—</span>;
  return (
    <div className="flex flex-col">
      <span className="max-w-[150px] truncate text-xs font-semibold text-ink-900">
        {r.retailer.shopName || r.retailer.name}
      </span>
      <span className="text-[11px] text-ink-500">
        {r.retailer.userCode ? <span className="font-medium text-brand-600">{r.retailer.userCode}</span> : null}
        {r.retailer.userCode ? " · " : ""}
        {ROLE_LABELS[r.retailer.role] ?? r.retailer.role}
      </span>
    </div>
  );
}

type View = "transactions" | "rollup";

export function QrSettlementReportTab() {
  const defaults = defaultDateRange();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [statusFilter, setStatusFilter] = useState<"" | "UNDER_REVIEW" | "SETTLEABLE" | "SETTLED" | "REJECTED">("");
  const [retailerId, setRetailerId] = useState<string | null>(null);
  const [retailerLabel, setRetailerLabel] = useState<string | null>(null);
  const [view, setView] = useState<View>("transactions");
  const [page, setPage] = useState(1);

  const body = useMemo(
    () => ({
      date_from: `${dateFrom}T00:00:00.000+05:30`,
      date_to: `${dateTo}T23:59:59.999+05:30`,
      status: statusFilter || null,
      retailer_id: retailerId,
      page,
      page_size: 50,
    }),
    [dateFrom, dateTo, statusFilter, retailerId, page]
  );

  const { data, error, isLoading, mutate } = useSWR<ReportResponse>(
    ["/api/qr/settlement-report", body],
    postFetcher,
    { revalidateOnFocus: false, keepPreviousData: true }
  );

  const summary = data?.summary;
  const pagination = data?.pagination;
  const rows = data?.rows ?? [];
  const rollup = data?.rollup ?? [];
  const showCommission = data?.showCommission ?? false;

  const drillToUser = useCallback((r: RollupRow) => {
    setRetailerId(r.userId);
    setRetailerLabel(r.shopName || r.name);
    setView("transactions");
    setPage(1);
  }, []);

  const clearDrill = useCallback(() => {
    setRetailerId(null);
    setRetailerLabel(null);
    setPage(1);
  }, []);

  // Export: fetch every matching row (server-side, ownership scoped).
  const fetchAllRows = useCallback(async (): Promise<ReportRow[]> => {
    const res = await fetch("/api/qr/settlement-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, export: true }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast.error(typeof d.error === "string" ? d.error : "Failed to build report");
      return rows;
    }
    const d = await res.json();
    if (d.truncated) {
      toast.warning(
        `Report capped at ${Number(d.returned).toLocaleString("en-IN")} rows — narrow the date range for the rest.`
      );
    }
    return (d.rows as ReportRow[]) ?? [];
  }, [body, rows]);

  const exportCols: ReportColumn<ReportRow>[] = [
    { key: "txnTime", header: "Paid At", render: (r) => (r.txnTime ? new Date(r.txnTime).toLocaleString("en-IN") : "") },
    { key: "retailer", header: "Merchant", render: (r) => r.retailer?.shopName || r.retailer?.name || "" },
    { key: "userCode", header: "Merchant Code", render: (r) => r.retailer?.userCode ?? "" },
    { key: "role", header: "Role", render: (r) => (r.retailer ? ROLE_LABELS[r.retailer.role] ?? r.retailer.role : "") },
    { key: "utr", header: "UTR", render: (r) => r.utr ?? "" },
    { key: "cardLast4", header: "Card Last4", render: (r) => r.cardLast4 ?? "" },
    { key: "qrLabel", header: "QR", render: (r) => r.qrLabel ?? "" },
    { key: "grossAmount", header: "Amount (INR)", format: "money", render: (r) => r.grossAmount.toFixed(2) },
    { key: "mdrAmount", header: "MDR (INR)", format: "money", render: (r) => (r.mdrAmount ?? 0).toFixed(2) },
    { key: "netSettled", header: "Settled (INR)", format: "money", render: (r) => (r.netSettled ?? 0).toFixed(2) },
    { key: "status", header: "Status", render: (r) => r.statusLabel },
    { key: "settledVia", header: "Via", render: (r) => r.settledVia ?? "" },
    ...(showCommission
      ? [
          {
            key: "myCommission",
            header: "My Commission (INR)",
            format: "money" as const,
            render: (r: ReportRow) => (r.myCommission ?? 0).toFixed(2),
          },
        ]
      : []),
  ];

  const txnCols: Column<ReportRow>[] = [
    { key: "txnTime", header: "Paid At", render: (r) => <span className="text-xs">{fmtTime(r.txnTime)}</span> },
    { key: "retailer", header: "Merchant", render: retailerCell },
    {
      key: "utr",
      header: "UTR / Card",
      render: (r) => (
        <span className="font-mono text-xs">{r.utr ?? (r.cardLast4 ? `•••• ${r.cardLast4}` : "—")}</span>
      ),
    },
    {
      key: "qrLabel",
      header: "QR",
      render: (r) => (r.qrLabel ? <span className="text-xs">{r.qrLabel}</span> : "—"),
    },
    { key: "grossAmount", header: "Amount", align: "right", render: (r) => <span className="font-semibold text-ink-900">{formatINR(r.grossAmount)}</span> },
    {
      key: "mdrAmount",
      header: "MDR",
      align: "right",
      render: (r) => (r.mdrAmount != null ? <span className="text-rose-600">−{formatINR(r.mdrAmount)}</span> : <span className="text-xs text-ink-400">—</span>),
    },
    {
      key: "netSettled",
      header: "Settled",
      align: "right",
      render: (r) => (r.netSettled != null ? <span className="font-semibold text-emerald-700">{formatINR(r.netSettled)}</span> : <span className="text-xs text-ink-400">—</span>),
    },
    { key: "status", header: "Status", render: (r) => statusBadge(r.status, r.statusLabel) },
    ...(showCommission
      ? [
          {
            key: "myCommission",
            header: "My Commission",
            align: "right" as const,
            render: (r: ReportRow) => <span className="font-semibold text-brand-700">{formatINR(r.myCommission ?? 0)}</span>,
          },
        ]
      : []),
  ];

  const rollupCols: Column<RollupRow>[] = [
    {
      key: "name",
      header: "Merchant",
      render: (r) => (
        <div className="flex flex-col">
          <span className="max-w-[180px] truncate text-xs font-semibold text-ink-900">{r.shopName || r.name}</span>
          <span className="text-[11px] text-ink-500">
            {r.userCode ? <span className="font-medium text-brand-600">{r.userCode}</span> : null}
            {r.userCode ? " · " : ""}
            {ROLE_LABELS[r.role] ?? r.role}
          </span>
        </div>
      ),
    },
    { key: "txnCount", header: "Claims", align: "right", render: (r) => <span className="font-semibold">{r.txnCount.toLocaleString("en-IN")}</span> },
    { key: "grossAmount", header: "Volume", align: "right", render: (r) => <span className="font-semibold text-ink-900">{formatINR(r.grossAmount)}</span> },
    { key: "mdrAmount", header: "MDR", align: "right", render: (r) => <span className="text-rose-600">−{formatINR(r.mdrAmount)}</span> },
    { key: "netSettled", header: "Settled", align: "right", render: (r) => <span className="font-semibold text-emerald-700">{formatINR(r.netSettled)}</span> },
    ...(showCommission
      ? [
          {
            key: "myCommission",
            header: "My Commission",
            align: "right" as const,
            render: (r: RollupRow) => <span className="font-semibold text-brand-700">{formatINR(r.myCommission ?? 0)}</span>,
          },
        ]
      : []),
    {
      key: "drill",
      header: "",
      align: "right",
      render: (r) => (
        <button
          onClick={() => drillToUser(r)}
          className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700 transition-colors hover:bg-brand-100"
        >
          <Receipt className="h-3 w-3" /> View claims
        </button>
      ),
    },
  ];

  const reportSubtitle =
    `${dateFrom} to ${dateTo}` +
    (statusFilter ? ` · ${statusFilter}` : "") +
    (retailerLabel ? ` · ${retailerLabel}` : "");

  return (
    <>
      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Claims" value={summary ? summary.totalTransactions.toLocaleString("en-IN") : "..."} icon={ArrowLeftRight} accent="brand" />
        <StatCard label="Total Volume" value={summary ? formatINR(summary.totalGross) : "..."} icon={IndianRupee} accent="violet" />
        <StatCard label="MDR Deducted" value={summary ? formatINR(summary.totalMdr) : "..."} icon={Scissors} accent="accent" />
        <StatCard label="Amount Settled" value={summary ? formatINR(summary.totalSettled) : "..."} icon={Banknote} accent="emerald" />
        {showCommission ? (
          <StatCard label="My Commission" value={summary ? formatINR(summary.totalCommission ?? 0) : "..."} icon={Wallet} accent="brand" />
        ) : (
          <StatCard
            label="Ready / Settled"
            value={summary ? `${summary.settleableCount} / ${summary.settledCount}` : "..."}
            icon={Wallet}
            accent="emerald"
          />
        )}
      </div>

      {/* Filters */}
      <div className="rounded-2xl border border-ink-100 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-500">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-500">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-500">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); setPage(1); }}
              className="rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
            >
              <option value="">All</option>
              <option value="UNDER_REVIEW">Under review</option>
              <option value="SETTLEABLE">Ready to settle</option>
              <option value="SETTLED">Settled</option>
              <option value="REJECTED">Rejected / Reversed</option>
            </select>
          </div>
          <Button variant="outline" size="sm" onClick={() => mutate()} title="Refresh">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>

          <div className="ml-auto flex flex-wrap gap-2">
            <ReportActions<ReportRow>
              filename={`qr-settlement-report-${dateFrom}-to-${dateTo}`}
              title="QR Settlement Report"
              subtitle={reportSubtitle}
              columns={exportCols}
              rows={rows}
              fetchRows={fetchAllRows}
            />
          </div>
        </div>

        {/* Active drill-down chip */}
        {retailerLabel && (
          <div className="mt-3 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
              Showing: {retailerLabel}
              <button onClick={clearDrill} className="rounded-full hover:bg-brand-100" aria-label="Clear filter">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
        )}
      </div>

      {/* View toggle */}
      <div className="flex gap-1 rounded-xl border border-ink-100 bg-ink-50/60 p-1">
        {([
          { id: "transactions", label: "Per Transaction", icon: Receipt },
          { id: "rollup", label: "By Merchant / Downline", icon: Users },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={
              view === id
                ? "flex-1 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-ink-900 shadow-sm"
                : "flex-1 rounded-lg px-4 py-2 text-sm font-semibold text-ink-500 transition-colors hover:text-ink-700"
            }
          >
            <span className="flex items-center justify-center gap-2"><Icon className="h-4 w-4" /> {label}</span>
          </button>
        ))}
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error instanceof Error ? error.message : "Failed to load the settlement report."}
        </div>
      ) : view === "transactions" ? (
        <>
          <DataTable
            title="QR Settlement — per transaction"
            description={
              pagination
                ? `${pagination.total.toLocaleString("en-IN")} claim${pagination.total === 1 ? "" : "s"} · page ${pagination.page} of ${pagination.totalPages}`
                : isLoading
                  ? "Loading..."
                  : "No data yet"
            }
            columns={txnCols}
            data={rows}
            loading={isLoading}
            empty="No QR claims for the selected filters."
          />
          {pagination && pagination.totalPages > 1 && (
            <Paginator
              page={pagination.page}
              totalPages={pagination.totalPages}
              hasPrev={pagination.hasPrev}
              hasNext={pagination.hasNext}
              onPrev={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => p + 1)}
            />
          )}
        </>
      ) : (
        <DataTable
          title="Settlement rollup — by merchant / downline"
          description={
            rollup.length
              ? `${rollup.length} merchant${rollup.length === 1 ? "" : "s"} with QR activity in this period`
              : isLoading
                ? "Loading..."
                : "No data yet"
          }
          columns={rollupCols}
          data={rollup}
          loading={isLoading}
          empty="No QR activity in your network for the selected filters."
        />
      )}
    </>
  );
}

function Paginator({ page, totalPages, hasPrev, hasNext, onPrev, onNext }: {
  page: number; totalPages: number; hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-center gap-3">
      <Button variant="outline" size="sm" disabled={!hasPrev} onClick={onPrev}>
        <ChevronLeft className="h-4 w-4" /> Previous
      </Button>
      <span className="text-sm text-ink-600">Page {page} of {totalPages}</span>
      <Button variant="outline" size="sm" disabled={!hasNext} onClick={onNext}>
        Next <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
