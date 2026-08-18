"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { RefreshCw, Database, Zap, FlaskConical } from "lucide-react";
import { StatTile, StatusPill } from "@/components/dashboard/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";

type ServiceRow = {
  service: string;
  live: boolean;
  provider: string;
};

export default function AdminSystemPage() {
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [dbStatus, setDbStatus] = useState("—");
  const [loading, setLoading] = useState(true);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/healthz");
      const data = await res.json();
      setDbStatus(data.db ?? "unknown");
      if (data.partners) {
        setServices(
          Object.entries(data.partners as Record<string, { live: boolean; provider: string }>).map(
            ([key, val]) => ({ service: key.toUpperCase(), live: val.live, provider: val.provider })
          )
        );
      }
    } catch {
      setDbStatus("unreachable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  const cols: Column<ServiceRow>[] = [
    { key: "service", header: "Service", render: (r) => <span className="font-semibold text-ink-900">{r.service}</span> },
    { key: "provider", header: "Provider" },
    {
      key: "live",
      header: "Status",
      render: (r) => (
        <StatusPill status={r.live ? "Live" : "Mock"} tone={r.live ? "success" : "warning"} />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          eyebrow="Admin"
          title="System health"
          description="Live status of database, partner integrations, and all payment switches."
          actions={
            <Button variant="outline" onClick={fetchHealth} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          }
        />
      </Reveal>

      <Stagger stagger={0.05} className="grid gap-4 md:grid-cols-3">
        <StaggerItem distance={14} duration={0.35}>
          <StatTile
            label="Database"
            value={dbStatus === "up" ? "Healthy" : "Down"}
            icon={Database}
            tone={dbStatus === "up" ? "emerald" : "rose"}
            loading={loading}
          />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile
            label="Live Partners"
            value={`${services.filter((s) => s.live).length} of ${services.length}`}
            icon={Zap}
            tone={services.some((s) => s.live) ? "emerald" : "amber"}
            loading={loading}
          />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile
            label="Mock Partners"
            countTo={services.filter((s) => !s.live).length}
            icon={FlaskConical}
            tone="ink"
            loading={loading}
          />
        </StaggerItem>
      </Stagger>

      <Reveal distance={16} duration={0.45}>
        <DataTable
          title="Partner integrations" loading={loading}
          columns={cols}
          data={services}
        />
      </Reveal>
    </div>
  );
}
