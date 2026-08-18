"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { StatTile, StatusPill } from "@/components/dashboard/ui";
import { Button } from "@/components/ui/Button";
import { ReportActions } from "@/components/dashboard/ReportActions";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { Settings2, RefreshCw, Activity, Layers, Gauge, AlertTriangle, XCircle } from "lucide-react";

type BillerRow = {
  category: string;
  count: number;
  routing: string;
  uptime: string;
  status: "Live" | "Degraded" | "Down";
};

type BillerStats = {
  totalActive: number;
  totalCategories: number;
  degradedCount: number;
  downCount: number;
};

export default function AdminBillersPage() {
  const [billers, setBillers] = useState<BillerRow[]>([]);
  const [stats, setStats] = useState<BillerStats>({ totalActive: 0, totalCategories: 0, degradedCount: 0, downCount: 0 });
  const [loading, setLoading] = useState(true);

  const fetchBillers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/billers");
      const data = await res.json();
      if (data.billers) setBillers(data.billers);
      if (data.stats) setStats(data.stats);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBillers(); }, [fetchBillers]);

  const cols: Column<BillerRow>[] = [
    { key: "category", header: "Category", render: (r) => <span className="font-semibold text-ink-900">{r.category}</span> },
    { key: "count", header: "Billers", align: "right" },
    { key: "routing", header: "Routing" },
    { key: "uptime", header: "Uptime (24h)", align: "right" },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <StatusPill
          status={r.status}
          tone={r.status === "Live" ? "success" : r.status === "Degraded" ? "warning" : "danger"}
        />
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: () => (
        <button className="text-xs font-semibold text-brand-700 hover:underline">
          Configure
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
      <PageHeader
        eyebrow="Admin"
        title="Billers & routing"
        description="Manage billers across BBPS, NPCI, NETC and direct integrations. Configure failover routes and monitor uptime."
        actions={
          <>
            <ReportActions
              filename="billers"
              title="Paybridgex · Billers & Routing"
              subtitle="Category-level uptime and routing"
              columns={[
                { key: "category", header: "Category" },
                { key: "count", header: "Billers" },
                { key: "routing", header: "Routing" },
                { key: "uptime", header: "Uptime (24h)" },
                { key: "status", header: "Status" },
              ]}
              rows={billers}
            />
            <Button variant="outline" onClick={fetchBillers} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button variant="outline">
              <Settings2 className="h-4 w-4" /> Routing rules
            </Button>
          </>
        }
      />
      </Reveal>

      <Stagger stagger={0.05} className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StaggerItem distance={14} duration={0.35}>
          <StatTile label="Live billers" countTo={stats.totalActive} icon={Activity} tone="emerald" loading={loading} />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile label="Categories" countTo={stats.totalCategories} icon={Layers} tone="brand" loading={loading} />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile label="Avg uptime" value={billers.length ? "99.9%" : "—"} icon={Gauge} tone="sky" loading={loading} />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile label="Degraded now" countTo={stats.degradedCount} icon={AlertTriangle} tone="amber" loading={loading} />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile label="Down now" countTo={stats.downCount} icon={XCircle} tone="rose" loading={loading} />
        </StaggerItem>
      </Stagger>

      <Reveal distance={16} duration={0.45}>
        <DataTable
          title="Categories" loading={loading}
          columns={cols}
          data={billers}
          empty="No billers found in the database. Seed billers to see data here."
        />
      </Reveal>
    </div>
  );
}
