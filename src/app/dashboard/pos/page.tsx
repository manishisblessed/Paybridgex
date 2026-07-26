"use client";

import { useState, useCallback, useMemo } from "react";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  Monitor,
  IndianRupee,
  ArrowLeftRight,
  CreditCard,
  RefreshCw,
  Download,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  Wrench,
  RotateCcw,
  Banknote,
  Zap,
  Clock,
  Gift,
  Trophy,
  PartyPopper,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { StatCard } from "@/components/dashboard/StatCard";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn, formatINR } from "@/lib/utils";
import { type ReportColumn } from "@/lib/reports";
import { ReportActions } from "@/components/dashboard/ReportActions";
import type {
  PosTransactionsResponse,
  PosTransaction,
  PosTransactionStatus,
  PosPaymentMode,
  LocalPosMachine,
  MyPosMachinesResponse,
  PosTerminalTreeResponse,
  TerminalTreeMember,
  TerminalTreeTerminal,
} from "@/lib/partners/sameday-pos.types";

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

type Tab = "machines" | "transactions" | "settlements" | "free-rent";

export default function PosPage() {
  const { data: authSession } = useSession();
  const isRetailer = (authSession?.user as { role?: string } | undefined)?.role === "RETAILER";
  const [activeTab, setActiveTab] = useState<Tab>("transactions");

  const tabs = useMemo(() => {
    const base: { id: Tab; label: string; icon: typeof ArrowLeftRight }[] = [
      { id: "transactions", label: "Live Transactions", icon: ArrowLeftRight },
      { id: "settlements", label: "Instant Settlement", icon: Banknote },
      { id: "machines", label: "POS Machines", icon: Monitor },
    ];
    if (isRetailer) base.push({ id: "free-rent", label: "Free Rent Target", icon: Gift });
    return base;
  }, [isRetailer]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Point of Sale"
        title="POS Terminals"
        description="Live terminals and per-second transactions from your POS machines — powered by Same Day Solution."
        actions={
          <Button variant="outline">
            <Wrench className="h-4 w-4" /> Raise service request
          </Button>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-ink-100 bg-ink-50/60 p-1">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              "flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all",
              activeTab === id
                ? "bg-white text-ink-900 shadow-sm"
                : "text-ink-500 hover:text-ink-700"
            )}
          >
            <span className="flex items-center justify-center gap-2"><Icon className="h-4 w-4" /> {label}</span>
          </button>
        ))}
      </div>

      {activeTab === "transactions" ? (
        <TransactionsTab />
      ) : activeTab === "settlements" ? (
        <SettlementsTab />
      ) : activeTab === "free-rent" ? (
        <FreeRentTab />
      ) : (
        <MachinesTab />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// FREE RENT TARGET TAB — per-machine progress toward waived rent (retailer)
// ═══════════════════════════════════════════════════════════════════════

type RentalTargetMachine = {
  subscriptionId: string;
  machine: { id: string; serial: string | null; tid: string | null; model: string | null };
  planName: string;
  billingDay: number;
  rent: number;
  businessDone: number;
  target: number;
  remaining: number;
  achieved: boolean;
  progress: number;
  cycleStart: string;
  nextBilling: string;
};

type RentalTargetResponse = {
  enabled: boolean;
  target: number;
  machines: RentalTargetMachine[];
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function FreeRentTab() {
  const { data, error, isLoading, mutate } = useSWR<RentalTargetResponse>(
    "/api/pos/rental-target",
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 30000 }
  );

  const machines = data?.machines ?? [];
  const enabled = data?.enabled ?? false;
  const achievedCount = machines.filter((m) => m.achieved).length;
  const totalSaved = machines.filter((m) => m.achieved).reduce((s, m) => s + m.rent, 0);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Machines on target" value={`${achievedCount}/${machines.length}`} icon={Trophy} accent="emerald" />
        <StatCard label="Rent waived this cycle" value={formatINR(totalSaved)} icon={Gift} accent="brand" />
        <StatCard label="Target per machine" value={data ? formatINR(data.target) : "..."} icon={IndianRupee} accent="violet" />
        <StatCard label="Your machines" value={String(machines.length)} icon={Monitor} accent="accent" />
      </div>

      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => mutate()} title="Refresh">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {!enabled && (
        <div className="flex items-center gap-2 rounded-2xl border border-ink-200 bg-ink-50 p-4 text-sm text-ink-600">
          <AlertCircle className="h-4 w-4 shrink-0" />
          The free-rent programme is currently paused. Your progress is still tracked and shown below.
        </div>
      )}

      {error ? (
        <ErrorBanner message={error instanceof Error ? error.message : "Failed to load your rent target."} />
      ) : isLoading ? (
        <div className="flex items-center gap-2 rounded-2xl border border-ink-100 bg-white p-6 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your machines...
        </div>
      ) : machines.length === 0 ? (
        <div className="flex items-center gap-2 rounded-2xl border border-ink-200 bg-ink-50 p-4 text-sm text-ink-600">
          <AlertCircle className="h-4 w-4 shrink-0" />
          You have no active POS rental subscriptions yet.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {machines.map((m) => (
            <RentTargetCard key={m.subscriptionId} m={m} />
          ))}
        </div>
      )}
    </>
  );
}

