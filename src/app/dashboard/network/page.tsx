"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Search, Filter, PackagePlus, RefreshCw, ShieldCheck, ShieldOff, Loader2,
  Wallet, ArrowUpDown, Monitor, Layers, X, Check, AlertCircle, Eye,
  Link2, Copy, Share2, Send, Pencil, Trash2, Clock, MailPlus, ListChecks,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input, Select } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { ReportActions } from "@/components/dashboard/ReportActions";
import { Pagination } from "@/components/ui/Pagination";
import { useSession } from "next-auth/react";
import { useAuth } from "@/lib/useAuth";
import { formatINR } from "@/lib/utils";
import {
  OnboardingProgressView,
  type OnboardingProgress,
} from "@/components/network/OnboardingProgressView";

type NetworkUser = {
  id: string;
  userCode: string | null;
  name: string;
  shop: string;
  role: "retailer" | "distributor" | "master-distributor" | "super-distributor";
  city: string;
  state: string;
  joined: string;
  status: "Active" | "Pending KYC" | "Suspended" | "Closed";
  walletBalance: number;
  monthlyTurnover: number;
  retailers: number;
  schemeId: string | null;
  schemeName: string | null;
};

type PendingInvite = {
  id: string;
  name: string | null;
  phone: string;
  email: string;
  role: string;
  status: "PENDING" | "EXPIRED";
  createdAt: string;
  expiresAt: string;
  onboardingLink: string;
};

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Onboarding link copied");
  } catch {
    toast.error("Could not copy link");
  }
}

async function shareInviteLink(link: string, name?: string | null) {
  if (typeof navigator !== "undefined" && "share" in navigator) {
    try {
      await navigator.share({
        title: "Paybridgex Onboarding",
        text: name ? `Onboarding link for ${name}` : "Complete your onboarding",
        url: link,
      });
      return;
    } catch {
      // dismissed / unsupported — fall back to copy
    }
  }
  await copyText(link);
}

