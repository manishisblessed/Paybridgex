"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { History, Search, Filter, Receipt, IndianRupee, HandCoins } from "lucide-react";
import { ServicePageHeader } from "@/components/dashboard/ServicePage";
import { StatTile, FilterBar } from "@/components/dashboard/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
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
      <Reveal distance={14} duration={0.4}>
        <ServicePageHeader
          icon={History}
          title="Transactions"
          description="Search, filter and export every transaction processed through your account."
        />
      </Reveal>

      <Stagger
        stagger={0.05}
        className={`mb-6 grid gap-4 ${showCommission ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
      >
        <StaggerItem distance={14} duration={0.35}>
          <StatTile
            label="Total transactions"
            countTo={totals.count}
            icon={Receipt}
            tone="brand"
            loading={loading}
          />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile
            label="Total volume"
            countTo={totals.total}
            prefix="₹ "
            icon={IndianRupee}
            tone="violet"
            loading={loading}
          />
        </StaggerItem>
        {showCommission && (
          <StaggerItem distance={14} duration={0.35}>
            <StatTile
              label="Total commission"
              countTo={totals.commission}
              prefix="₹ "
              icon={HandCoins}
              tone="emerald"
              loading={loading}
            />
          </StaggerItem>
        )}
      </Stagger>

      <FilterBar className="mb-4">
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
      </FilterBar>

      <Reveal distance={16} duration={0.45}>
        <TransactionsTable data={rows} showHeader={false} loading={loading} showCommission={showCommission} />
      </Reveal>
    </div>
  );
}
