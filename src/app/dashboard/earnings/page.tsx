"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  CircleDollarSign,
  TrendingUp,
  Layers,
  Download,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { StatCard } from "@/components/dashboard/StatCard";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { formatINR } from "@/lib/utils";

async function fetcher<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Failed to load");
  return r.json();
}

type EarningsResponse = {
  totalEarnings: number;
  totalGross: number;
  totalTds: number;
  totalCredits: number;
  byService: Array<{ service: string; amount: number; count: number }>;
  credits: Array<{
    id: string;
    tier: string;
    amount: number;
    grossAmount: number | null;
    tdsAmount: number;
    service: string;
    txnAmount: number;
    txnRefId: string;
    txnUserId: string;
    customer: string | null;
    createdAt: string;
  }>;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

function serviceName(code: string) {
  const map: Record<string, string> = {
    BILL_ELECTRICITY: "Electricity",
    BILL_WATER: "Water",
    BILL_GAS: "Gas",
    BILL_CREDIT_CARD: "Credit Card",
    BILL_EDUCATION: "Education",
    BILL_INSURANCE: "Insurance",
    RECHARGE_MOBILE: "Mobile Recharge",
    RECHARGE_DTH: "DTH Recharge",
    DMT_IMPS: "IMPS",
    DMT_NEFT: "NEFT",
    AEPS_WITHDRAW: "AePS Withdraw",
    PAN_CARD: "PAN Card",
    POS: "POS Settlement",
    QR: "QR Settlement",
    PG: "PG Settlement",
    WALLET_TOPUP: "Wallet Top-up",
  };
  return map[code] ?? code.replace(/_/g, " ");
}

function tierBadge(tier: string) {
  const v: Record<string, "success" | "brand" | "warning" | "default"> = {
    RETAILER: "success",
    DISTRIBUTOR: "brand",
    MASTER: "warning",
    SUPER: "default",
  };
  return <Badge variant={v[tier] ?? "default"}>{tier}</Badge>;
}

export default function EarningsPage() {
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const params = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const { data, isLoading } = useSWR<EarningsResponse>(
    `/api/network/earnings?${params}`,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true }
  );

  const credits = data?.credits ?? [];
  const pagination = data?.pagination;
  const byService = data?.byService ?? [];

  const cols: Column<(typeof credits)[0]>[] = [
    {
      key: "createdAt",
      header: "Date",
      render: (r) => (
        <span className="text-xs">
          {new Date(r.createdAt).toLocaleString("en-IN", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      ),
    },
    { key: "tier", header: "Tier", render: (r) => tierBadge(r.tier) },
    { key: "service", header: "Service", render: (r) => <span className="text-xs">{serviceName(r.service)}</span> },
    {
      key: "txnAmount",
      header: "Txn Amount",
      align: "right",
      render: (r) => <span className="text-xs text-ink-600">{formatINR(r.txnAmount)}</span>,
    },
    {
      key: "grossAmount",
      header: "Gross",
      align: "right",
      render: (r) => (
        <span className="text-xs text-ink-600">
          {r.grossAmount !== null ? formatINR(r.grossAmount) : "—"}
        </span>
      ),
    },
    {
      key: "tdsAmount",
      header: "TDS (2%)",
      align: "right",
      render: (r) => <span className="text-xs text-rose-600">− {formatINR(r.tdsAmount)}</span>,
    },
    {
      key: "amount",
      header: "Net Credited",
      align: "right",
      render: (r) => <span className="font-semibold text-emerald-700">{formatINR(r.amount)}</span>,
    },
    {
      key: "txnRefId",
      header: "Txn Ref",
      render: (r) => <span className="font-mono text-xs">{r.txnRefId ?? "—"}</span>,
    },
  ];

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        eyebrow="Earnings"
        title="My Commission Earnings"
        description="Track your commission income from transactions across your network."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Net Earnings (credited)"
          value={data ? formatINR(data.totalEarnings) : "..."}
          icon={CircleDollarSign}
          accent="emerald"
        />
        <StatCard
          label="TDS Withheld (2%)"
          value={data ? formatINR(data.totalTds) : "..."}
          icon={Download}
          accent="brand"
        />
        <StatCard
          label="Total Credits"
          value={data ? String(data.totalCredits) : "..."}
          icon={TrendingUp}
          accent="brand"
        />
        <StatCard
          label="Active Services"
          value={data ? String(byService.length) : "..."}
          icon={Layers}
          accent="violet"
        />
      </div>

      {/* Service breakdown */}
      {byService.length > 0 && (
        <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-sm">
          <h3 className="mb-3 font-display text-sm font-semibold text-ink-900">Earnings by service</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {byService
              .sort((a, b) => b.amount - a.amount)
              .map((s) => (
                <div key={s.service} className="flex items-center justify-between rounded-xl border border-ink-100 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-ink-900">{serviceName(s.service)}</div>
                    <div className="text-xs text-ink-500">{s.count} transactions</div>
                  </div>
                  <div className="text-sm font-semibold text-emerald-700">{formatINR(s.amount)}</div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink-500">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => { setFrom(e.target.value); setPage(1); }}
            className="rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink-500">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => { setTo(e.target.value); setPage(1); }}
            className="rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
          />
        </div>
      </div>

      <DataTable
        title="Commission credits"
        columns={cols}
        data={credits}
        loading={isLoading}
        empty="No commission credits yet. Start transacting to earn."
      />

      {pagination && pagination.totalPages > 1 && (
        <Pagination page={page} pageSize={pagination.pageSize} total={pagination.total} onPageChange={setPage} />
      )}
    </div>
  );
}
