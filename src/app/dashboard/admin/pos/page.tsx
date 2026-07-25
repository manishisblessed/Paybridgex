"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  Monitor,
  IndianRupee,
  ArrowLeftRight,
  CreditCard,
  Search,
  RefreshCcw,
  Download,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  UserPlus,
  UserMinus,
  X,
  Check,
  History,
  Truck,
  PackageCheck,
  RotateCcw,
  CheckCircle2,
  ArrowRight,
  Pencil,
  Eye,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { StatCard } from "@/components/dashboard/StatCard";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn, formatINR } from "@/lib/utils";
import type {
  PosTransactionsResponse,
  PosTransaction,
  PosTransactionStatus,
  PosPaymentMode,
  LocalPosMachine,
  LocalPosMachinesResponse,
} from "@/lib/partners/sameday-pos.types";

// ── Fetchers ──

async function fetcher<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const text = await r.text();
  let json: { error?: string } = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(r.ok ? "Invalid response from server" : `Request failed (${r.status})`);
  }
  if (!r.ok) throw new Error(typeof json?.error === "string" ? json.error : "Request failed");
  return json as T;
}

async function postFetcher<T>([url, body]: readonly [string, unknown]): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json: { error?: string } = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(r.ok ? "Invalid response from server" : `Request failed (${r.status})`);
  }
  if (!r.ok) throw new Error(typeof json?.error === "string" ? json.error : "Request failed");
  return json as T;
}

// ── Helpers ──

function defaultDateRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function todayRange() {
  const today = new Date().toISOString().slice(0, 10);
  return { from: today, to: today };
}

function statusBadge(status: PosTransactionStatus) {
  const v: Record<PosTransactionStatus, "success" | "warning" | "danger" | "brand" | "default"> = {
    CAPTURED: "success", AUTHORIZED: "brand", FAILED: "danger", REFUNDED: "warning", VOIDED: "default",
  };
  return <Badge variant={v[status] ?? "default"}>{status}</Badge>;
}

function machineBadge(status: string) {
  const m: Record<string, "success" | "danger" | "warning" | "default"> = {
    active: "success", inactive: "default", maintenance: "warning", decommissioned: "danger",
  };
  return <Badge variant={m[status] ?? "default"}>{status}</Badge>;
}