function daysLeftLabel(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

/** Labels for the direct downline each network tier manages. */
const CHILD_META = {
  "super-distributor": {
    child: "master-distributor",
    singular: "master distributor",
    plural: "master distributors",
    header: "Master Distributor",
    eyebrow: "Network tree",
    title: "Master distributors under you",
    description:
      "Direct master distributors. Override commissions, top-up wallets, freeze or graduate accounts.",
    hasDownline: true,
  },
  "master-distributor": {
    child: "distributor",
    singular: "distributor",
    plural: "distributors",
    header: "Distributor",
    eyebrow: "Network tree",
    title: "Distributors under you",
    description:
      "Direct distributors. Override commissions, top-up wallets, freeze or graduate accounts.",
    hasDownline: true,
  },
  distributor: {
    child: "retailer",
    singular: "retailer",
    plural: "retailers",
    header: "Retailer",
    eyebrow: "My retailers",
    title: "Retailers under you",
    description:
      "Retailers in your network. Approve fund requests, set commissions, and watch turnover.",
    hasDownline: false,
  },
} as const;

export default function NetworkPage() {
  const { session } = useAuth();
  const { data: authSession } = useSession();
  const currentUserId = authSession?.user?.id ?? "";
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [users, setUsers] = useState<NetworkUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<{ user: NetworkUser; action: "wallet" | "pos" | "scheme" } | null>(null);
  const [statusTarget, setStatusTarget] = useState<NetworkUser | null>(null);

  const role: keyof typeof CHILD_META =
    session?.role === "super-distributor" ? "super-distributor" :
    session?.role === "master-distributor" ? "master-distributor" :
    "distributor";

  const meta = CHILD_META[role];

  const fetchNetwork = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (status !== "all") params.set("status", status);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const res = await fetch(`/api/network?${params}`);
      const data = await res.json();
      if (data.users) {
        setUsers(data.users);
        setTotal(data.total ?? data.users.length);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [q, status, page]);

  useEffect(() => {
    setPage(1);
  }, [q, status]);

  useEffect(() => {
    const t = setTimeout(fetchNetwork, 300);
    return () => clearTimeout(t);
  }, [fetchNetwork]);

  const toggleStatus = useCallback(async (row: NetworkUser, reason?: string) => {
    const suspending = row.status !== "Suspended";
    setTogglingId(row.id);
    setToggleError(null);
    try {
      const res = await fetch(`/api/network/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: suspending ? "suspend" : "activate", reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToggleError(data.error ?? "Could not update account status.");
      } else {
        await fetchNetwork();
      }
    } catch {
      setToggleError("Network error — please try again.");
    } finally {
      setTogglingId(null);
    }
  }, [fetchNetwork]);

  const cols: Column<NetworkUser>[] = [
    {
      key: "name",
      header: meta.header,
      render: (r) => (
        <Link href={`/dashboard/network/${r.id}`} className="group block">
          <div className="font-semibold text-ink-900 group-hover:text-brand-700 group-hover:underline">{r.name}</div>
          <div className="text-xs text-ink-500">{r.shop} · <span className="font-medium text-brand-600">{r.userCode ?? r.id.slice(0, 8)}</span></div>
        </Link>
      ),
    },
    { key: "city", header: "Location", render: (r) => `${r.city}, ${r.state}` },
    ...(meta.hasDownline
      ? [{ key: "retailers" as const, header: "Downline", align: "right" as const, render: (r: NetworkUser) => r.retailers ?? 0 }]
      : []),
    { key: "joined", header: "Joined" },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge variant={r.status === "Active" ? "success" : r.status === "Pending KYC" ? "warning" : "danger"}>
          {r.status}
        </Badge>
      ),
    },
    {
      key: "schemeName",
      header: "Scheme",
      render: (r) =>
        r.schemeName ? (
          <Badge variant="brand">{r.schemeName}</Badge>
        ) : (
          <span className="text-xs text-ink-400">None</span>
        ),
    },
    { key: "walletBalance", header: "Wallet", align: "right", render: (r) => formatINR(r.walletBalance) },
    { key: "monthlyTurnover", header: "MTD", align: "right", render: (r) => formatINR(r.monthlyTurnover) },
    {
      key: "actions",
      header: "Actions",
      render: (r) => {
        if (r.status === "Closed") return null;
        return (
          <div className="flex items-center gap-1">
            <Link
              href={`/dashboard/network/${r.id}`}
              title="View business, transactions & activity"
              className="rounded-lg p-1.5 text-ink-500 hover:bg-brand-50 hover:text-brand-700"
            >
              <Eye className="h-4 w-4" />
            </Link>
            <button
              onClick={() => setActionTarget({ user: r, action: "wallet" })}
              title="Push / Pull balance"
              className="rounded-lg p-1.5 text-ink-500 hover:bg-brand-50 hover:text-brand-700"
            >
              <Wallet className="h-4 w-4" />
            </button>
            <button
              onClick={() => setActionTarget({ user: r, action: "pos" })}
              title="Assign POS machine"
              className="rounded-lg p-1.5 text-ink-500 hover:bg-brand-50 hover:text-brand-700"
            >
              <Monitor className="h-4 w-4" />
            </button>
            <button
              onClick={() => setActionTarget({ user: r, action: "scheme" })}
              title="Assign commission scheme"
              className="rounded-lg p-1.5 text-ink-500 hover:bg-brand-50 hover:text-brand-700"
            >
              <Layers className="h-4 w-4" />
            </button>
          </div>
        );
      },
    },
    {
      key: "security",
      header: "Security",
      align: "right",
      render: (r) => {
        if (r.status === "Closed") return null;
        const busy = togglingId === r.id;
        const suspended = r.status === "Suspended";
        return (
          <button
            onClick={() => setStatusTarget(r)}
            disabled={busy}
            title={
              suspended
                ? "Reactivate this account"
                : "Freeze this account — blocks all transactions immediately"
            }
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
              suspended
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
            }`}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : suspended ? (
              <ShieldCheck className="h-3.5 w-3.5" />
            ) : (
              <ShieldOff className="h-3.5 w-3.5" />
            )}
            {suspended ? "Reactivate" : "Freeze"}
          </button>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={meta.eyebrow}
        title={meta.title}
        description={meta.description}
        actions={
          <>
            <ReportActions
              filename={`my-${meta.plural.replace(/ /g, "-")}`}
              title={`Paybridgex · My ${meta.plural.replace(/\b\w/g, (c) => c.toUpperCase())}`}
              subtitle={`${users.length} record${users.length === 1 ? "" : "s"}`}
              columns={[
                { key: "id", header: "Code" },
                { key: "name", header: "Name" },
                { key: "shop", header: "Shop / Firm" },
                { key: "city", header: "City" },
                { key: "state", header: "State" },
                { key: "joined", header: "Joined" },
                { key: "status", header: "Status" },
                { key: "walletBalance", header: "Wallet (INR)" },
                { key: "monthlyTurnover", header: "MTD Turnover (INR)" },
              ]}
              rows={users}
            />
            <Button variant="outline" onClick={fetchNetwork} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Link href="/dashboard/network/onboard">
              <Button>
                <PackagePlus className="h-4 w-4" />
                Onboard {meta.singular}
              </Button>
            </Link>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-ink-100 bg-white p-4">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, shop, ID..." className="pl-9" />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-ink-400" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 w-44">
            <option value="all">Any status</option>
            <option value="Active">Active</option>
            <option value="Pending KYC">Pending KYC</option>
            <option value="Suspended">Suspended</option>
          </Select>
        </div>
      </div>

      {toggleError && (
        <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <ShieldOff className="h-4 w-4 shrink-0" />
          {toggleError}
        </div>
      )}

      <PendingInvitesCard singular={meta.singular} onChanged={fetchNetwork} />

      <DataTable
        title={`${total} ${meta.plural}`}
        columns={cols}
        data={users}
        loading={loading}
        empty={`No ${meta.plural} in your network yet.`}
      />
      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />

      {actionTarget?.action === "wallet" && (
        <WalletTransferModal
          child={actionTarget.user}
          onClose={() => setActionTarget(null)}
          onDone={() => { setActionTarget(null); fetchNetwork(); }}
        />
      )}

      {actionTarget?.action === "pos" && (
        <PosAssignModal
          child={actionTarget.user}
          parentId={currentUserId}
          onClose={() => setActionTarget(null)}
          onDone={() => { setActionTarget(null); fetchNetwork(); }}
        />
      )}

      {actionTarget?.action === "scheme" && (
        <SchemeAssignModal
          child={actionTarget.user}
          onClose={() => setActionTarget(null)}
          onDone={() => { setActionTarget(null); fetchNetwork(); }}
        />
      )}

      <ConfirmDialog
        open={statusTarget !== null}
        onClose={() => setStatusTarget(null)}
        busy={statusTarget ? togglingId === statusTarget.id : false}
        tone={statusTarget?.status !== "Suspended" ? "danger" : "default"}
        title={
          statusTarget?.status !== "Suspended"
            ? `Freeze ${statusTarget?.name ?? "this account"}?`
            : `Reactivate ${statusTarget?.name ?? "this account"}?`
        }
        description={
          statusTarget?.status !== "Suspended"
            ? `This security freeze instantly blocks all transactions and logs the ${meta.singular} out everywhere.`
            : "They will be able to transact again."
        }
        confirmLabel={statusTarget?.status !== "Suspended" ? "Freeze account" : "Reactivate"}
        input={
          statusTarget?.status !== "Suspended"
            ? { label: "Reason (required)", placeholder: "Suspicious activity, chargeback…", required: true }
            : undefined
        }
        onConfirm={async (reason) => {
          if (!statusTarget) return;
          const suspending = statusTarget.status !== "Suspended";
          await toggleStatus(statusTarget, suspending ? reason : undefined);
          setStatusTarget(null);
        }}
      />
    </div>
  );
}

// ── Wallet push/pull modal ──

function WalletTransferModal({ child, onClose, onDone }: { child: NetworkUser; onClose: () => void; onDone: () => void }) {
  const [direction, setDirection] = useState<"PUSH" | "PULL">("PUSH");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { setErr("Enter a valid amount"); return; }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/network/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId: child.id, direction, amount: amt, note: note.trim() || undefined }),
      });
      const d = await res.json();
      if (!res.ok) {
        setErr(typeof d?.error === "string" ? d.error : "Transfer failed — please check the amount and details.");
        setBusy(false);
        return;
      }
      onDone();
    } catch { setErr("Request failed"); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-ink-100 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <div>
            <h3 className="font-display text-base font-semibold text-ink-900">Wallet transfer</h3>
            <p className="text-xs text-ink-500">{child.name} · Balance: {formatINR(child.walletBalance)}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-ink-400 hover:bg-ink-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 p-5">
          {err && <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"><AlertCircle className="h-4 w-4 shrink-0" /> {err}</div>}
          <div className="flex gap-2">
            {(["PUSH", "PULL"] as const).map((d) => (
              <button key={d} onClick={() => setDirection(d)}
                className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${direction === d ? "border-brand-300 bg-brand-50 text-brand-800" : "border-ink-100 bg-white text-ink-600 hover:border-ink-200"}`}>
                {d === "PUSH" ? "Push (credit child)" : "Pull (debit child)"}
              </button>
            ))}
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-500">Amount (₹)</label>
            <input type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000"
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-500">Note (optional)</label>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for transfer..."
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpDown className="h-4 w-4" />}
              {direction === "PUSH" ? "Push" : "Pull"} ₹{amount || "0"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── POS assign modal ──

function PosAssignModal({ child, parentId, onClose, onDone }: { child: NetworkUser; parentId: string; onClose: () => void; onDone: () => void }) {
  const [machines, setMachines] = useState<Array<{ id: string; tid: string | null; serial: string | null }>>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/pos/my-machines?pageSize=200")
      .then((r) => r.json())
      .then((machineData) => {
        const all = (machineData.data ?? []) as Array<{ id: string; tid: string | null; serial: string | null; assignedUserId?: string | null }>;
        // /api/pos/my-machines already scopes results to the caller + downline,
        // so every row is one the caller may act on. Show only machines the
        // caller currently holds (those they can hand down); if the session id
        // isn't populated yet (a render race), fall back to the full scoped
        // list. The assign API re-validates ownership server-side.
        const owned = all.filter((m) => m.assignedUserId === parentId);
        setMachines(parentId ? owned : all);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [parentId]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = machines.length > 0 && selected.size === machines.length;
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(machines.map((m) => m.id)));
  };

  const assign = async () => {
    if (selected.size === 0) { setErr("Select at least one machine to assign"); return; }
    setBusy(true);
    setErr(null);
    const succeeded = new Set<string>();
    let firstError: string | null = null;
    for (const id of selected) {
      try {
        const res = await fetch("/api/network/pos/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ machineId: id, childId: child.id }),
        });
        if (res.ok) {
          succeeded.add(id);
        } else {
          const d = await res.json().catch(() => ({}));
          if (!firstError) firstError = typeof d?.error === "string" ? d.error : "Assignment failed";
        }
      } catch {
        if (!firstError) firstError = "Request failed";
      }
    }
    setBusy(false);

    if (succeeded.size === selected.size) {
      onDone();
      return;
    }
    // Partial or full failure: drop the ones that succeeded, keep the modal open.
    setMachines((prev) => prev.filter((m) => !succeeded.has(m.id)));
    setSelected(new Set());
    setErr(
      succeeded.size > 0
        ? `Assigned ${succeeded.size} of ${selected.size}. ${firstError ?? "Some machines failed."}`
        : firstError ?? "Assignment failed",
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-ink-100 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <div>
            <h3 className="font-display text-base font-semibold text-ink-900">Assign POS to {child.name}</h3>
            <p className="text-xs text-ink-500">Select one or more machines to assign to your {child.role.replace(/-/g, " ")}. Configure rent later on the POS Rental page.</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-ink-400 hover:bg-ink-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[80vh] overflow-y-auto p-5">
          {err && <div className="mb-3 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"><AlertCircle className="h-4 w-4 shrink-0" /> {err}</div>}

          {loading ? (
            <div className="px-4 py-8 text-center text-sm text-ink-500">Loading machines…</div>
          ) : machines.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-ink-500">No machines available to assign. Machines must be assigned to you first.</div>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-ink-600">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll}
                    className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-400" />
                  Select all ({machines.length})
                </label>
                {selected.size > 0 && (
                  <span className="text-xs font-semibold text-brand-700">{selected.size} selected</span>
                )}
              </div>
              <div className="max-h-72 divide-y divide-ink-100 overflow-y-auto rounded-lg border border-ink-100">
                {machines.map((m) => (
                  <label key={m.id}
                    className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors ${selected.has(m.id) ? "bg-brand-50" : "hover:bg-brand-50/50"}`}>
                    <input type="checkbox" checked={selected.has(m.id)} disabled={busy} onChange={() => toggle(m.id)}
                      className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-400" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-ink-900">TID: {m.tid ?? "—"}</div>
                      <div className="text-xs text-ink-500">Serial: {m.serial ?? "—"}</div>
                    </div>
                    <Monitor className="h-4 w-4 shrink-0 text-brand-600" />
                  </label>
                ))}
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={assign} disabled={busy || selected.size === 0}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Assign {selected.size > 0 ? selected.size : ""} machine{selected.size === 1 ? "" : "s"}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Scheme assign modal ──

function SchemeAssignModal({ child, onClose, onDone }: { child: NetworkUser; onClose: () => void; onDone: () => void }) {
  const [schemes, setSchemes] = useState<Array<{ id: string; name: string; isDefault: boolean }>>([]);
  const [selectedScheme, setSelectedScheme] = useState<string | null>(child.schemeId);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/network/scheme")
      .then((r) => r.json())
      .then((d) => { setSchemes(d.schemes ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const submit = async () => {
    if (!selectedScheme) { setErr("Select a scheme — without one, the user cannot transact"); return; }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/network/scheme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId: child.id, schemeId: selectedScheme }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error ?? "Assignment failed"); setBusy(false); return; }
      onDone();
    } catch { setErr("Request failed"); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-ink-100 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <div>
            <h3 className="font-display text-base font-semibold text-ink-900">Assign scheme to {child.name}</h3>
            <p className="text-xs text-ink-500">One scheme covers charges, commission and POS MDR</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-ink-400 hover:bg-ink-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 p-5">
          {err && <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"><AlertCircle className="h-4 w-4 shrink-0" /> {err}</div>}

          {child.schemeName && (
            <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-700">
              <Layers className="h-4 w-4 shrink-0" />
              Currently assigned: <span className="font-semibold">{child.schemeName}</span>
            </div>
          )}
          {!child.schemeName && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              No scheme assigned — this user cannot transact until a scheme is assigned.
            </div>
          )}

          {loading ? (
            <div className="py-8 text-center text-sm text-ink-500">Loading your schemes…</div>
          ) : schemes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-ink-200 px-3 py-6 text-center text-sm text-ink-500">
              You have no derived schemes yet. Go to <span className="font-semibold">My Schemes</span> to create one from your rate-card first.
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-500">Select scheme</label>
              <select
                value={selectedScheme ?? ""}
                onChange={(e) => setSelectedScheme(e.target.value || null)}
                className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
              >
                <option value="">— Select a scheme —</option>
                {schemes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={submit} disabled={busy || loading || schemes.length === 0}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Assign
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Pending invitations (links the parent shared, not yet registered) ──

function PendingInvitesCard({ singular, onChanged }: { singular: string; onChanged: () => void }) {
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<PendingInvite | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PendingInvite | null>(null);
  const [progressFor, setProgressFor] = useState<PendingInvite | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/network/invites");
      const d = await res.json();
      if (res.ok) setInvites(d.invites ?? []);
    } catch {
      // best-effort — a load hiccup shouldn't break the page
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (inv: PendingInvite, action: "resend" | "reshare" | "cancel") => {
    setBusyId(inv.id);
    try {
      const res = await fetch(`/api/network/invites/${inv.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = await res.json();
      if (!res.ok) {
        toast.error(d.error ?? "Action failed");
        return;
      }
      if (action === "cancel") toast.success("Invite cancelled");
      else if (action === "reshare") toast.success("Fresh link shared");
      else toast.success(d.emailSent ? "Reminder sent" : "Reminder queued");
      await load();
      onChanged();
    } catch {
      toast.error("Request failed");
    } finally {
      setBusyId(null);
      setCancelTarget(null);
    }
  };

  if (!loading && invites.length === 0) return null;

  return (
    <div className="rounded-2xl border border-ink-100 bg-white">
      <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <MailPlus className="h-4 w-4 text-brand-600" />
          <h3 className="text-sm font-semibold text-ink-900">Pending invitations</h3>
          {invites.length > 0 && <Badge variant="warning">{invites.length}</Badge>}
        </div>
        <button
          onClick={load}
          className="rounded-full p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-600"
          title="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading && invites.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-sm text-ink-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <ul className="divide-y divide-ink-50">
          {invites.map((inv) => {
            const expired = inv.status === "EXPIRED";
            const busy = busyId === inv.id;
            return (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink-900">
                      {inv.name || inv.phone}
                    </span>
                    <Badge variant={expired ? "danger" : "warning"}>
                      {expired ? "Expired" : "Awaiting registration"}
                    </Badge>
                    <span className="text-[11px] font-medium capitalize text-ink-400">
                      {inv.role.replace(/_/g, " ").toLowerCase()}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-ink-500">
                    {inv.phone} · {inv.email}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-400">
                    <Clock className="h-3 w-3" /> {daysLeftLabel(inv.expiresAt)}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  <IconBtn
                    title="View onboarding progress"
                    onClick={() => setProgressFor(inv)}
                    icon={<ListChecks className="h-4 w-4" />}
                    label="Progress"
                  />
                  {!expired && (
                    <>
                      <IconBtn
                        title="Copy link"
                        onClick={() => copyText(inv.onboardingLink)}
                        icon={<Copy className="h-4 w-4" />}
                      />
                      <IconBtn
                        title="Share link"
                        onClick={() => shareInviteLink(inv.onboardingLink, inv.name)}
                        icon={<Share2 className="h-4 w-4" />}
                      />
                      <IconBtn
                        title="Resend reminder"
                        disabled={busy}
                        onClick={() => act(inv, "resend")}
                        icon={<Send className="h-4 w-4" />}
                      />
                      <IconBtn
                        title="Edit contact"
                        disabled={busy}
                        onClick={() => setEditing(inv)}
                        icon={<Pencil className="h-4 w-4" />}
                      />
                    </>
                  )}
                  {expired && (
                    <IconBtn
                      title="Reshare with a fresh link"
                      disabled={busy}
                      onClick={() => act(inv, "reshare")}
                      icon={<Link2 className="h-4 w-4" />}
                      label="Reshare"
                    />
                  )}
                  <IconBtn
                    title="Cancel invite"
                    disabled={busy}
                    danger
                    onClick={() => setCancelTarget(inv)}
                    icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <EditInviteModal
          invite={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            load();
            onChanged();
          }}
        />
      )}

      {progressFor && (
        <InviteProgressModal
          invite={progressFor}
          onClose={() => setProgressFor(null)}
        />
      )}

      <ConfirmDialog
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        busy={cancelTarget ? busyId === cancelTarget.id : false}
        tone="danger"
        title={`Cancel invite for ${cancelTarget?.name || cancelTarget?.phone || "this contact"}?`}
        description={`The onboarding link will stop working immediately and drop off this list. You can always invite this ${singular} again.`}
        confirmLabel="Cancel invite"
        onConfirm={async () => {
          if (cancelTarget) await act(cancelTarget, "cancel");
        }}
      />
    </div>
  );
}

// ── Onboarding progress modal for a not-yet-registered invite ──

function InviteProgressModal({
  invite,
  onClose,
}: {
  invite: PendingInvite;
  onClose: () => void;
}) {
  const [data, setData] = useState<OnboardingProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/network/invites/${invite.id}`);
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Could not load onboarding progress.");
        setData(null);
      } else {
        setData(d);
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }, [invite.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-lg rounded-2xl border border-ink-100 bg-ink-50/40 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between rounded-t-2xl border-b border-ink-100 bg-white px-5 py-4">
          <div className="min-w-0">
            <h3 className="font-display text-base font-semibold text-ink-900">
              Onboarding progress
            </h3>
            <p className="truncate text-xs text-ink-500">
              {invite.name || invite.phone} · {invite.phone}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={load}
              className="rounded-full p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-600"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={onClose}
              className="rounded-full p-1 text-ink-400 hover:bg-ink-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="p-4">
          <OnboardingProgressView
            loading={loading}
            error={error}
            data={data}
            memberName={invite.name || invite.phone}
            memberStatus="Pending KYC"
          />
        </div>
      </div>
    </div>
  );
}

function IconBtn({
  title,
  icon,
  onClick,
  disabled,
  danger,
  label,
}: {
  title: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  label?: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
        danger
          ? "border-rose-200 text-rose-600 hover:bg-rose-50"
          : "border-ink-200 text-ink-600 hover:bg-ink-50"
      }`}
    >
      {icon}
      {label ? <span>{label}</span> : null}
    </button>
  );
}

// ── Edit invite contact modal ──

function EditInviteModal({
  invite,
  onClose,
  onDone,
}: {
  invite: PendingInvite;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(invite.name ?? "");
  const [phone, setPhone] = useState(invite.phone);
  const [email, setEmail] = useState(invite.email);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/network/invites/${invite.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          name: name.trim() || undefined,
          phone: phone.trim(),
          email: email.trim(),
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setErr(typeof d.error === "string" ? d.error : "Could not update invite");
        setBusy(false);
        return;
      }
      toast.success("Invite updated and re-sent");
      onDone();
    } catch {
      setErr("Request failed");
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-ink-100 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <div>
            <h3 className="font-display text-base font-semibold text-ink-900">Edit contact</h3>
            <p className="text-xs text-ink-500">A refreshed link is sent after you save.</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-ink-400 hover:bg-ink-100">
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
            <label className="mb-1 block text-xs font-semibold text-ink-500">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-500">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="10-digit mobile"
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-500">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save & resend
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
