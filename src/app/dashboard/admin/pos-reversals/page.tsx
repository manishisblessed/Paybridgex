"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { RotateCcw, Undo2, AlertTriangle, Ban } from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { StatCard } from "@/components/dashboard/StatCard";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Badge } from "@/components/ui/Badge";
import { formatINR } from "@/lib/utils";

type ReversalRow = {
  transactionRef: string;
  txnId: string | null;
  terminalId: string;
  mid: string | null;
  amount: number;
  status: string;
  reversalReason: string | null;
  reversedAt: string | null;
  txnTime: string;
  cardBrand: string | null;
  cardNumber: string | null;
  settlement: {
    status: string;
    netAmount: number;
    wasSettled: boolean;
    settledAt: string | null;
    retailer: string | null;
  } | null;
  needsClawback: boolean;
};

type ReversalsResponse = {
  summary: {
    voided_count: number;
    refunded_count: number;
    needs_clawback_count: number;
    needs_clawback_amount: number;
  };
  data: ReversalRow[];
  pagination: { page: number; page_size: number; total: number; total_pages: number };
};

async function fetcher<T>(url: string): Promise<T> {
  const r = await fetch(url);
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

const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (d: number) => new Date(Date.now() - d * 86400_000).toISOString().slice(0, 10);
const fmtDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN") : "—");

export default function PosReversalsPage() {
  const [dateFrom, setDateFrom] = useState(daysAgoIso(30));
  const [dateTo, setDateTo] = useState(todayIso());
  const [status, setStatus] = useState<"" | "VOIDED" | "REFUNDED">("");
  const [clawbackOnly, setClawbackOnly] = useState(false);
  const [page, setPage] = useState(1);

  const qs = useMemo(() => {
    const p = new URLSearchParams({
      date_from: new Date(`${dateFrom}T00:00:00.000Z`).toISOString(),
      date_to: new Date(`${dateTo}T23:59:59.999Z`).toISOString(),
      page: String(page),
      page_size: "25",
    });
    if (status) p.set("status", status);
    if (clawbackOnly) p.set("needs_clawback", "1");
    return p.toString();
  }, [dateFrom, dateTo, status, clawbackOnly, page]);

  const { data, error, isLoading } = useSWR<ReversalsResponse>(
    `/api/admin/pos/reversals?${qs}`,
    fetcher,
    { keepPreviousData: true }
  );

  const columns: Column<ReversalRow>[] = [
    {
      key: "txnId",
      header: "Transaction",
      render: (r) => (
        <div className="min-w-0">
          <div className="font-mono text-xs font-semibold text-ink-900">{r.txnId || r.transactionRef}</div>
          <div className="text-[11px] text-ink-500">
            TID {r.terminalId}
            {r.cardBrand ? ` · ${r.cardBrand}` : ""}
          </div>
        </div>
      ),
    },
    { key: "amount", header: "Amount", align: "right", render: (r) => <span className="font-semibold">{formatINR(r.amount)}</span> },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge variant={r.status === "REFUNDED" ? "warning" : "danger"}>{r.status}</Badge>
      ),
    },
    {
      key: "settlement",
      header: "Settlement",
      render: (r) => {
        if (!r.settlement) return <span className="text-xs text-ink-500">Not settled (no entry)</span>;
        if (r.settlement.wasSettled)
          return (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700">
              <AlertTriangle className="h-3.5 w-3.5" /> Credited {formatINR(r.settlement.netAmount)} — clawback
            </span>
          );
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-600">
            <Ban className="h-3.5 w-3.5" /> Cancelled before payout
          </span>
        );
      },
    },
    { key: "retailer", header: "Retailer", render: (r) => <span className="text-xs">{r.settlement?.retailer ?? "—"}</span> },
    { key: "reversalReason", header: "Reason", render: (r) => <span className="font-mono text-[11px] text-ink-600">{r.reversalReason ?? "—"}</span> },
    { key: "reversedAt", header: "Reversed", render: (r) => <span className="text-xs text-ink-600">{fmtDateTime(r.reversedAt)}</span> },
    { key: "txnTime", header: "Swiped", render: (r) => <span className="text-xs text-ink-500">{fmtDateTime(r.txnTime)}</span> },
  ];

  const s = data?.summary;

  return (
    <div>
      <PageHeader
        eyebrow="ADMIN"
        title="POS Reversals"
        description="Captures that Same Day later voided or refunded at the terminal. These no longer count as successful — reconcile any that had already been credited to a retailer."
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Voided" value={String(s?.voided_count ?? 0)} icon={Ban} accent="brand" />
        <StatCard label="Refunded" value={String(s?.refunded_count ?? 0)} icon={Undo2} accent="violet" />
        <StatCard label="Needs Clawback" value={String(s?.needs_clawback_count ?? 0)} icon={AlertTriangle} accent="accent" />
        <StatCard label="Clawback Amount" value={formatINR(s?.needs_clawback_amount ?? 0)} icon={RotateCcw} accent="emerald" />
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-ink-100 bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-600">
          From
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm text-ink-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-600">
          To
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm text-ink-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-600">
          Status
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value as "" | "VOIDED" | "REFUNDED"); setPage(1); }}
            className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm text-ink-900"
          >
            <option value="">All</option>
            <option value="VOIDED">Voided</option>
            <option value="REFUNDED">Refunded</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-ink-700">
          <input
            type="checkbox"
            checked={clawbackOnly}
            onChange={(e) => { setClawbackOnly(e.target.checked); setPage(1); }}
            className="h-4 w-4 rounded border-ink-300"
          />
          Needs clawback only
        </label>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error.message}
        </div>
      )}

      <DataTable<ReversalRow>
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        empty="No reversed POS transactions in this window."
      />

      {data && data.pagination.total_pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-ink-600">
          <span>
            Page {data.pagination.page} of {data.pagination.total_pages} · {data.pagination.total} reversals
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-ink-200 px-3 py-1.5 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={page >= data.pagination.total_pages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-ink-200 px-3 py-1.5 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