function cleanName(name: string | null) {
  if (!name) return "—";
  return name.replace(/\s*\/\s*$/, "").trim() || "—";
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

// ── Tab types ──
type Tab = "machines" | "transactions" | "tracking";

export default function AdminPosPage() {
  const [activeTab, setActiveTab] = useState<Tab>("transactions");

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="POS Fleet"
        description="Machine inventory, live transactions, exports and device health across all terminals."
      />

      {/* Tabs */}
      <div className="inline-flex w-full max-w-2xl gap-1 rounded-xl border border-ink-100 bg-ink-50/60 p-1">
        {(["transactions", "machines", "tracking"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all",
              activeTab === tab
                ? "bg-white text-ink-900 shadow-sm ring-1 ring-ink-100"
                : "text-ink-500 hover:text-ink-700"
            )}
          >
            {tab === "transactions" ? (
              <span className="flex items-center justify-center gap-2"><ArrowLeftRight className="h-4 w-4" /> Live Transactions</span>
            ) : tab === "machines" ? (
              <span className="flex items-center justify-center gap-2"><Monitor className="h-4 w-4" /> POS Machines</span>
            ) : (
              <span className="flex items-center justify-center gap-2"><History className="h-4 w-4" /> Tracking Report</span>
            )}
          </button>
        ))}
      </div>

      {activeTab === "transactions" ? (
        <TransactionsTab />
      ) : activeTab === "machines" ? (
        <MachinesTab />
      ) : (
        <TrackingTab />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MACHINES TAB
// ═══════════════════════════════════════════════════════════════════════

function MachinesTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [syncing, setSyncing] = useState(false);
  const [assignTargets, setAssignTargets] = useState<LocalPosMachine[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [unassigning, setUnassigning] = useState<Set<string>>(new Set());
  const [unassignTarget, setUnassignTarget] = useState<LocalPosMachine | null>(null);
  const [recallOpen, setRecallOpen] = useState(false);

  const params = new URLSearchParams({ page: String(page), pageSize: "50" });
  if (statusFilter) params.set("status", statusFilter);
  if (search) params.set("search", search);
  if (assigneeFilter) params.set("assignee", assigneeFilter);

  const { data, error, isLoading, mutate } = useSWR<LocalPosMachinesResponse>(
    `/api/admin/pos/machines?${params}`,
    fetcher,
    {
      revalidateOnFocus: false,
      keepPreviousData: true,
      // Live fleet: poll the local mirror every 5s so assignments/recalls and
      // the every-10-min background partner sync surface without a manual click.
      refreshInterval: 5000,
      refreshWhenHidden: false,
    }
  );

  const machines = data?.data ?? [];
  const pagination = data?.pagination;
  const stats = data?.stats;
  const byUser = data?.byUser ?? [];
  const filteredUser = byUser.find((u) => u.userId === assigneeFilter) ?? null;
  const autoSynced = useRef(false);

  const syncInFlight = useRef(false);

  const handleSync = useCallback(async () => {
    if (syncInFlight.current) return;
    syncInFlight.current = true;
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/pos/machines/sync", { method: "POST" });
      const text = await res.text();
      let d: { error?: string; retryAfterSec?: number; scanned?: number; created?: number; updated?: number } = {};
      try {
        d = text ? JSON.parse(text) : {};
      } catch {
        /* non-JSON body */
      }
      if (!res.ok) {
        if (res.status === 429) {
          toast.error(`Sync rate limited — try again in ${d.retryAfterSec ?? 60}s`);
        } else {
          toast.error(typeof d.error === "string" ? d.error : `Sync failed (HTTP ${res.status})`);
        }
      } else {
        await mutate();
        const msg = d.scanned != null
          ? `Synced: ${d.scanned} scanned, ${d.created} new, ${d.updated} updated`
          : "Machine inventory synced";
        toast.success(msg);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync request failed — check your connection");
    } finally {
      setSyncing(false);
      syncInFlight.current = false;
    }
  }, [mutate]);

  // Local PosMachine mirror starts empty until the first partner sync.
  // Auto-pull once so admins aren't stuck on an empty inventory table.
  useEffect(() => {
    if (autoSynced.current || isLoading || error || !data) return;
    if ((data.stats?.total ?? 0) > 0) {
      autoSynced.current = true;
      return;
    }
    autoSynced.current = true;
    void handleSync();
  }, [data, error, isLoading, handleSync]);

  const handleUnassign = useCallback(async (machine: LocalPosMachine) => {
    setUnassigning((prev) => new Set(prev).add(machine.id));
    const label = machine.tid ?? machine.serial ?? machine.externalId;
    try {
      const res = await fetch("/api/admin/pos/machines/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machineId: machine.id, userId: null }),
      });
      const text = await res.text();
      let d: { error?: string } = {};
      try {
        d = text ? JSON.parse(text) : {};
      } catch {
        /* non-JSON body */
      }
      if (!res.ok) {
        toast.error(typeof d.error === "string" ? d.error : "Unassign failed");
      } else {
        toast.success(`${label} returned to stock`);
        // Update the row locally right away, then revalidate in background.
        await mutate(
          (current) =>
            current && {
              ...current,
              data: current.data.map((m) =>
                m.id === machine.id
                  ? { ...m, assignedUserId: null, assignedAt: null, assignee: null }
                  : m
              ),
              stats: current.stats && {
                ...current.stats,
                assigned: Math.max(0, current.stats.assigned - 1),
                unassigned: current.stats.unassigned + 1,
              },
            },
          { revalidate: true }
        );
      }
    } catch {
      toast.error("Unassign request failed. Check your connection and try again.");
    } finally {
      setUnassigning((prev) => {
        const next = new Set(prev);
        next.delete(machine.id);
        return next;
      });
    }
  }, [mutate]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allOnPageSelected = machines.length > 0 && machines.every((m) => selected.has(m.id));

  const togglePage = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (machines.every((m) => next.has(m.id))) {
        for (const m of machines) next.delete(m.id);
      } else {
        for (const m of machines) next.add(m.id);
      }
      return next;
    });
  }, [machines]);

  const handleBulkRecall = useCallback(async (reason: string) => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/admin/pos/machines/bulk-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          machineIds: Array.from(selected),
          userId: null,
          returnReason: reason.trim() || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        toast.error(typeof d.error === "string" ? d.error : "Bulk recall failed");
      } else {
        if (d.failedCount > 0) {
          toast.warning(`Recalled ${d.succeededCount} of ${d.total}`, {
            description: `Skipped: ${d.failed.map((f: { label: string; error: string }) => `${f.label} (${f.error})`).join(", ")}`,
          });
        } else {
          toast.success(`Recalled ${d.succeededCount} machine${d.succeededCount === 1 ? "" : "s"} to stock`);
        }
        setSelected(new Set());
        mutate();
      }
    } catch {
      toast.error("Bulk recall request failed");
    } finally {
      setBulkBusy(false);
    }
  }, [selected, mutate]);

  const cols: Column<LocalPosMachine>[] = [
    {
      key: "_select",
      header: "",
      align: "center",
      render: (r) => (
        <input
          type="checkbox"
          checked={selected.has(r.id)}
          onChange={() => toggleSelect(r.id)}
          className="h-4 w-4 cursor-pointer rounded border-ink-300 text-brand-600 focus:ring-brand-400"
        />
      ),
    },
    { key: "tid", header: "TID", render: (r) => <span className="font-mono text-xs font-semibold">{r.tid ?? "—"}</span> },
    { key: "serial", header: "Serial No.", render: (r) => <span className="font-mono text-xs">{r.serial ?? "—"}</span> },
    { key: "mid", header: "MID", render: (r) => <span className="font-mono text-xs">{r.mid ?? "—"}</span> },
    { key: "model", header: "Model", render: (r) => r.model ?? "—" },
    { key: "location", header: "Location", render: (r) => r.location || "—" },
    { key: "status", header: "Status", render: (r) => machineBadge(r.status) },
    {
      key: "assignee",
      header: "Assigned To",
      render: (r) =>
        r.assignee ? (
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-ink-900">{r.assignee.name}</span>
            <span className="text-[11px] uppercase tracking-wide text-ink-400">{r.assignee.role.toLowerCase()}</span>
          </div>
        ) : (
          <Badge variant="default">Unassigned</Badge>
        ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      render: (r) => {
        const busy = unassigning.has(r.id);
        return (
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setAssignTargets([r])}>
              <UserPlus className="h-3.5 w-3.5" /> {r.assignee ? "Reassign" : "Assign"}
            </Button>
            {r.assignee && (
              <Button variant="ghost" size="sm" isLoading={busy} onClick={() => setUnassignTarget(r)} title="Unassign">
                {!busy && <UserMinus className="h-3.5 w-3.5" />}
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="min-w-0 space-y-6">
      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Total Machines" value={stats ? String(stats.total) : "..."} icon={CreditCard} accent="violet" />
        <StatCard label="Assigned" value={stats ? String(stats.assigned) : "..."} icon={Monitor} accent="brand" />
        <StatCard label="Unassigned" value={stats ? String(stats.unassigned) : "..."} icon={ArrowLeftRight} accent="emerald" />
      </div>

      {/* Fleet by user */}
      {byUser.length > 0 && (
        <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="font-display text-sm font-semibold text-ink-900">Fleet by user</h3>
              <p className="text-xs text-ink-500">
                Machines held by each user and their outstanding rental dues. Click a user to filter the inventory.
              </p>
            </div>
            {filteredUser && (
              <button
                onClick={() => { setAssigneeFilter("all"); setPage(1); }}
                className="flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100"
              >
                <X className="h-3 w-3" /> Showing {filteredUser.name}
              </button>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {byUser.map((u) => {
              const active = assigneeFilter === u.userId;
              return (
                <button
                  key={u.userId}
                  onClick={() => {
                    setAssigneeFilter(active ? "all" : u.userId);
                    setPage(1);
                  }}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                    active
                      ? "border-brand-300 bg-brand-50/70 ring-1 ring-brand-300"
                      : "border-ink-100 bg-ink-50/40 hover:border-brand-200 hover:bg-brand-50/40"
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ink-900">{u.name}</div>
                    <div className="truncate text-[11px] uppercase tracking-wide text-ink-400">
                      {u.role ? u.role.replace(/_/g, " ").toLowerCase() : "—"}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end">
                    <span className="text-sm font-bold text-ink-900">
                      {u.machineCount} <span className="text-[11px] font-medium text-ink-400">machine{u.machineCount === 1 ? "" : "s"}</span>
                    </span>
                    {u.outstandingDues > 0 ? (
                      <span className="text-[11px] font-semibold text-rose-600">{formatINR(u.outstandingDues)} due</span>
                    ) : (
                      <span className="text-[11px] text-emerald-600">No dues</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr,170px,170px,auto]">
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-semibold text-ink-500">Search</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input
                type="text"
                placeholder="TID, serial, MID..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="w-full rounded-lg border border-ink-200 py-2 pl-9 pr-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
              />
            </div>
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-semibold text-ink-500">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="maintenance">Maintenance</option>
              <option value="decommissioned">Decommissioned</option>
            </select>
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-semibold text-ink-500">Assignment</label>
            <select
              value={assigneeFilter}
              onChange={(e) => { setAssigneeFilter(e.target.value); setPage(1); }}
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
            >
              <option value="all">All machines</option>
              <option value="assigned">Assigned</option>
              <option value="unassigned">Unassigned</option>
              {filteredUser && <option value={filteredUser.userId}>{filteredUser.name}</option>}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <span className="mb-2 hidden items-center gap-1.5 text-xs font-medium text-emerald-600 sm:flex" title="This list refreshes every 5s; inventory auto-syncs from the partner every 10 min.">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Live
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={syncing}
              title="Inventory auto-syncs from the partner every 10 min and this list refreshes live. Click to pull from the partner now."
            >
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              <span className="ml-1 hidden sm:inline">Sync now</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Bulk action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-100 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={togglePage}
            className="flex items-center gap-2 text-sm font-semibold text-brand-700 hover:text-brand-800"
          >
            <input
              type="checkbox"
              readOnly
              checked={allOnPageSelected}
              className="pointer-events-none h-4 w-4 rounded border-ink-300 text-brand-600"
            />
            {allOnPageSelected ? "Deselect page" : "Select page"}
          </button>
          <span className="text-sm text-ink-500">
            {selected.size > 0 ? `${selected.size} machine${selected.size === 1 ? "" : "s"} selected` : "Select machines for bulk actions"}
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={selected.size === 0 || bulkBusy}
            onClick={() => {
              const chosen = machines.filter((m) => selected.has(m.id));
              // Selected rows may live on other pages; the API only needs IDs,
              // so pass placeholders for those.
              const missing = Array.from(selected).filter((id) => !chosen.some((m) => m.id === id));
              setAssignTargets([
                ...chosen,
                ...missing.map((id) => ({ id } as LocalPosMachine)),
              ]);
            }}
          >
            <UserPlus className="h-3.5 w-3.5" /> Bulk assign
          </Button>
          <Button variant="outline" size="sm" disabled={selected.size === 0 || bulkBusy} onClick={() => setRecallOpen(true)}>
            {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Bulk recall
          </Button>
          {selected.size > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      {error ? (
        <ErrorBanner message={error instanceof Error ? error.message : "Failed to load POS machines."} />
      ) : (
        <DataTable
          title="Terminal Inventory"
          description={
            pagination
              ? `${pagination.total} terminal${pagination.total === 1 ? "" : "s"} · page ${pagination.page} of ${pagination.totalPages}`
              : "Loading..."
          }
          columns={cols}
          data={machines}
          loading={(isLoading || syncing) && machines.length === 0}
          loadingRows={8}
          empty={
            syncing
              ? "Syncing machines from Same Day…"
              : "No POS machines found. Click Sync to pull the latest inventory."
          }
        />
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <Paginator
          page={pagination.page}
          totalPages={pagination.totalPages}
          hasPrev={pagination.hasPrev}
          hasNext={pagination.hasNext}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => p + 1)}
        />
      )}

      {assignTargets.length > 0 && (
        <AssignModal
          machines={assignTargets}
          onClose={() => setAssignTargets([])}
          onAssigned={() => { setAssignTargets([]); setSelected(new Set()); mutate(); }}
        />
      )}

      <ConfirmDialog
        open={unassignTarget !== null}
        onClose={() => setUnassignTarget(null)}
        busy={unassignTarget ? unassigning.has(unassignTarget.id) : false}
        title="Unassign terminal?"
        description={
          unassignTarget && (
            <>
              <span className="font-mono font-semibold text-ink-900">{unassignTarget.tid ?? unassignTarget.externalId}</span>
              {" "}will be taken back from{" "}
              <span className="font-semibold text-ink-900">{unassignTarget.assignee?.name ?? "the current holder"}</span>
              {" "}and returned to stock. Any active rental subscription on it will be cancelled.
            </>
          )
        }
        confirmLabel="Unassign"
        onConfirm={async () => {
          if (!unassignTarget) return;
          await handleUnassign(unassignTarget);
          setUnassignTarget(null);
        }}
      />

      <ConfirmDialog
        open={recallOpen}
        onClose={() => setRecallOpen(false)}
        busy={bulkBusy}
        title={`Recall ${selected.size} machine${selected.size === 1 ? "" : "s"} to stock?`}
        description="Selected terminals will be unassigned from their holders and returned to inventory."
        confirmLabel="Recall"
        input={{ label: "Return reason (optional)", placeholder: "Defective / merchant closed / upgrade..." }}
        onConfirm={async (reason) => {
          await handleBulkRecall(reason);
          setRecallOpen(false);
        }}
      />
    </div>
  );
}

// ── Assign modal: search a user and assign the machine ──
// Rental plans & subscriptions are managed exclusively in the POS Rental tab.

type UserSearchResult = { id: string; name: string; role: string; city: string; shop: string };

function AssignModal({
  machines,
  onClose,
  onAssigned,
}: {
  machines: LocalPosMachine[];
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [q, setQ] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);

  const single = machines.length === 1 ? machines[0] : null;

  const { data, isLoading } = useSWR<{ users: UserSearchResult[] }>(
    `/api/admin/users?role=all&q=${encodeURIComponent(q)}&pageSize=10`,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true }
  );

  const users = data?.users ?? [];

  const assign = useCallback(async () => {
    if (!selectedUser) return;
    setSubmitting(true);
    setErr(null);

    try {
      if (single) {
        const res = await fetch("/api/admin/pos/machines/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ machineId: single.id, userId: selectedUser.id }),
        });
        const d = await res.json();
        if (!res.ok) {
          setErr(typeof d.error === "string" ? d.error : "Assignment failed");
          setSubmitting(false);
          return;
        }
        toast.success(`Terminal assigned to ${selectedUser.name}`);
      } else {
        const res = await fetch("/api/admin/pos/machines/bulk-assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ machineIds: machines.map((m) => m.id), userId: selectedUser.id }),
        });
        const d = await res.json();
        if (!res.ok) {
          setErr(typeof d.error === "string" ? d.error : "Bulk assignment failed");
          setSubmitting(false);
          return;
        }
        if (d.failedCount > 0) {
          toast.warning(`Assigned ${d.succeededCount} of ${d.total}`, {
            description: `Skipped: ${d.failed.map((f: { label: string; error: string }) => `${f.label} (${f.error})`).join(", ")}`,
          });
        } else {
          toast.success(`${d.succeededCount} terminal${d.succeededCount === 1 ? "" : "s"} assigned to ${selectedUser.name}`);
        }
      }
      onAssigned();
    } catch {
      setErr("Assignment request failed");
      setSubmitting(false);
    }
  }, [single, machines, onAssigned, selectedUser]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-ink-100 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <div>
            <h3 className="font-display text-base font-semibold text-ink-900">
              {single ? "Assign terminal" : `Bulk assign ${machines.length} terminals`}
            </h3>
            <p className="text-xs text-ink-500">
              {single
                ? `${single.tid ? `TID ${single.tid}` : single.externalId}${single.assignee ? ` · currently with ${single.assignee.name}` : ""}`
                : "All selected machines will move to the chosen user."}
            </p>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[80vh] overflow-y-auto p-5">
          {/* Step 1: Select any network user (RT / DT / MD / SD) */}
          {!selectedUser ? (
            <>
              <p className="mb-3 text-xs text-ink-500">
                Assign to any network user — <span className="font-semibold text-brand-700">Retailer, Distributor, Master-Distributor or Super-Distributor</span>. The terminal (and its transactions) stays visible up the chain to their uplines, and the assignee&apos;s scheme drives MDR &amp; the commission split.
              </p>
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <input
                  autoFocus
                  type="text"
                  placeholder="Search users by name, shop, city, code..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="w-full rounded-lg border border-ink-200 py-2 pl-9 pr-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
                />
              </div>

              {err && (
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  <AlertCircle className="h-4 w-4 shrink-0" /> {err}
                </div>
              )}

              <div className="max-h-72 divide-y divide-ink-100 overflow-y-auto rounded-lg border border-ink-100">
                {isLoading && users.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-ink-500">Loading users…</div>
                ) : users.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-ink-500">No users found.</div>
                ) : (
                  users.map((u) => {
                    const isCurrent = single ? u.id === single.assignedUserId : false;
                    return (
                      <button
                        key={u.id}
                        disabled={isCurrent}
                        onClick={() => setSelectedUser(u)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-brand-50/50 disabled:opacity-50"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-ink-900">{u.name}</div>
                          <div className="truncate text-xs text-ink-500">
                            {u.role} · {u.shop !== "—" ? u.shop : u.city}
                          </div>
                        </div>
                        {isCurrent ? (
                          <Badge variant="success"><Check className="h-3 w-3" /> Current</Badge>
                        ) : (
                          <UserPlus className="h-4 w-4 shrink-0 text-brand-600" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            <>
              {/* Step 2: Confirm assignment */}
              <div className="mb-4 flex items-center justify-between rounded-lg bg-brand-50 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-brand-900">{selectedUser.name}</div>
                  <div className="text-xs text-brand-700">{selectedUser.role} · {selectedUser.shop !== "—" ? selectedUser.shop : selectedUser.city}</div>
                </div>
                <button onClick={() => setSelectedUser(null)} className="text-xs font-semibold text-brand-600 hover:text-brand-800">
                  Change
                </button>
              </div>

              {err && (
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  <AlertCircle className="h-4 w-4 shrink-0" /> {err}
                </div>
              )}

              <div className="mb-4 rounded-lg border border-ink-100 bg-ink-50/50 px-4 py-3 text-xs text-ink-500">
                Only the machine assignment is done here. To set up a rental plan &amp; monthly subscription, use the{" "}
                <span className="font-semibold text-brand-700">POS Rental</span> tab after assigning.
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={assign} disabled={submitting}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {single ? "Assign" : `Assign ${machines.length} machines`}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TRANSACTIONS TAB — refreshes every 1 second
// ═══════════════════════════════════════════════════════════════════════

function TransactionsTab() {
  const today = todayRange();
  const defaults = defaultDateRange();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [statusFilter, setStatusFilter] = useState<PosTransactionStatus | "">("");
  const [modeFilter, setModeFilter] = useState<PosPaymentMode | "">("");
  const [terminalFilter, setTerminalFilter] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [slipTxn, setSlipTxn] = useState<PosTransaction | null>(null);

  const body = {
    date_from: `${dateFrom}T00:00:00.000Z`,
    date_to: `${dateTo}T23:59:59.999Z`,
    status: statusFilter || null,
    payment_mode: modeFilter || null,
    terminal_id: terminalFilter || null,
    page,
    page_size: 50,
  };

  const { data, error, isLoading, mutate } = useSWR<PosTransactionsResponse>(
    ["/api/pos/transactions", body],
    postFetcher,
    {
      // 5s keeps the feed feeling live without saturating the partner API —
      // each poll is a full proxy round trip that competes with other requests.
      refreshInterval: (latest) => (latest ? 5000 : 0),
      refreshWhenHidden: false,
      revalidateOnFocus: false,
      keepPreviousData: true,
      shouldRetryOnError: true,
      errorRetryCount: 2,
      errorRetryInterval: 8000,
    }
  );

  // Total machine count from our local inventory — not the partner's
  // transaction-scoped terminal_count which only includes terminals with txns.
  const { data: machineStats } = useSWR<{ stats?: { total: number } }>(
    "/api/admin/pos/machines?page=1&pageSize=1",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  );
  const totalMachines = machineStats?.stats?.total;

  const handleExport = useCallback(async (format: "csv" | "pdf" | "zip") => {
    setExporting(true);
    try {
      const res = await fetch("/api/pos/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, date_from: dateFrom, date_to: dateTo, status: statusFilter || null, terminal_id: terminalFilter || null }),
      });
      const data = await res.json();
      if (data.data?.job_id) {
        toast.info("Export started — the file will open when ready.");
        pollExport(data.data.job_id);
      } else {
        toast.error(data.error ?? "Export failed");
        setExporting(false);
      }
    } catch {
      toast.error("Export request failed");
      setExporting(false);
    }
  }, [dateFrom, dateTo, statusFilter, terminalFilter]);

  const pollExport = useCallback(async (jobId: string) => {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await fetch(`/api/pos/export-status/${jobId}`);
        const d = await res.json();
        if (d.data?.job?.status === "COMPLETED" && d.data.job.file_url) {
          const fileUrl = d.data.job.file_url;
          try {
            const blob = await fetch(fileUrl).then((r) => r.blob());
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `pos-export-${jobId}.${fileUrl.includes(".zip") ? "zip" : fileUrl.includes(".pdf") ? "pdf" : "csv"}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          } catch {
            const a = document.createElement("a");
            a.href = fileUrl;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }
          toast.success("Export ready — download started.");
          setExporting(false);
          return;
        }
        if (d.data?.job?.status === "FAILED") {
          toast.error("Export failed. Please try again.");
          setExporting(false);
          return;
        }
      } catch { break; }
    }
    toast.warning("Export is taking longer than expected.");
    setExporting(false);
  }, []);

  const transactions = data?.data ?? [];
  const summary = data?.summary;
  const pagination = data?.pagination;

  const cols: Column<PosTransaction>[] = [
    { key: "txn_time", header: "Time", render: (r) => <span className="text-xs">{fmtTime(r.txn_time)}</span> },
    { key: "terminal_id", header: "TID", render: (r) => <span className="font-mono text-xs font-semibold">{r.terminal_id}</span> },
    { key: "retailer", header: "Retailer", render: (r) => r.retailer ? (
      <div className="flex flex-col">
        <span className="text-xs font-semibold text-ink-900 truncate max-w-[130px]">{r.retailer.shopName || r.retailer.name}</span>
        {r.retailer.userCode && <span className="text-[11px] font-medium text-brand-600">{r.retailer.userCode}</span>}
      </div>
    ) : <span className="text-xs text-ink-400">—</span> },
    { key: "payment_mode", header: "Mode", render: (r) => <Badge variant="default">{r.payment_mode}</Badge> },
    { key: "card_brand", header: "Card", render: (r) => r.payment_mode === "CARD" ? `${r.card_brand} ${r.card_type}` : "—" },
    { key: "card_classification", header: "Classification", render: (r) => r.card_classification ? <Badge variant="accent">{r.card_classification}</Badge> : "—" },
    { key: "amount", header: "Amount", align: "right", render: (r) => <span className="font-semibold text-ink-900">{formatINR(parseFloat(r.amount))}</span> },
    { key: "status", header: "Status", render: (r) => statusBadge(r.status) },
    { key: "customer_name", header: "Customer", render: (r) => <span className="max-w-[140px] truncate block text-xs">{cleanName(r.customer_name)}</span> },
    { key: "card_number", header: "Card No.", render: (r) => r.card_number ? <span className="font-mono text-xs">{r.card_number}</span> : "—" },
    { key: "rrn", header: "RRN", render: (r) => <span className="font-mono text-xs">{r.rrn}</span> },
    { key: "auth_code", header: "Auth Code", render: (r) => <span className="font-mono text-xs">{r.auth_code}</span> },
    { key: "actions", header: "", align: "center", render: (r) => (
      <button onClick={() => setSlipTxn(r)} className="grid h-7 w-7 place-items-center rounded-lg text-brand-600 hover:bg-brand-50" title="View slip">
        <Eye className="h-4 w-4" />
      </button>
    )},
  ];

  return (
    <div className="min-w-0 space-y-6">
      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Transactions" value={summary ? String(summary.total_transactions) : "..."} icon={ArrowLeftRight} accent="brand" />
        <StatCard label="Total Volume" value={summary ? formatINR(parseFloat(summary.total_amount)) : "..."} icon={IndianRupee} accent="emerald" />
        <StatCard label="Captured" value={summary ? String(summary.captured_count) : "..."} icon={CreditCard} accent="violet" />
        <StatCard label="Total Terminals" value={totalMachines != null ? String(totalMachines) : "..."} icon={Monitor} accent="accent" />
      </div>

      {/* Live indicator + filters */}
      <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <span className="text-xs font-semibold text-emerald-700">Live — auto-refreshing</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handleExport("csv")} disabled={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleExport("pdf")} disabled={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleExport("zip")} disabled={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} ZIP
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-semibold text-ink-500">From</label>
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400" />
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-semibold text-ink-500">To</label>
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400" />
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-semibold text-ink-500">Status</label>
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as PosTransactionStatus | ""); setPage(1); }}
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400">
              <option value="">All</option>
              <option value="CAPTURED">Captured</option>
              <option value="AUTHORIZED">Authorized</option>
              <option value="FAILED">Failed</option>
              <option value="REFUNDED">Refunded</option>
              <option value="VOIDED">Voided</option>
            </select>
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-semibold text-ink-500">Mode</label>
            <select value={modeFilter} onChange={(e) => { setModeFilter(e.target.value as PosPaymentMode | ""); setPage(1); }}
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400">
              <option value="">All</option>
              <option value="CARD">Card</option>
              <option value="UPI">UPI</option>
              <option value="NFC">NFC</option>
              <option value="BHARATQR">BharatQR</option>
            </select>
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-semibold text-ink-500">Terminal</label>
            <input type="text" placeholder="TID..." value={terminalFilter}
              onChange={(e) => { setTerminalFilter(e.target.value); setPage(1); }}
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400" />
          </div>
          <div className="flex min-w-0 items-end">
            <Button variant="outline" size="sm" className="w-full" onClick={() => { setDateFrom(today.from); setDateTo(today.to); setPage(1); }}>
              Today
            </Button>
          </div>
        </div>
      </div>

      {/* Table */}
      {error ? (
        <ErrorBanner message={error instanceof Error ? error.message : "Failed to load transactions."} />
      ) : (
        <DataTable
          title="POS Transactions"
          description={
            pagination
              ? `${pagination.total_records} total · page ${pagination.page} of ${pagination.total_pages}`
              : isLoading
                ? "Loading..."
                : "No data yet"
          }
          columns={cols}
          data={transactions}
          loading={isLoading && transactions.length === 0}
          loadingRows={8}
          empty="No transactions for the selected filters."
        />
      )}

      {/* Pagination */}
      {pagination && pagination.total_pages > 1 && (
        <Paginator
          page={pagination.page}
          totalPages={pagination.total_pages}
          hasPrev={pagination.has_prev}
          hasNext={pagination.has_next}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => p + 1)}
        />
      )}

      {/* Transaction Slip Drawer */}
      {slipTxn && <TxnSlipDrawer txn={slipTxn} onClose={() => setSlipTxn(null)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TRANSACTION SLIP DRAWER
// ═══════════════════════════════════════════════════════════════════════

function TxnSlipDrawer({ txn, onClose }: { txn: PosTransaction; onClose: () => void }) {
  const retailerLabel = txn.retailer
    ? `${txn.retailer.shopName || txn.retailer.name}${txn.retailer.userCode ? ` (${txn.retailer.userCode})` : ""}`
    : null;

  const rows: [string, string | null][] = [
    ["Transaction ID", txn.razorpay_txn_id],
    ["External Ref", txn.external_ref],
    ["Terminal ID", txn.terminal_id],
    ["Retailer", retailerLabel],
    ["MID", txn.mid],
    ["Device Serial", txn.device_serial],
    ["Amount", `₹${parseFloat(txn.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`],
    ["Status", txn.status],
    ["Payment Mode", txn.payment_mode],
    ["Card Brand", txn.card_brand],
    ["Card Type", txn.card_type],
    ["Card Classification", txn.card_classification],
    ["Card Number", txn.card_number],
    ["Issuing Bank", txn.issuing_bank],
    ["Acquiring Bank", txn.acquiring_bank],
    ["RRN", txn.rrn],
    ["Auth Code", txn.auth_code],
    ["Customer", txn.customer_name?.replace(/\s*\/\s*$/, "") || null],
    ["Payer Name", txn.payer_name || null],
    ["Transaction Time", new Date(txn.txn_time).toLocaleString("en-IN")],
    ["Posting Date", txn.posting_date ? new Date(txn.posting_date).toLocaleDateString("en-IN") : null],
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-100 bg-white px-6 py-4">
          <h2 className="font-display text-lg font-bold text-ink-900">Transaction Slip</h2>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-6">
          <div className="mb-4 text-center">
            <div className="text-2xl font-bold text-ink-900">₹{parseFloat(txn.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
            <Badge variant={txn.status === "CAPTURED" ? "success" : txn.status === "FAILED" ? "danger" : "warning"} className="mt-1">
              {txn.status}
            </Badge>
          </div>
          <div className="divide-y divide-ink-100 rounded-xl border border-ink-100">
            {rows.map(([label, value]) => value ? (
              <div key={label} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="text-xs font-medium text-ink-500">{label}</span>
                <span className="text-right text-xs font-semibold text-ink-900">{value}</span>
              </div>
            ) : null)}
          </div>
          {txn.receipt_url && (
            <a href={txn.receipt_url} target="_blank" rel="noopener noreferrer"
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-100">
              <Download className="h-4 w-4" /> Download Receipt
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TRACKING REPORT TAB — assignment / return history across the fleet
// ═══════════════════════════════════════════════════════════════════════

type TrackingUser = { id: string; name: string; role: string; userCode: string | null };

type TrackingEntry = {
  id: string;
  machineId: string;
  tid: string | null;
  serial: string | null;
  mid: string | null;
  model: string | null;
  externalId: string | null;
  action: string;
  status: string;
  fromUser: TrackingUser | null;
  toUser: TrackingUser | null;
  byUser: TrackingUser | null;
  holder: TrackingUser | null;
  assignedDate: string | null;
  transitDate: string | null;
  deliveredDate: string | null;
  returnedDate: string | null;
  returnReason: string | null;
  note: string | null;
  createdAt: string;
};

type TrackingResponse = {
  entries: TrackingEntry[];
  summary: { assignments: number; returns: number; reassignments: number; active: number };
  pagination: { page: number; pageSize: number; total: number; totalPages: number; hasPrev: boolean; hasNext: boolean };
};

function fmtDateOnly(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function trackingActionBadge(entry: TrackingEntry) {
  if (entry.action === "assign") {
    return entry.fromUser
      ? <Badge variant="warning">Reassigned</Badge>
      : <Badge variant="brand">Assigned</Badge>;
  }
  return <Badge variant="default">Returned to stock</Badge>;
}

function roleLabel(role: string | null | undefined) {
  if (!role) return "";
  return role
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("-");
}

function fmtDayHeading(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

// Local calendar day key (Asia/Kolkata) so grouping matches the printed date.
function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

type HolderGroup = { key: string; holder: TrackingUser | null; entries: TrackingEntry[] };
type DayGroup = { key: string; label: string; count: number; groups: HolderGroup[] };

// Fold a chronologically-ordered (newest-first) movement list into a
// Date → Holder logbook, preserving order within each level.
function groupByDayAndHolder(entries: TrackingEntry[]): DayGroup[] {
  const days = new Map<string, DayGroup>();
  for (const e of entries) {
    const dKey = dayKey(e.createdAt);
    let day = days.get(dKey);
    if (!day) {
      day = { key: dKey, label: fmtDayHeading(e.createdAt), count: 0, groups: [] };
      days.set(dKey, day);
    }
    day.count += 1;
    const hKey = e.holder?.id ?? "__stock__";
    let group = day.groups.find((g) => g.key === hKey);
    if (!group) {
      group = { key: hKey, holder: e.holder, entries: [] };
      day.groups.push(group);
    }
    group.entries.push(e);
  }
  return [...days.values()];
}

function TrackingTab() {
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [editTarget, setEditTarget] = useState<TrackingEntry | null>(null);

  const params = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (q) params.set("q", q);
  if (action) params.set("action", action);
  if (status) params.set("status", status);
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const { data, error, isLoading, mutate } = useSWR<TrackingResponse>(
    `/api/admin/pos/history?${params}`,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true }
  );

  const entries = data?.entries ?? [];
  const summary = data?.summary;
  const pagination = data?.pagination;

  const exportFile = useCallback((fmt: "csv" | "zip") => {
    const p = new URLSearchParams(params);
    p.set("format", fmt);
    p.delete("page");
    p.delete("pageSize");
    window.open(`/api/admin/pos/history?${p}`, "_blank");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, action, status, from, to]);

  const dayGroups = groupByDayAndHolder(entries);

  return (
    <div className="min-w-0 space-y-6">
      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Assignments" value={summary ? String(summary.assignments) : "..."} icon={ArrowRight} accent="brand" />
        <StatCard label="Returns" value={summary ? String(summary.returns) : "..."} icon={RotateCcw} accent="accent" />
        <StatCard label="Reassignments" value={summary ? String(summary.reassignments) : "..."} icon={ArrowLeftRight} accent="violet" />
        <StatCard label="Active holdings" value={summary ? String(summary.active) : "..."} icon={CheckCircle2} accent="emerald" />
      </div>

      {/* Filters */}
      <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="col-span-2 min-w-0 sm:col-span-1 lg:col-span-2">
            <label className="mb-1 block text-xs font-semibold text-ink-500">Search machine</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input
                type="text"
                placeholder="TID, serial, MID..."
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }}
                className="w-full rounded-lg border border-ink-200 py-2 pl-9 pr-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
              />
            </div>
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-semibold text-ink-500">Movement</label>
            <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400">
              <option value="">All</option>
              <option value="assign">Assignments</option>
              <option value="unassign">Returns</option>
            </select>
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-semibold text-ink-500">Holding</label>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400">
              <option value="">All</option>
              <option value="ACTIVE">Active</option>
              <option value="RETURNED">Returned</option>
            </select>
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-semibold text-ink-500">From</label>
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }}
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400" />
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-semibold text-ink-500">To</label>
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }}
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400" />
          </div>
        </div>
      </div>

      {/* Grouped logbook: Date → Holder → movements */}
      {error ? (
        <ErrorBanner message={error instanceof Error ? error.message : "Failed to load tracking history."} />
      ) : (
        <div className="rounded-2xl border border-ink-100 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
            <div>
              <h3 className="font-display text-base font-semibold text-ink-900">POS Tracking History</h3>
              <p className="text-xs text-ink-500">
                {pagination
                  ? `${pagination.total} movement${pagination.total === 1 ? "" : "s"} · page ${pagination.page} of ${pagination.totalPages} · grouped by date, then by holder`
                  : "Loading..."}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => exportFile("csv")}>
                <Download className="h-4 w-4" /> CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => exportFile("zip")}>
                <Download className="h-4 w-4" /> ZIP
              </Button>
            </div>
          </div>

          {isLoading && entries.length === 0 ? (
            <div className="flex items-center justify-center gap-2 px-5 py-16 text-sm text-ink-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading movements…
            </div>
          ) : dayGroups.length === 0 ? (
            <div className="px-5 py-16 text-center text-sm text-ink-400">
              No movements recorded yet. Assign a machine to start the trail.
            </div>
          ) : (
            <div className="divide-y divide-ink-100">
              {dayGroups.map((day) => (
                <section key={day.key}>
                  <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-ink-100 bg-ink-50/80 px-5 py-2.5 backdrop-blur">
                    <div className="flex items-center gap-2">
                      <History className="h-4 w-4 text-ink-400" />
                      <span className="text-sm font-semibold text-ink-800">{day.label}</span>
                    </div>
                    <span className="text-[11px] font-medium text-ink-400">
                      {day.count} movement{day.count === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="divide-y divide-ink-100">
                    {day.groups.map((group) => (
                      <div key={`${day.key}-${group.key}`} className="px-5 py-3">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className={group.holder ? "text-sm font-semibold text-ink-900" : "text-sm font-semibold text-ink-400"}>
                            {group.holder?.name ?? "Stock / Unassigned"}
                          </span>
                          {group.holder?.userCode && (
                            <span className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[11px] text-ink-600">
                              {group.holder.userCode}
                            </span>
                          )}
                          {group.holder?.role && (
                            <span className="text-[11px] uppercase tracking-wide text-ink-400">
                              {roleLabel(group.holder.role)}
                            </span>
                          )}
                          <span className="text-[11px] text-ink-400">
                            · {group.entries.length} item{group.entries.length === 1 ? "" : "s"}
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {group.entries.map((e) => (
                            <TrackingRow key={e.id} entry={e} onEdit={() => setEditTarget(e)} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <Paginator
          page={pagination.page}
          totalPages={pagination.totalPages}
          hasPrev={pagination.hasPrev}
          hasNext={pagination.hasNext}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => p + 1)}
        />
      )}

      {editTarget && (
        <MilestoneModal
          entry={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); mutate(); }}
        />
      )}
    </div>
  );
}

// ── One movement row inside a holder group (all detail for the record) ──

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">{label}</div>
      <div className="truncate text-xs text-ink-700">{children}</div>
    </div>
  );
}

function TrackingRow({ entry: r, onEdit }: { entry: TrackingEntry; onEdit: () => void }) {
  const holdingBadge =
    r.status === "ACTIVE" ? (
      <Badge variant="success"><CheckCircle2 className="h-3 w-3" /> Active</Badge>
    ) : r.status === "RETURNED" ? (
      <Badge variant="warning"><RotateCcw className="h-3 w-3" /> Returned</Badge>
    ) : (
      <Badge variant="default">Event</Badge>
    );

  return (
    <div className="rounded-xl border border-ink-100 bg-ink-50/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {trackingActionBadge(r)}
          {holdingBadge}
          <span className="text-[11px] text-ink-400">{fmtTime(r.createdAt)}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onEdit} title="Update dispatch milestones">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
        <DetailField label="Machine">
          <span className="font-mono font-semibold text-ink-900">{r.tid ?? r.serial ?? "—"}</span>
          {r.model && <span className="text-ink-400"> · {r.model}</span>}
        </DetailField>
        <DetailField label="Serial / MID">
          <span className="font-mono">{r.serial ?? "—"}</span>
          {r.mid && <span className="text-ink-400"> · {r.mid}</span>}
        </DetailField>
        <DetailField label="From → To">
          <span className="flex items-center gap-1">
            <span className={r.fromUser ? "text-ink-800" : "text-ink-400"}>
              {r.fromUser ? `${r.fromUser.name}${r.fromUser.userCode ? ` (${r.fromUser.userCode})` : ""}` : "Stock"}
            </span>
            <ArrowRight className="h-3 w-3 shrink-0 text-ink-400" />
            <span className={r.toUser ? "text-ink-800" : "text-ink-400"}>
              {r.toUser ? `${r.toUser.name}${r.toUser.userCode ? ` (${r.toUser.userCode})` : ""}` : "Stock"}
            </span>
          </span>
        </DetailField>
        <DetailField label="Performed by">
          {r.byUser ? `${r.byUser.name}${r.byUser.role ? ` · ${roleLabel(r.byUser.role)}` : ""}` : "—"}
        </DetailField>
        <DetailField label="Assigned on">{fmtDateOnly(r.assignedDate) ?? "—"}</DetailField>
        <DetailField label="In transit">
          <span className={r.transitDate ? "text-blue-600" : "text-ink-400"}>
            <Truck className="mr-1 inline h-3 w-3" />
            {fmtDateOnly(r.transitDate) ?? "—"}
          </span>
        </DetailField>
        <DetailField label="Delivered">
          <span className={r.deliveredDate ? "text-emerald-600" : "text-ink-400"}>
            <PackageCheck className="mr-1 inline h-3 w-3" />
            {fmtDateOnly(r.deliveredDate) ?? "—"}
          </span>
        </DetailField>
        <DetailField label="Returned">
          <span className={r.returnedDate ? "text-amber-600" : "text-ink-400"}>
            <RotateCcw className="mr-1 inline h-3 w-3" />
            {fmtDateOnly(r.returnedDate) ?? "—"}
          </span>
        </DetailField>
        <div className="col-span-2 min-w-0 sm:col-span-3 lg:col-span-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">Return reason</div>
          <div className="truncate text-xs text-ink-700" title={r.returnReason ?? ""}>{r.returnReason ?? "—"}</div>
        </div>
        <div className="col-span-2 min-w-0 sm:col-span-3 lg:col-span-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">Notes</div>
          <div className="truncate text-xs text-ink-700" title={r.note ?? ""}>{r.note ?? "—"}</div>
        </div>
      </div>
    </div>
  );
}

// ── Milestone modal: update transit / delivered dates + return reason ──

function MilestoneModal({
  entry,
  onClose,
  onSaved,
}: {
  entry: TrackingEntry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [transit, setTransit] = useState(entry.transitDate?.slice(0, 10) ?? "");
  const [delivered, setDelivered] = useState(entry.deliveredDate?.slice(0, 10) ?? "");
  const [reason, setReason] = useState(entry.returnReason ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = useCallback(async () => {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/pos/history", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: entry.id,
          transitDate: transit ? new Date(`${transit}T00:00:00.000+05:30`).toISOString() : null,
          deliveredDate: delivered ? new Date(`${delivered}T00:00:00.000+05:30`).toISOString() : null,
          returnReason: reason.trim() || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setErr(typeof d.error === "string" ? d.error : "Update failed");
        setSaving(false);
        return;
      }
      onSaved();
    } catch {
      setErr("Update request failed");
      setSaving(false);
    }
  }, [entry.id, transit, delivered, reason, onSaved]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-ink-100 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <div>
            <h3 className="font-display text-base font-semibold text-ink-900">Dispatch milestones</h3>
            <p className="text-xs text-ink-500">{entry.tid ? `TID ${entry.tid}` : entry.serial ?? entry.machineId}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {err && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              <AlertCircle className="h-4 w-4 shrink-0" /> {err}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-500">
              <Truck className="mr-1 inline h-3.5 w-3.5" /> In transit since
            </label>
            <input type="date" value={transit} onChange={(e) => setTransit(e.target.value)}
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-500">
              <PackageCheck className="mr-1 inline h-3.5 w-3.5" /> Delivered on
            </label>
            <input type="date" value={delivered} onChange={(e) => setDelivered(e.target.value)}
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-500">
              <RotateCcw className="mr-1 inline h-3.5 w-3.5" /> Return reason
            </label>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Defective / merchant closed / upgrade..."
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Shared small components ──

function Paginator({ page, totalPages, hasPrev, hasNext, onPrev, onNext }: {
  page: number; totalPages: number; hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-center gap-3">
      <Button variant="outline" size="sm" disabled={!hasPrev} onClick={onPrev}>
        <ChevronLeft className="h-4 w-4" /> Previous
      </Button>
      <span className="text-sm text-ink-600">Page {page} of {totalPages}</span>
      <Button variant="outline" size="sm" disabled={!hasNext} onClick={onNext}>
        Next <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
      <AlertCircle className="h-4 w-4 shrink-0" />
      {message} Check your connection and POS credentials.
    </div>
  );
}
