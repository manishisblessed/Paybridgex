"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Panel, SectionTitle, SegmentedNav } from "@/components/dashboard/ui";
import { Reveal } from "@/components/motion";
import { formatNumber } from "@/lib/utils";
import { RefreshCw, ScanSearch } from "lucide-react";

type Check = {
  id: string;
  type: string;
  orderid: string;
  status: string;
  verifiedName: string | null;
  createdAt: string;
  user: { name: string; email: string } | null;
};

const CHECK_TYPES = [
  { key: "PAN_360", label: "PAN 360", fields: [{ name: "pan", label: "PAN number", placeholder: "ABCDE1234F" }] },
  { key: "GST", label: "GSTIN", fields: [{ name: "gst", label: "GSTIN", placeholder: "22AAAAA0000A1Z5" }] },
  {
    key: "BANK_PENNY_DROP",
    label: "Bank (penny drop)",
    fields: [
      { name: "accountNumber", label: "Account number", placeholder: "XXXXXXXXXXXX" },
      { name: "ifsc", label: "IFSC", placeholder: "HDFC0001234" },
    ],
  },
  {
    key: "BANK_ADVANCE",
    label: "Bank (no penny drop)",
    fields: [
      { name: "accountNumber", label: "Account number", placeholder: "XXXXXXXXXXXX" },
      { name: "ifsc", label: "IFSC", placeholder: "HDFC0001234" },
    ],
  },
  { key: "CIN", label: "Company CIN", fields: [{ name: "cin", label: "CIN", placeholder: "L12345MH2000PLC123456" }] },
] as const;

const inputCls =
  "rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

export default function IdentityToolkitPage() {
  const [checkType, setCheckType] = useState<string>("PAN_360");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; data?: Record<string, unknown> } | null>(null);

  const [rows, setRows] = useState<Check[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const pageSize = 25;

  const activeType = CHECK_TYPES.find((t) => t.key === checkType)!;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (typeFilter !== "all") params.set("type", typeFilter);
      const res = await fetch(`/api/admin/verify?${params}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Failed to load history");
      setRows(d.checks);
      setTotal(d.total);
    } catch {
      /* table shows empty state */
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: checkType, ...inputs }),
      });
      const d = await res.json();
      if (!res.ok) {
        const msg =
          typeof d?.error === "string"
            ? d.error
            : d?.error?.fieldErrors
            ? Object.values(d.error.fieldErrors).flat().join("; ")
            : "Verification failed";
        setResult({ ok: false, text: msg });
      } else {
        setResult({
          ok: true,
          text: d.verifiedName ? `Verified: ${d.verifiedName}` : "Verification successful.",
          data: d.data,
        });
        setInputs({});
      }
      load();
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "Verification failed" });
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<Check>[] = [
    {
      key: "type",
      header: "Check",
      render: (r) => <span className="font-semibold">{r.type.replace(/_/g, " ")}</span>,
    },
    {
      key: "name",
      header: "Verified name",
      render: (r) => <span>{r.verifiedName ?? "—"}</span>,
    },
    {
      key: "status",
      header: "Result",
      render: (r) => (
        <Badge variant={r.status === "Success" ? "success" : "danger"}>{r.status.toLowerCase()}</Badge>
      ),
    },
    {
      key: "order",
      header: "Order id",
      render: (r) => <span className="font-mono text-xs text-ink-500">{r.orderid}</span>,
    },
    {
      key: "linked",
      header: "Linked user",
      render: (r) => (r.user ? <span className="text-xs">{r.user.name}</span> : <span className="text-xs text-ink-400">—</span>),
    },
    {
      key: "at",
      header: "At",
      render: (r) => <span className="text-xs text-ink-500">{new Date(r.createdAt).toLocaleString("en-IN")}</span>,
    },
  ];

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          title="Identity Toolkit"
          description="On-demand verification suite — PAN, GST, bank account, and company CIN checks with a full audit history."
          actions={
            <Button variant="outline" onClick={load}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
          }
        />
      </Reveal>

      {/* Run a check */}
      <Reveal distance={16} duration={0.45}>
      <Panel>
        <SectionTitle
          title={
            <span className="flex items-center gap-2">
              <ScanSearch className="h-4 w-4 text-brand-600" /> Run a verification
            </span>
          }
        />
        <SegmentedNav
          tabs={CHECK_TYPES.map((t) => ({ key: t.key, label: t.label }))}
          active={checkType}
          onChange={(key) => {
            setCheckType(key);
            setInputs({});
            setResult(null);
          }}
        />

        <div className="mt-4 flex flex-wrap items-end gap-3">
          {activeType.fields.map((f) => (
            <label key={f.name} className="text-xs text-ink-500">
              {f.label}
              <input
                className={`${inputCls} mt-1 block w-56`}
                placeholder={f.placeholder}
                value={inputs[f.name] ?? ""}
                onChange={(e) => setInputs((prev) => ({ ...prev, [f.name]: e.target.value }))}
              />
            </label>
          ))}
          <Button onClick={run} disabled={busy || activeType.fields.some((f) => !(inputs[f.name] ?? "").trim())} isLoading={busy}>
            Verify
          </Button>
        </div>

        {result && (
          <div
            className={`mt-4 rounded-xl px-4 py-3 text-sm font-medium ${
              result.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
            }`}
          >
            {result.text}
            {result.ok && result.data && (
              <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-white/70 p-3 text-xs font-normal text-ink-700">
                {JSON.stringify(result.data, null, 2)}
              </pre>
            )}
          </div>
        )}
      </Panel>
      </Reveal>

      {/* History */}
      <Reveal distance={16} duration={0.45}>
        <div className="space-y-6">
          <SegmentedNav
            tabs={["all", ...CHECK_TYPES.map((t) => t.key)].map((t) => ({
              key: t,
              label: t === "all" ? "All history" : t.replace(/_/g, " "),
            }))}
            active={typeFilter}
            onChange={(t) => {
              setTypeFilter(t);
              setPage(1);
            }}
          />

          <DataTable
            columns={columns}
            data={rows}
            loading={loading}
          />

          {pages > 1 && (
            <div className="flex items-center justify-between text-sm text-ink-500">
              <span>Page {page} of {pages} · {formatNumber(total)} checks</span>
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
      </Reveal>
    </div>
  );
}
