"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { ReportActions } from "@/components/dashboard/ReportActions";
import { Pagination } from "@/components/ui/Pagination";
import { Search, Filter, RefreshCw } from "lucide-react";

type AuditRow = {
  id: string;
  actor: string;
  action: string;
  target: string;
  ip: string;
  severity: "info" | "warn" | "danger";
  flags?: string[];
  ts: string;
};

export default function AdminAuditPage() {
  const [q, setQ] = useState("");
  const [sev, setSev] = useState("all");
  const [events, setEvents] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [loading, setLoading] = useState(true);

  const fetchAudit = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (sev !== "all") params.set("severity", sev);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const res = await fetch(`/api/admin/audit?${params}`);
      const data = await res.json();
      if (data.events) {
        setEvents(data.events);
        setTotal(data.total);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [q, sev, page]);

  useEffect(() => {
    setPage(1);
  }, [q, sev]);

  useEffect(() => {
    const t = setTimeout(fetchAudit, 300);
    return () => clearTimeout(t);
  }, [fetchAudit]);

  const cols: Column<AuditRow>[] = [
    { key: "id", header: "ID", render: (r) => <span className="font-mono text-xs">{r.id.slice(0, 10)}</span> },
    { key: "actor", header: "Actor" },
    { key: "action", header: "Action", render: (r) => <span className="font-semibold text-ink-900">{r.action}</span> },
    { key: "target", header: "Target" },
    { key: "ip", header: "IP", render: (r) => <span className="font-mono text-xs">{r.ip}</span> },
    {
      key: "severity",
      header: "Severity",
      render: (r) => (
        <Badge variant={r.severity === "info" ? "brand" : r.severity === "warn" ? "warning" : "danger"}>
          {r.severity}
        </Badge>
      ),
    },
    {
      key: "flags",
      header: "Anomalies",
      render: (r) =>
        r.flags && r.flags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {r.flags.map((f) => (
              <Badge key={f} variant="danger">
                {f}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-xs text-ink-400">—</span>
        ),
    },
    { key: "ts", header: "When", className: "whitespace-nowrap text-xs text-ink-500" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Audit log"
        description="Immutable record of every privileged action across the platform."
        actions={
          <>
            <ReportActions
              filename="audit-log"
              title="Paybridgex · Audit Log"
              subtitle={`${events.length} of ${total} events`}
              columns={[
                { key: "id", header: "Event ID" },
                { key: "actor", header: "Actor" },
                { key: "action", header: "Action" },
                { key: "target", header: "Target" },
                { key: "ip", header: "IP" },
                { key: "severity", header: "Severity" },
                { key: "ts", header: "When" },
              ]}
              rows={events}
            />
            <Button variant="outline" onClick={fetchAudit} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-ink-100 bg-white p-4">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search actor, action, target..." className="pl-9" />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-ink-400" />
          <Select value={sev} onChange={(e) => setSev(e.target.value)} className="h-10 w-44">
            <option value="all">All severities</option>
            <option value="security">Security events</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="danger">Danger</option>
          </Select>
        </div>
      </div>

      <DataTable title={`${total} events`} columns={cols} data={events} loading={loading} />
      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
    </div>
  );
}
