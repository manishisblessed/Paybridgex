"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { ReportActions } from "@/components/dashboard/ReportActions";
import { RefreshCw, Trash2, Loader2 } from "lucide-react";
import { Reveal } from "@/components/motion";

type SlabRow = {
  id: string;
  userId: string;
  userName: string;
  userRole: string;
  service: string;
  minAmount: number;
  maxAmount: number;
  flat: number | null;
  percent: number | null;
  active: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export default function AdminCommissionsPage() {
  const [slabs, setSlabs] = useState<SlabRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchSlabs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/commissions");
      const data = await res.json();
      if (data.slabs) setSlabs(data.slabs);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSlabs(); }, [fetchSlabs]);

  async function deactivateSlab(id: string) {
    setDeleting(id);
    try {
      const res = await fetch(`/api/admin/commissions/${id}`, { method: "DELETE" });
      if (res.ok) fetchSlabs();
    } catch {
      // silent
    } finally {
      setDeleting(null);
    }
  }

  const formatPayout = (slab: SlabRow) => {
    if (slab.flat) return `₹${slab.flat} / txn`;
    if (slab.percent) return `${(slab.percent * 100).toFixed(2)}%`;
    return "—";
  };

  const cols: Column<SlabRow>[] = [
    { key: "service", header: "Service", render: (r) => <span className="font-semibold text-ink-900">{r.service.replace(/_/g, " ")}</span> },
    { key: "userName", header: "Applies to", render: (r) => (
      <div>
        <span className="font-medium">{r.userName}</span>
        <span className="ml-2 text-xs text-ink-500">{r.userRole}</span>
      </div>
    ) },
    { key: "minAmount", header: "Range", align: "right", render: (r) => `₹${r.minAmount} – ₹${r.maxAmount}` },
    { key: "flat", header: "Payout", align: "right", render: formatPayout },
    { key: "effectiveFrom", header: "Effective", render: (r) => new Date(r.effectiveFrom).toLocaleDateString("en-IN", { month: "short", day: "2-digit", year: "numeric" }) },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) =>
        deleting === r.id ? (
          <Loader2 className="h-4 w-4 animate-spin text-ink-400" />
        ) : (
          <button
            onClick={() => deactivateSlab(r.id)}
            className="grid h-8 w-8 place-items-center rounded-lg text-rose-700 hover:bg-rose-50 disabled:opacity-30"
            title="Deactivate slab"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
      <PageHeader
        eyebrow="Admin"
        title="Commission master"
        description="Master rate-card across services. Distributors can only set rates within these caps."
        actions={
          <>
            <ReportActions
              filename="commission-master"
              title="Paybridgex · Commission Master"
              subtitle="Service-wise rate-card"
              columns={[
                { key: "service", header: "Service" },
                { key: "userName", header: "User" },
                { key: "minAmount", header: "Min Amount" },
                { key: "maxAmount", header: "Max Amount" },
                { key: "flat", header: "Flat (₹)" },
                { key: "percent", header: "Percent (%)" },
              ]}
              rows={slabs}
            />
            <Button variant="outline" onClick={fetchSlabs} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </>
        }
      />
      </Reveal>
      <Reveal distance={16} duration={0.45}>
      <DataTable
        title={`${slabs.length} active slabs`}
        loading={loading}
        description="Commission payouts per service per user level."
        columns={cols}
        data={slabs}
        empty="No commission slabs configured yet."
      />
      </Reveal>
    </div>
  );
}