function RentTargetCard({ m }: { m: RentalTargetMachine }) {
  const label = m.machine.tid ? `TID ${m.machine.tid}` : m.machine.serial ?? m.machine.id.slice(0, 8);
  const pct = Math.round(m.progress * 100);

  if (m.achieved) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs font-semibold text-ink-700">{label}</p>
            <p className="text-[11px] text-ink-400">{m.machine.model ?? m.planName}</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white">
            <PartyPopper className="h-3.5 w-3.5" /> Rent FREE
          </span>
        </div>

        <div className="mt-4 flex items-center gap-2 text-emerald-700">
          <Trophy className="h-5 w-5" />
          <p className="text-sm font-bold">Congratulations — target achieved!</p>
        </div>
        <p className="mt-1 text-xs text-ink-600">
          This machine did <span className="font-semibold text-ink-900">{formatINR(m.businessDone)}</span> of business
          this cycle. Its <span className="font-semibold text-ink-900">{formatINR(m.rent)}</span> rent is waived —
          nothing will be debited on {fmtDate(m.nextBilling)}.
        </p>

        <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-emerald-100">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: "100%" }} />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-ink-500">
          <span>{formatINR(m.businessDone)}</span>
          <span>Target {formatINR(m.target)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs font-semibold text-ink-700">{label}</p>
          <p className="text-[11px] text-ink-400">{m.machine.model ?? m.planName}</p>
        </div>
        <span className="rounded-full bg-ink-100 px-3 py-1 text-xs font-semibold text-ink-600">{pct}%</span>
      </div>

      <p className="mt-4 text-sm text-ink-700">
        Do <span className="font-bold text-brand-700">{formatINR(m.remaining)}</span> more business before{" "}
        <span className="font-semibold text-ink-900">{fmtDate(m.nextBilling)}</span> to get this machine&apos;s{" "}
        <span className="font-semibold text-ink-900">{formatINR(m.rent)}</span> rent free.
      </p>

      <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-ink-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all"
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-ink-500">
        <span>{formatINR(m.businessDone)} done</span>
        <span>Target {formatINR(m.target)}</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MACHINES TAB
// ═══════════════════════════════════════════════════════════════════════

function MachinesTab() {
  const { data: authSession } = useSession();
  const currentUserId = authSession?.user?.id ?? "";
  const currentUserName = authSession?.user?.name ?? "";
  const [page, setPage] = useState(1);
  const [recallingId, setRecallingId] = useState<string | null>(null);
  const [recallTarget, setRecallTarget] = useState<LocalPosMachine | null>(null);

  const { data, error, isLoading, mutate } = useSWR<MyPosMachinesResponse>(
    `/api/pos/my-machines?page=${page}&pageSize=50`,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true }
  );

  const machines = data?.data ?? [];
  const pagination = data?.pagination;
  const stats = data?.stats;

  const handleRecall = useCallback(async (machine: LocalPosMachine) => {
    const label = machine.tid ?? machine.serial ?? machine.id.slice(0, 8);
    setRecallingId(machine.id);

    // Optimistic update: immediately show the machine as owned by the caller
    // so the UI feels instant. SWR revalidates in the background.
    mutate(
      (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          data: prev.data.map((m) =>
            m.id === machine.id
              ? { ...m, assignedUserId: currentUserId, assignee: { id: currentUserId, name: currentUserName, phone: "", role: "" } }
              : m,
          ),
        };
      },
      { revalidate: false },
    );

    try {
      const res = await fetch("/api/network/pos/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machineId: machine.id, childId: null, returnReason: "Recalled by network parent" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof d.error === "string" ? d.error : "Recall failed");
        mutate(); // rollback optimistic update
      } else {
        toast.success(`${label} recalled to your account`);
        mutate(); // sync with server
      }
    } catch {
      toast.error("Recall request failed");
      mutate(); // rollback
    } finally {
      setRecallingId(null);
    }
  }, [mutate, currentUserId, currentUserName]);

  const cols: Column<LocalPosMachine>[] = [
    { key: "tid", header: "TID", render: (r) => <span className="font-mono text-xs font-semibold">{r.tid ?? "—"}</span> },
    { key: "serial", header: "Serial No.", render: (r) => <span className="font-mono text-xs">{r.serial ?? "—"}</span> },
    { key: "mid", header: "MID", render: (r) => <span className="font-mono text-xs">{r.mid ?? "—"}</span> },
    { key: "model", header: "Model", render: (r) => r.model ?? "—" },
    { key: "location", header: "Location", render: (r) => r.location || "—" },
    { key: "city", header: "City", render: (r) => r.city || "—" },
    { key: "status", header: "Status", render: (r) => machineBadge(r.status) },
    {
      key: "assignee",
      header: "Assigned To",
      render: (r) => {
        if (!r.assignee) return "—";
        const isChild = r.assignedUserId !== currentUserId;
        return (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-ink-700">{r.assignee.name}</span>
            {isChild && (
              <button
                onClick={() => setRecallTarget(r)}
                disabled={recallingId === r.id}
                title={`Recall from ${r.assignee.name}`}
                className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-50"
              >
                {recallingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                Recall
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Active Terminals" value={stats ? String(stats.active) : "..."} icon={Monitor} accent="brand" />
        <StatCard label="Total Machines" value={stats ? String(stats.total) : "..."} icon={CreditCard} accent="violet" />
        <StatCard label="On This Page" value={String(machines.length)} icon={ArrowLeftRight} accent="emerald" />
      </div>

      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => mutate()} title="Refresh">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {error ? (
        <ErrorBanner message={error instanceof Error ? error.message : "Failed to load POS machines."} />
      ) : (
        <DataTable
          title="My Terminals"
          description={pagination ? `${pagination.total} terminal${pagination.total === 1 ? "" : "s"} assigned to your account` : "Loading..."}
          columns={cols}
          data={machines}
          loading={isLoading}
          empty="No POS machines assigned to your account yet."
        />
      )}

      {pagination && pagination.totalPages > 1 && (
        <Paginator page={pagination.page} totalPages={pagination.totalPages}
          hasPrev={pagination.hasPrev} hasNext={pagination.hasNext}
          onPrev={() => setPage((p) => Math.max(1, p - 1))} onNext={() => setPage((p) => p + 1)} />
      )}

      <ConfirmDialog
        open={recallTarget !== null}
        onClose={() => setRecallTarget(null)}
        busy={recallTarget ? recallingId === recallTarget.id : false}
        title="Recall this terminal?"
        description={
          recallTarget && (
            <>
              <span className="font-mono font-semibold text-ink-900">
                {recallTarget.tid ?? recallTarget.serial ?? recallTarget.id.slice(0, 8)}
              </span>{" "}
              will be taken back from{" "}
              <span className="font-semibold text-ink-900">
                {recallTarget.assignee?.name ?? "the assigned user"}
              </span>{" "}
              and returned to you.
            </>
          )
        }
        confirmLabel="Recall"
        onConfirm={async () => {
          if (!recallTarget) return;
          await handleRecall(recallTarget);
          setRecallTarget(null);
        }}
      />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TRANSACTIONS TAB — refreshes every 1 second
// ═══════════════════════════════════════════════════════════════════════

const NETWORK_ROLES = ["SUPER_DISTRIBUTOR", "MASTER_DISTRIBUTOR", "DISTRIBUTOR", "RETAILER"] as const;
const ROLE_LABELS: Record<string, string> = {
  MASTER_DISTRIBUTOR: "Master Distributor",
  DISTRIBUTOR: "Distributor",
  RETAILER: "Retailer",
};

function getSubtreeIds(rootId: string, members: TerminalTreeMember[]): Set<string> {
  const result = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const m of members) {
      if (m.parentId === cur && !result.has(m.id)) {
        result.add(m.id);
        queue.push(m.id);
      }
    }
  }
  return result;
}

function TransactionsTab() {
  const today = todayRange();
  const defaults = defaultDateRange();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [statusFilter, setStatusFilter] = useState<PosTransactionStatus | "">("");
  const [modeFilter, setModeFilter] = useState<PosPaymentMode | "">("");
  const [terminalFilter, setTerminalFilter] = useState("");
  const [hierSelections, setHierSelections] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);

  // Fetch the network hierarchy + terminal data for cascading filters.
  const { data: treeData } = useSWR<PosTerminalTreeResponse>(
    "/api/pos/terminal-tree",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  );

  const callerRole = treeData?.callerRole ?? "";
  const members = treeData?.members ?? [];
  const allTerminals = treeData?.terminals ?? [];

  // Which hierarchy tiers should appear as cascading dropdowns.
  const filterTiers = useMemo(() => {
    const idx = NETWORK_ROLES.indexOf(callerRole as typeof NETWORK_ROLES[number]);
    if (idx < 0) return [];
    return NETWORK_ROLES.slice(idx + 1) as unknown as string[];
  }, [callerRole]);

  // For each tier, compute visible members based on the selection at the tier above.
  const tierOptions = useMemo(() => {
    const result: Record<string, TerminalTreeMember[]> = {};
    for (let i = 0; i < filterTiers.length; i++) {
      const tier = filterTiers[i];
      const membersAtTier = members.filter((m) => m.role === tier);

      if (i === 0) {
        result[tier] = membersAtTier;
      } else {
        const prevTier = filterTiers[i - 1];
        const prevSel = hierSelections[prevTier];
        if (!prevSel) {
          // No selection at parent tier → show all ancestors' options filtered
          // by any selection higher in the chain.
          let scope: Set<string> | null = null;
          for (let j = i - 2; j >= 0; j--) {
            const sel = hierSelections[filterTiers[j]];
            if (sel) {
              scope = getSubtreeIds(sel, members);
              scope.add(sel);
              break;
            }
          }
          result[tier] = scope
            ? membersAtTier.filter((m) => scope!.has(m.id) || (m.parentId && scope!.has(m.parentId)))
            : membersAtTier;
        } else {
          const subtree = getSubtreeIds(prevSel, members);
          subtree.add(prevSel);
          result[tier] = membersAtTier.filter((m) => m.parentId && subtree.has(m.parentId));
        }
      }
    }
    return result;
  }, [filterTiers, members, hierSelections]);

  // The deepest hierarchy selection drives terminal filtering.
  const effectiveScope = useMemo(() => {
    for (let i = filterTiers.length - 1; i >= 0; i--) {
      const sel = hierSelections[filterTiers[i]];
      if (sel) return sel;
    }
    return null;
  }, [filterTiers, hierSelections]);

  // Terminals matching the current hierarchy scope.
  const filteredTerminals = useMemo(() => {
    if (!effectiveScope) return allTerminals;
    const scopeIds = getSubtreeIds(effectiveScope, members);
    scopeIds.add(effectiveScope);
    return allTerminals.filter((t) => t.ownerId && scopeIds.has(t.ownerId));
  }, [allTerminals, effectiveScope, members]);

  // Auto-select when exactly one terminal matches.
  const activeTerminal = terminalFilter || (filteredTerminals.length === 1 ? filteredTerminals[0].tid : "");
  const hasNoTerminals = treeData != null && allTerminals.length === 0;
  const needsTerminalSelection = !hasNoTerminals && filteredTerminals.length > 1 && !activeTerminal;

  // Earliest visible date for the selected terminal (assignment time).
  const activeTerminalData = activeTerminal
    ? allTerminals.find((t) => t.tid === activeTerminal)
    : null;
  const assignedAtDate = activeTerminalData?.assignedAt
    ? activeTerminalData.assignedAt.slice(0, 10)
    : null;
  const clampedDateFrom = assignedAtDate && dateFrom < assignedAtDate
    ? assignedAtDate
    : dateFrom;

  const body = {
    date_from: `${clampedDateFrom}T00:00:00.000Z`,
    date_to: `${dateTo}T23:59:59.999Z`,
    status: statusFilter || null,
    payment_mode: modeFilter || null,
    terminal_id: activeTerminal || null,
    page,
    page_size: 50,
  };

  // Only fetch transactions when we have tree data loaded and a terminal selected.
  const canFetchTxn = treeData != null && !!activeTerminal && !needsTerminalSelection;

  const { data, error, isLoading } = useSWR<PosTransactionsResponse>(
    canFetchTxn ? ["/api/pos/transactions", body] : null,
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

  const handleHierChange = useCallback(
    (tier: string, value: string) => {
      setHierSelections((prev) => {
        const next = { ...prev };
        next[tier] = value;
        const idx = filterTiers.indexOf(tier);
        for (let i = idx + 1; i < filterTiers.length; i++) delete next[filterTiers[i]];
        // Clean empty selections
        for (const k of Object.keys(next)) if (!next[k]) delete next[k];
        return next;
      });
      setTerminalFilter("");
      setPage(1);
    },
    [filterTiers]
  );

  const transactions = data?.data ?? [];
  const summary = data?.summary;
  const pagination = data?.pagination;

  const posExportCols: ReportColumn<PosTransaction>[] = [
    { key: "txn_time", header: "Time", render: (r) => r.txn_time ? new Date(r.txn_time).toLocaleString("en-IN") : "" },
    { key: "terminal_id", header: "TID" },
    { key: "customer_name", header: "Customer" },
    { key: "payment_mode", header: "Mode" },
    { key: "card_brand", header: "Card Brand" },
    { key: "card_type", header: "Card Type" },
    { key: "card_number", header: "Card No" },
    { key: "card_classification", header: "Classification" },
    { key: "amount", header: "Amount (INR)" },
    { key: "status", header: "Status" },
    { key: "rrn", header: "RRN" },
    { key: "auth_code", header: "Auth Code" },
  ];

  // Fetches EVERY transaction matching the current filters so downloads are
  // complete (the server paginates the partner feed), not just this page.
  // Uses the same day boundaries as the live feed so "Today" includes today.
  const fetchAllRows = useCallback(async (): Promise<PosTransaction[]> => {
    const res = await fetch("/api/pos/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date_from: `${clampedDateFrom}T00:00:00.000Z`,
        date_to: `${dateTo}T23:59:59.999Z`,
        status: statusFilter || null,
        payment_mode: modeFilter || null,
        terminal_id: activeTerminal || null,
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast.error(typeof d.error === "string" ? d.error : "Failed to build report");
      return transactions;
    }
    const d = await res.json();
    if (d.truncated) {
      toast.warning(`Report capped at ${Number(d.returned).toLocaleString("en-IN")} rows — narrow the date range for the rest.`);
    }
    return (d.rows as PosTransaction[]) ?? [];
  }, [clampedDateFrom, dateTo, statusFilter, modeFilter, activeTerminal, transactions]);

  const reportSubtitle =
    `${dateFrom} to ${dateTo}` +
    (statusFilter ? ` · ${statusFilter}` : "") +
    (activeTerminal ? ` · TID ${activeTerminal}` : "");

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
  ];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Transactions" value={summary ? String(summary.total_transactions) : "..."} icon={ArrowLeftRight} accent="brand" />
        <StatCard label="Total Volume" value={summary ? formatINR(parseFloat(summary.total_amount)) : "..."} icon={IndianRupee} accent="emerald" />
        <StatCard label="Captured" value={summary ? String(summary.captured_count) : "..."} icon={CreditCard} accent="violet" />
        <StatCard label="Terminals" value={allTerminals.length ? String(allTerminals.length) : "..."} icon={Monitor} accent="accent" />
      </div>

      {/* Network hierarchy cascading filters */}
      {filterTiers.length > 0 && members.length > 0 && (
        <div className="rounded-2xl border border-ink-100 bg-white p-4">
          <p className="mb-3 text-xs font-semibold text-ink-500">Filter by network</p>
          <div className="flex flex-wrap items-end gap-3">
            {filterTiers.map((tier) => {
              const opts = tierOptions[tier] ?? [];
              if (opts.length === 0) return null;
              return (
                <div key={tier}>
                  <label className="mb-1 block text-xs font-semibold text-ink-500">
                    {ROLE_LABELS[tier] ?? tier}
                  </label>
                  <select
                    value={hierSelections[tier] ?? ""}
                    onChange={(e) => handleHierChange(tier, e.target.value)}
                    className="rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
                  >
                    <option value="">All</option>
                    {opts.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              );
            })}

            {filteredTerminals.length > 1 && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-500">Terminal</label>
                <select
                  value={terminalFilter}
                  onChange={(e) => { setTerminalFilter(e.target.value); setPage(1); }}
                  className="rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
                >
                  <option value="">Select terminal</option>
                  {filteredTerminals.map((t) => (
                    <option key={t.tid} value={t.tid}>
                      {t.tid}{t.location ? ` — ${t.location}` : t.model ? ` — ${t.model}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Live indicator + Date / Status / Mode filters */}
      <div className="rounded-2xl border border-ink-100 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <span className="text-xs font-semibold text-emerald-700">Live — auto-refreshing</span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-500">From</label>
            <input type="date" value={dateFrom} min={assignedAtDate ?? undefined}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400" />
            {assignedAtDate && dateFrom < assignedAtDate && (
              <p className="mt-1 text-[10px] text-amber-600">
                Clamped to assignment date ({new Date(assignedAtDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })})
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-500">To</label>
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-500">Status</label>
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as PosTransactionStatus | ""); setPage(1); }}
              className="rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400">
              <option value="">All</option>
              <option value="CAPTURED">Captured</option>
              <option value="AUTHORIZED">Authorized</option>
              <option value="FAILED">Failed</option>
              <option value="REFUNDED">Refunded</option>
              <option value="VOIDED">Voided</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-500">Mode</label>
            <select value={modeFilter} onChange={(e) => { setModeFilter(e.target.value as PosPaymentMode | ""); setPage(1); }}
              className="rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400">
              <option value="">All</option>
              <option value="CARD">Card</option>
              <option value="UPI">UPI</option>
              <option value="NFC">NFC</option>
              <option value="BHARATQR">BharatQR</option>
            </select>
          </div>
          {/* Terminal picker for roles with no hierarchy (retailer) or no tree data yet */}
          {filterTiers.length === 0 && filteredTerminals.length > 1 && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-500">Terminal</label>
              <select value={terminalFilter} onChange={(e) => { setTerminalFilter(e.target.value); setPage(1); }}
                className="rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400">
                <option value="">Select terminal</option>
                {filteredTerminals.map((t) => (
                  <option key={t.tid} value={t.tid}>
                    {t.tid}{t.location ? ` — ${t.location}` : t.model ? ` — ${t.model}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => { setDateFrom(today.from); setDateTo(today.to); setPage(1); }}>
            Today
          </Button>
          <div className="ml-auto flex flex-wrap gap-2">
            <ReportActions<PosTransaction>
              filename={`pos-transactions-${dateFrom}-to-${dateTo}`}
              title="POS Transactions Report"
              subtitle={reportSubtitle}
              columns={posExportCols}
              rows={transactions}
              fetchRows={fetchAllRows}
            />
          </div>
        </div>
      </div>

      {hasNoTerminals ? (
        <div className="flex items-center gap-2 rounded-2xl border border-ink-200 bg-ink-50 p-4 text-sm text-ink-600">
          <AlertCircle className="h-4 w-4 shrink-0" />
          No POS terminals are assigned to your account yet.
        </div>
      ) : needsTerminalSelection ? (
        <div className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Select one of your terminals to view its transactions.
        </div>
      ) : error ? (
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
          loading={isLoading}
          empty="No transactions for the selected filters."
        />
      )}

      {pagination && pagination.total_pages > 1 && (
        <Paginator page={pagination.page} totalPages={pagination.total_pages}
          hasPrev={pagination.has_prev} hasNext={pagination.has_next}
          onPrev={() => setPage((p) => Math.max(1, p - 1))} onNext={() => setPage((p) => p + 1)} />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SETTLEMENTS TAB — instant-settle chosen captures now; rest auto-settle T+1
// ═══════════════════════════════════════════════════════════════════════

type PendingSettlement = {
  id: string;
  transactionRef: string;
  grossAmount: number;
  paymentMode: string | null;
  capturedAt: string;
  t1: { mdrAmount: number; netAmount: number };
  instant: { mdrAmount: number; netAmount: number } | null;
};

function SettlementsTab() {
  const { data, error, isLoading, mutate } = useSWR<{ entries: PendingSettlement[]; instantEnabled?: boolean }>(
    "/api/pos/settlement/pending",
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 15000 }
  );

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const instantEnabled = data?.instantEnabled ?? false;
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Only entries with a resolvable instant quote can be instantly settled.
  const settleable = useMemo(() => entries.filter((e) => e.instant !== null), [entries]);
  const selectedEntries = useMemo(
    () => settleable.filter((e) => selected[e.id]),
    [settleable, selected]
  );
  const allSelected = settleable.length > 0 && selectedEntries.length === settleable.length;

  const totalInstantNet = selectedEntries.reduce((s, e) => s + (e.instant?.netAmount ?? 0), 0);
  const totalInstantFee = selectedEntries.reduce(
    (s, e) => s + (e.instant ? e.instant.mdrAmount : 0),
    0
  );

  function toggle(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }
  function toggleAll() {
    if (allSelected) {
      setSelected({});
    } else {
      const next: Record<string, boolean> = {};
      for (const e of settleable) next[e.id] = true;
      setSelected(next);
    }
  }

  async function runInstantSettle() {
    const ids = selectedEntries.map((e) => e.id);
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/pos/settlement/instant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryIds: ids }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof d.error === "string" ? d.error : "Instant settlement failed");
        return;
      }
      toast.success(
        `Settled ${d.settled} transaction${d.settled === 1 ? "" : "s"} · ${formatINR(d.totalAmount)} credited to your wallet.`
      );
      if (d.failed > 0) toast.warning(`${d.failed} could not be settled and will auto-settle T+1.`);
      setSelected({});
      mutate();
    } catch {
      toast.error("Network error — refresh before retrying to avoid duplicates.");
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  const cols: Column<PendingSettlement>[] = [
    {
      key: "id",
      header: allSelected ? "✓" : "",
      render: (r) =>
        instantEnabled && r.instant ? (
          <input
            type="checkbox"
            checked={!!selected[r.id]}
            onChange={() => toggle(r.id)}
            className="h-4 w-4 accent-brand-600"
          />
        ) : (
          <span title="Will auto-settle T+1" className="text-ink-300">—</span>
        ),
    },
    { key: "capturedAt", header: "Captured", render: (r) => <span className="text-xs">{fmtTime(r.capturedAt)}</span> },
    { key: "transactionRef", header: "Ref", render: (r) => <span className="font-mono text-xs">{r.transactionRef.slice(-12)}</span> },
    { key: "paymentMode", header: "Mode", render: (r) => <Badge variant="default">{r.paymentMode ?? "—"}</Badge> },
    { key: "grossAmount", header: "Amount", align: "right", render: (r) => <span className="font-semibold">{formatINR(r.grossAmount)}</span> },
    {
      key: "instant",
      header: "Instant (now)",
      align: "right",
      render: (r) =>
        r.instant ? (
          <div>
            <div className="font-semibold text-emerald-700">{formatINR(r.instant.netAmount)}</div>
            <div className="text-[10px] text-ink-500">fee {formatINR(r.instant.mdrAmount)}</div>
          </div>
        ) : (
          <span className="text-xs text-ink-400">—</span>
        ),
    },
    {
      key: "t1",
      header: "T+1 (tomorrow)",
      align: "right",
      render: (r) => (
        <div>
          <div className="font-medium text-ink-700">{formatINR(r.t1.netAmount)}</div>
          <div className="text-[10px] text-ink-500">fee {formatINR(r.t1.mdrAmount)}</div>
        </div>
      ),
    },
  ];

  const pendingTotal = entries.reduce((s, e) => s + e.grossAmount, 0);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Unsettled transactions" value={String(entries.length)} icon={Clock} accent="accent" />
        <StatCard label="Unsettled amount" value={formatINR(pendingTotal)} icon={IndianRupee} accent="brand" />
        <StatCard label="Selected" value={String(selectedEntries.length)} icon={Zap} accent="violet" />
        <StatCard label="Instant payout (selected)" value={formatINR(totalInstantNet)} icon={Banknote} accent="emerald" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => mutate()} title="Refresh">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
        {instantEnabled && settleable.length > 0 && (
          <Button variant="ghost" size="sm" onClick={toggleAll}>
            {allSelected ? "Clear selection" : "Select all"}
          </Button>
        )}
        {instantEnabled && (
          <div className="ml-auto flex items-center gap-3">
            {selectedEntries.length > 0 && (
              <span className="text-xs text-ink-600">
                {selectedEntries.length} selected · fee {formatINR(totalInstantFee)} · you get{" "}
                <span className="font-semibold text-emerald-700">{formatINR(totalInstantNet)}</span>
              </span>
            )}
            <Button
              size="sm"
              disabled={selectedEntries.length === 0 || busy}
              onClick={() => setConfirmOpen(true)}
            >
              <Zap className="h-4 w-4" /> Instant settle
            </Button>
          </div>
        )}
      </div>

      {instantEnabled ? (
        <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-3 text-xs text-ink-600">
          Pick the transactions you want paid out <strong>now</strong> — they&apos;re credited instantly at your
          scheme&apos;s instant rate. Everything you leave unselected settles automatically on the next day (T+1)
          at your standard rate. A transaction is only ever settled once.
        </div>
      ) : (
        <div className="rounded-xl border border-ink-100 bg-ink-50/60 p-3 text-xs text-ink-600">
          Instant settlement is currently <strong>disabled</strong>. Your captured transactions settle automatically
          on the next day (T+1) at your standard rate — no action needed.
        </div>
      )}

      {error ? (
        <ErrorBanner message={error instanceof Error ? error.message : "Failed to load settlements."} />
      ) : (
        <DataTable
          title="Unsettled POS proceeds"
          description="Captured transactions awaiting settlement to your wallet."
          columns={cols}
          data={entries}
          loading={isLoading}
          empty="Nothing to settle — all your captured transactions are settled."
        />
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        busy={busy}
        title={`Instant settle ${selectedEntries.length} transaction${selectedEntries.length === 1 ? "" : "s"}?`}
        description={
          <>
            <span className="font-semibold text-ink-900">{formatINR(totalInstantNet)}</span> will be credited to
            your wallet now (instant fee {formatINR(totalInstantFee)}). This cannot be undone, and these
            transactions will not settle again on T+1.
          </>
        }
        confirmLabel="Settle now"
        onConfirm={runInstantSettle}
      />
    </>
  );
}

// ── Shared ──

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
