"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { History, Search, Filter } from "lucide-react";
import { ServicePageHeader } from "@/components/dashboard/ServicePage";
import { Input, Select } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { TransactionsTable } from "@/components/dashboard/TransactionsTable";
import { ReportActions } from "@/components/dashboard/ReportActions";
import { toDisplayRole } from "@/lib/auth";
import type { Transaction } from "@/lib/data";

export default function TransactionsPage() {
  const { data: session } = useSession();
  // Retailers don't see commission here: on settlement rails the per-txn
  // commission is the upline's, not theirs. Their earnings live on My Earnings.
  const showCommission = toDisplayRole(session?.user?.role as any) !== "retailer";
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("All");
  const [rows, setRows] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (q) params.set("q", q);
      if (status !== "All") params.set("status", status);
      const res = await fetch(`/api/transactions?${params}`);
      const json = await res.json();
      if (Array.isArray(json.data)) setRows(json.data);
      else setRows([]);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [q, status]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const totals = useMemo(() => {
    const total = rows.reduce((s, t) => s + t.amount, 0);
    const commission = rows.reduce((s, t) => s + t.commission, 0);
    return { total, commission, count: rows.length };
  }, [rows]);

  return (
    <div>
      <ServicePageHeader
        icon={History}
        title="Transactions"
        description="Search, filter and export every transaction processed through your account."
      />

      <div className={`mb-6 grid gap-4 ${showCommission ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <div className="rounded-2xl border border-ink-100 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-500">
            Total transactions
          </p>
          <p className="mt-1 font-display text-2xl font-bold text-ink-900">
            {loading ? "…" : totals.count}
          </p>
        </div>
        <div className="rounded-2xl border border-ink-100 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-500">
            Total volume
          </p>
          <p className="mt-1 font-display text-2xl font-bold text-ink-900">
            ₹ {totals.total.toLocaleString("en-IN")}
          </p>
        </div>
        {showCommission && (
          <div className="rounded-2xl border border-ink-100 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-ink-500">
              Total commission
            </p>
            <p className="mt-1 font-display text-2xl font-bold text-emerald-700">
              ₹ {totals.commission.toLocaleString("en-IN")}
            </p>
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-ink-100 bg-white p-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by ID, service or customer..."
            className="pl-9"
          />
        </div>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-40"
        >
          {["All", "Success", "Pending", "Failed"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
        <Button variant="outline" size="md" onClick={load} isLoading={loading} disabled={loading}>
          {loading ? "" : <Filter className="h-4 w-4" />}
          Refresh
        </Button>
        <ReportActions
          filename="transactions"
          title="Paybridgex · Transactions"
          subtitle={`Live view · ${rows.length} records`}
          columns={[
            { key: "id", header: "Txn ID" },
            { key: "service", header: "Service" },
            { key: "customer", header: "Customer" },
            { key: "amount", header: "Amount (INR)" },
            ...(showCommission
              ? [{ key: "commission" as const, header: "Commission (INR)" }]
              : []),
            { key: "status", header: "Status" },
            { key: "date", header: "Date" },
          ]}
          rows={rows}
        />
      </div>

      <TransactionsTable data={rows} showHeader={false} loading={loading} showCommission={showCommission} />
    </div>
  );
}
