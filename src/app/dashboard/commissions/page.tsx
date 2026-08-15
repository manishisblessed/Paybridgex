"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { Award, RefreshCw, Sparkles } from "lucide-react";
import { ReportActions } from "@/components/dashboard/ReportActions";
import { type Role } from "@/lib/auth";
import { useAuth } from "@/lib/useAuth";

type SlabRow = {
  id: string;
  service: string;
  userName: string;
  userRole: string;
  minAmount: number;
  maxAmount: number;
  flat: number | null;
  percent: number | null;
};

export default function CommissionsPage() {
  const { session } = useAuth();
  const role: Role = session?.role ?? "distributor";
  const [slabs, setSlabs] = useState<SlabRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSlabs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/commissions");
      const data = await res.json();
      if (data.slabs) setSlabs(data.slabs);
    } catch {
      // silent — user may not have admin access, show empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSlabs(); }, [fetchSlabs]);

  const formatPayout = (slab: SlabRow) => {
    if (slab.flat) return `₹${slab.flat} / txn`;
    if (slab.percent) return `${(slab.percent * 100).toFixed(2)}%`;
    return "—";
  };

  const cols: Column<SlabRow>[] = [
    { key: "service", header: "Service", render: (r) => <span className="font-semibold text-ink-900">{r.service.replace(/_/g, " ")}</span> },
    { key: "flat", header: "Payout", align: "right", render: formatPayout },
    { key: "minAmount", header: "Range", align: "right", render: (r) => `₹${r.minAmount} – ₹${r.maxAmount}` },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Commissions"
        title={role === "master-distributor" ? "Commission master" : "Commission slabs"}
        description={role === "master-distributor"
          ? "Set rate-cards for your distributors. They can only set retailer payouts within these caps."
          : "View your commission rates per transaction type."}
        actions={
          <>
            <ReportActions
              filename="commission-slabs"
              title={
                role === "master-distributor"
                  ? "Paybridgex · Commission Master"
                  : "Paybridgex · Commission Slabs"
              }
              subtitle="Service-wise rate-card"
              columns={[
                { key: "service", header: "Service" },
                { key: "flat", header: "Flat (₹)" },
                { key: "percent", header: "Percent (%)" },
                { key: "minAmount", header: "Min Amount" },
                { key: "maxAmount", header: "Max Amount" },
              ]}
              rows={slabs}
            />
            <a href="/api/commissions/certificate" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" title="Download this financial year's commission certificate (PDF)">
                <Award className="h-4 w-4" />
                Certificate
              </Button>
            </a>
            <Button variant="outline" onClick={fetchSlabs} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </>
        }
      />

      <DataTable
        title="Service rate-card"
        columns={cols}
        data={slabs}
        loading={loading}
        empty="No commission slabs found."
      />
    </div>
  );
}
