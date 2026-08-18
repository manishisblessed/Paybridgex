"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { FilterBar, StatusPill } from "@/components/dashboard/ui";
import { Reveal } from "@/components/motion";
import { formatNumber } from "@/lib/utils";
import { RefreshCw, Search, Download } from "lucide-react";

type Agreement = {
  id: string;
  format: string | null;
  bytes: number | null;
  uploadedAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    phone: string;
    role: string;
    shopName: string | null;
    status: string;
  };
};

const inputCls =
  "rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

function prettyBytes(n: number | null): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AgreementsVaultPage() {
  const [rows, setRows] = useState<Agreement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const pageSize = 25;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/admin/agreements?${params}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Failed to load agreements");
      setRows(d.agreements);
      setTotal(d.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [page, q]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const download = async (id: string) => {
    setDownloading(id);
    try {
      const res = await fetch(`/api/admin/agreements?download=${id}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Download failed");
      window.open(d.url, "_blank");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(null);
    }
  };

  const columns: Column<Agreement>[] = [
    {
      key: "user",
      header: "Signatory",
      render: (r) => (
        <div>
          <p className="font-medium text-ink-900">{r.user.name}</p>
          <p className="text-xs text-ink-400">
            {r.user.shopName ? `${r.user.shopName} · ` : ""}
            {r.user.email}
          </p>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (r) => (
        <StatusPill status={r.user.role} tone="brand">
          {r.user.role.toLowerCase().replace(/_/g, " ")}
        </StatusPill>
      ),
    },
    {
      key: "status",
      header: "Account",
      render: (r) => (
        <StatusPill status={r.user.status} tone={r.user.status === "ACTIVE" ? "success" : "warning"}>
          {r.user.status.toLowerCase()}
        </StatusPill>
      ),
    },
    {
      key: "file",
      header: "Document",
      render: (r) => (
        <span className="text-xs text-ink-500">
          {(r.format ?? "pdf").toUpperCase()} · {prettyBytes(r.bytes)}
        </span>
      ),
    },
    {
      key: "signed",
      header: "Signed at",
      render: (r) => (
        <span className="text-xs text-ink-500">{new Date(r.uploadedAt).toLocaleString("en-IN")}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <Button size="sm" variant="outline" disabled={downloading === r.id} onClick={() => download(r.id)}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          {downloading === r.id ? "Opening…" : "View"}
        </Button>
      ),
    },
  ];

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          title="Agreements Vault"
          description="Signed onboarding agreements across the network — access is signed, short-lived, and audit-logged."
          actions={
            <Button variant="outline" onClick={load}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
          }
        />
      </Reveal>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</div>
      )}

      <FilterBar>
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            className={`${inputCls} w-full pl-9`}
            placeholder="Search name / email / phone / shop"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setPage(1);
                load();
              }
            }}
          />
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setPage(1);
            load();
          }}
        >
          Search
        </Button>
      </FilterBar>

      <Reveal distance={16} duration={0.45}>
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
        />
      </Reveal>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-500">
          <span>Page {page} of {pages} · {formatNumber(total)} agreements</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
