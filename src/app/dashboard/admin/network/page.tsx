"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatINR, formatNumber } from "@/lib/utils";
import {
  RefreshCw,
  Search,
  X,
  KeyRound,
  Layers,
  Gauge,
  Banknote,
  Power,
  ArrowUpCircle,
  ArrowDownCircle,
  Wallet,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  Sparkles,
  GitBranch,
} from "lucide-react";

type NetworkUser = {
  id: string;
  userCode: string | null;
  name: string;
  email: string;
  phone: string;
  shopName: string | null;
  city: string | null;
  state: string | null;
  status: string;
  primary: number;
  aeps: number;
  held: number;
  servicesEnabled: number;
  scheme: { id: string; name: string } | null;
  parent: { id: string; name: string; role: string; userCode: string | null } | null;
  settlementTier: string | null;
  walletCap: number | null;
  autoSettle: boolean;
  settlementPaused: boolean;
  children: number;
  joined: string;
};

const TIERS = [
  ["RETAILER", "Retailers"],
  ["DISTRIBUTOR", "Distributors"],
  ["MASTER_DISTRIBUTOR", "Master Distributors"],
  ["SUPER_DISTRIBUTOR", "Super Distributors"],
] as const;

const REASON_CODES = [
  "FUND_LOAD",
  "REFUND",
  "CHARGEBACK",
  "CORRECTION",
  "PENALTY",
  "PROMO",
  "OTHER",
] as const;

const inputCls =
  "rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

export default function NetworkManagerPage() {
  const [tier, setTier] = useState<string>("RETAILER");
  const [rows, setRows] = useState<NetworkUser[]>([]);
  const [tierCounts, setTierCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<NetworkUser | null>(null);
  const notify = useCallback((text: string, ok: boolean) => {
    if (ok) toast.success(text);
    else toast.error(text);
  }, []);
  const pageSize = 25;

  useEffect(() => {
    const qParam = new URLSearchParams(window.location.search).get("q");
    if (qParam) setQ(qParam);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        tier,
        q,
        status,
        page: String(page),
        pageSize: String(pageSize),
      });
      const res = await fetch(`/api/admin/network?${params}`);
      const data = await res.json();
      if (res.ok) {
        setRows(data.users);
        setTotal(data.total);
        setTierCounts(data.tierCounts ?? {});
      }
    } finally {
      setLoading(false);
    }
  }, [tier, q, status, page]);

  useEffect(() => {
    const t = setTimeout(load, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const columns: Column<NetworkUser>[] = [
    {
      key: "name",
      header: "User",
      render: (r) => (
        <button className="text-left" onClick={() => setSelected(r)}>
          <p className="font-semibold text-brand-700 hover:underline">{r.name}</p>
          <p className="text-[11px] text-ink-500">
            {r.shopName ?? r.email}
            {r.userCode && <> · <span className="font-medium text-brand-600">{r.userCode}</span></>}
          </p>
        </button>
      ),
    },
    {
      key: "city",
      header: "Location",
      render: (r) => (
        <span className="text-xs text-ink-600">
          {[r.city, r.state].filter(Boolean).join(", ") || "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge variant={r.status === "ACTIVE" ? "success" : r.status === "SUSPENDED" ? "danger" : "warning"}>
          {r.status.replace(/_/g, " ")}
        </Badge>
      ),
    },
    { key: "primary", header: "Wallet", align: "right", render: (r) => formatINR(r.primary) },
    { key: "aeps", header: "AEPS", align: "right", render: (r) => formatINR(r.aeps) },
    {
      key: "scheme",
      header: "Scheme",
      render: (r) => (
        <span className="text-xs">{r.scheme?.name ?? <span className="text-ink-400">default</span>}</span>
      ),
    },
    {
      key: "servicesEnabled",
      header: "Services",
      align: "center",
      render: (r) => <Badge variant={r.servicesEnabled > 0 ? "brand" : "default"}>{r.servicesEnabled}</Badge>,
    },
    {
      key: "settlementTier",
      header: "Settle tier",
      render: (r) => (
        <span className="text-xs">
          {r.settlementTier ?? "—"}
          {r.settlementPaused && <Badge variant="warning" className="ml-1">paused</Badge>}
        </span>
      ),
    },
    {
      key: "children",
      header: "Downline",
      align: "center",
      render: (r) => formatNumber(r.children),
    },
    {
      key: "parent",
      header: "Parent",
      render: (r) => <span className="text-xs text-ink-600">{r.parent?.name ?? "—"}</span>,
    },
  ];

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin · Network"
        title="Network Manager"
        description="Every tier of the distribution chain with wallet snapshots, scheme assignment, limits and settlement controls per user."
        actions={
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        }
      />

      <div className="flex gap-2 overflow-x-auto border-b border-ink-100">
        {TIERS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => {
              setTier(key);
              setPage(1);
            }}
            className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
              tier === key
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-ink-500 hover:text-ink-800"
            }`}
          >
            {label}
            <Badge variant={tier === key ? "brand" : "default"}>
              {formatNumber(tierCounts[key] ?? 0)}
            </Badge>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-400" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search name / shop / email / phone / city…"
            className={`${inputCls} w-80 pl-9`}
          />
        </div>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className={inputCls}
        >
          <option value="all">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="PENDING_KYC">Pending KYC</option>
          <option value="SUSPENDED">Suspended</option>
        </select>
      </div>

      <BulkServicesPanel
        tier={tier}
        tierCount={tierCounts[tier] ?? 0}
        onDone={(msg, ok) => {
          notify(msg, ok);
          load();
        }}
      />

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
      />

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-ink-500">
            Page {page} / {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}

      {selected && (
        <UserDrawer
          user={selected}
          onClose={() => setSelected(null)}
          onChanged={(msg, ok) => {
            notify(msg, ok);
            load();
          }}
          onRefresh={load}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------ bulk service toggles */

type ServiceOption = { key: string; name: string };

function BulkServicesPanel({
  tier,
  tierCount,
  onDone,
}: {
  tier: string;
  tierCount: number;
  onDone: (msg: string, ok: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"enable" | "disable" | null>(null);
  const [confirmAction, setConfirmAction] = useState<"enable" | "disable" | null>(null);

  useEffect(() => {
    if (!open || services.length > 0) return;
    fetch("/api/admin/services")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = (d?.services ?? []).filter((s: { type: string }) => s.type === "SERVICE");
        setServices(list.map((s: ServiceOption) => ({ key: s.key, name: s.name })));
      })
      .catch(() => {});
  }, [open, services.length]);

  const run = async (action: "enable" | "disable") => {
    setBusy(action);
    try {
      const res = await fetch("/api/admin/users/services/role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: tier, serviceKeys: Array.from(selectedKeys), action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Bulk update failed");
      onDone(`${action === "enable" ? "Enabled" : "Disabled"} for ${data.updated} user(s) — audit logged.`, true);
      setSelectedKeys(new Set());
    } catch (e) {
      onDone(e instanceof Error ? e.message : "Bulk update failed", false);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-2xl border border-ink-100 bg-white">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-ink-800">
          <Power className="h-4 w-4 text-brand-600" />
          Bulk service toggle — entire {tier.replace(/_/g, " ").toLowerCase()} tier
        </span>
        <Badge>{open ? "collapse" : "expand"}</Badge>
      </button>
      {open && (
        <div className="border-t border-ink-100 p-5">
          <div className="flex flex-wrap gap-2">
            {services.map((s) => {
              const on = selectedKeys.has(s.key);
              return (
                <button
                  key={s.key}
                  onClick={() =>
                    setSelectedKeys((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.key)) next.delete(s.key);
                      else next.add(s.key);
                      return next;
                    })
                  }
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    on
                      ? "border-brand-300 bg-brand-50 text-brand-700"
                      : "border-ink-200 text-ink-500 hover:border-ink-300"
                  }`}
                >
                  {s.name}
                </button>
              );
            })}
            {services.length === 0 && (
              <p className="text-xs text-ink-400">Loading service catalog…</p>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() => {
                if (selectedKeys.size === 0) return onDone("Pick at least one service.", false);
                setConfirmAction("enable");
              }}
            >
              {busy === "enable" ? "Enabling…" : `Enable for all (${tierCount})`}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => {
                if (selectedKeys.size === 0) return onDone("Pick at least one service.", false);
                setConfirmAction("disable");
              }}
            >
              {busy === "disable" ? "Disabling…" : "Disable for all"}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        busy={busy !== null}
        tone={confirmAction === "disable" ? "danger" : "default"}
        title={`${confirmAction === "disable" ? "Disable" : "Enable"} services for the entire tier?`}
        description={
          <>
            {confirmAction === "disable" ? "Disable" : "Enable"}{" "}
            <span className="font-semibold text-ink-900">{selectedKeys.size} service(s)</span> for ALL{" "}
            <span className="font-semibold text-ink-900">
              {tierCount} {tier.replace(/_/g, " ").toLowerCase()}s
            </span>
            ?
          </>
        }
        confirmLabel={confirmAction === "disable" ? "Disable for all" : "Enable for all"}
        onConfirm={async () => {
          if (!confirmAction) return;
          await run(confirmAction);
          setConfirmAction(null);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------- drawer */

type SchemeOption = { id: string; name: string };

function UserDrawer({
  user,
  onClose,
  onChanged,
  onRefresh,
}: {
  user: NetworkUser;
  onClose: () => void;
  onChanged: (msg: string, ok: boolean) => void;
  onRefresh: () => void;
}) {
  const [schemes, setSchemes] = useState<SchemeOption[]>([]);
  const [schemeId, setSchemeId] = useState(user.scheme?.id ?? "");
  const [walletCap, setWalletCap] = useState(user.walletCap != null ? String(user.walletCap) : "");
  const [settlementTier, setSettlementTier] = useState(user.settlementTier ?? "");
  const [settlementDailyCap, setSettlementDailyCap] = useState("");
  const [autoSettle, setAutoSettle] = useState(user.autoSettle);
  const [busy, setBusy] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<string | null>(null);

  const [walletOpType, setWalletOpType] = useState<"PUSH" | "PULL">("PUSH");
  const [walletOpWalletType, setWalletOpWalletType] = useState<"PRIMARY" | "AEPS">("PRIMARY");
  const [walletOpAmount, setWalletOpAmount] = useState("");
  const [walletOpReason, setWalletOpReason] = useState<string>("FUND_LOAD");
  const [walletOpRemarks, setWalletOpRemarks] = useState("");
  const [walletOpConfirm, setWalletOpConfirm] = useState(false);

  // Live wallet balances (updated optimistically after a successful push/pull
  // so the user sees the change without closing/refreshing).
  const [liveBalances, setLiveBalances] = useState({
    primary: user.primary,
    aeps: user.aeps,
    held: user.held,
  });
  const [pulse, setPulse] = useState<"primary" | "aeps" | null>(null);

  // In-drawer toast so feedback isn't hidden behind the drawer overlay.
  const [drawerNotice, setDrawerNotice] = useState<{
    text: string;
    kind: "success" | "error" | "pending";
  } | null>(null);
  useEffect(() => {
    if (!drawerNotice) return;
    const t = setTimeout(() => setDrawerNotice(null), 5000);
    return () => clearTimeout(t);
  }, [drawerNotice]);
  useEffect(() => {
    if (!pulse) return;
    const t = setTimeout(() => setPulse(null), 1400);
    return () => clearTimeout(t);
  }, [pulse]);

  const amountRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetch("/api/admin/schemes")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = d?.schemes ?? d ?? [];
        if (Array.isArray(list)) setSchemes(list.map((s: SchemeOption) => ({ id: s.id, name: s.name })));
      })
      .catch(() => {});
  }, []);

  const patch = async (label: string, body: object) => {
    setBusy(label);
    try {
      const res = await fetch(`/api/admin/network/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Update failed");
      return data;
    } finally {
      setBusy(null);
    }
  };

  const statusAction = async (action: "suspend" | "activate") => {
    setBusy(action);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Update failed");
      onChanged(`${user.name} ${action === "suspend" ? "suspended" : "re-activated"}.`, true);
      onClose();
    } catch (e) {
      onChanged(e instanceof Error ? e.message : "Update failed", false);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-ink-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky in-drawer notice — always visible over drawer content */}
        {drawerNotice && (
          <div
            className={`sticky top-0 z-20 flex items-start gap-2 border-b px-6 py-3 text-sm font-semibold shadow-sm animate-fade-up ${
              drawerNotice.kind === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : drawerNotice.kind === "pending"
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-rose-200 bg-rose-50 text-rose-700"
            }`}
          >
            {drawerNotice.kind === "success" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : drawerNotice.kind === "pending" ? (
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span className="flex-1 leading-relaxed">{drawerNotice.text}</span>
            <button
              onClick={() => setDrawerNotice(null)}
              className="rounded p-0.5 text-current/70 hover:bg-black/5"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-ink-900">
                {user.name}
                {user.userCode && (
                  <span className="ml-2 rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-600 align-middle">
                    {user.userCode}
                  </span>
                )}
              </h2>
              <p className="text-xs text-ink-500">
                {user.shopName ?? "—"} · {user.email} · {user.phone}
              </p>
            </div>
            <button onClick={onClose} className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Wallet snapshot with optimistic updates + pulse animation */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Snapshot label="Primary" value={formatINR(liveBalances.primary)} pulse={pulse === "primary"} />
            <Snapshot label="AEPS" value={formatINR(liveBalances.aeps)} pulse={pulse === "aeps"} />
            <Snapshot label="Held" value={formatINR(liveBalances.held)} />
          </div>

        {/* Wallet push / pull */}
        <Section icon={Wallet} title="Push / Pull balance">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy === "walletOp"}
              onClick={() => setWalletOpType("PUSH")}
              className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-all duration-200 active:scale-[0.97] disabled:opacity-60 ${
                walletOpType === "PUSH"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700 shadow-sm"
                  : "border-ink-200 text-ink-500 hover:border-emerald-200 hover:bg-emerald-50/50 hover:text-emerald-600"
              }`}
            >
              <ArrowUpCircle className="h-3.5 w-3.5" /> Push (credit)
            </button>
            <button
              type="button"
              disabled={busy === "walletOp"}
              onClick={() => setWalletOpType("PULL")}
              className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-all duration-200 active:scale-[0.97] disabled:opacity-60 ${
                walletOpType === "PULL"
                  ? "border-rose-300 bg-rose-50 text-rose-700 shadow-sm"
                  : "border-ink-200 text-ink-500 hover:border-rose-200 hover:bg-rose-50/50 hover:text-rose-600"
              }`}
            >
              <ArrowDownCircle className="h-3.5 w-3.5" /> Pull (debit)
            </button>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <select
              value={walletOpWalletType}
              onChange={(e) => setWalletOpWalletType(e.target.value as "PRIMARY" | "AEPS")}
              disabled={busy === "walletOp" || walletOpConfirm}
              className={inputCls}
            >
              <option value="PRIMARY">Primary wallet</option>
              <option value="AEPS">AEPS wallet</option>
            </select>
            <input
              ref={amountRef}
              type="number"
              min="1"
              step="0.01"
              placeholder="Amount ₹"
              value={walletOpAmount}
              onChange={(e) => setWalletOpAmount(e.target.value)}
              disabled={busy === "walletOp" || walletOpConfirm}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !walletOpConfirm) {
                  e.preventDefault();
                  const amt = Number(walletOpAmount);
                  if (Number.isFinite(amt) && amt > 0 && walletOpRemarks.trim().length >= 3) {
                    setWalletOpConfirm(true);
                  }
                }
              }}
              className={inputCls}
            />
          </div>
          <select
            value={walletOpReason}
            onChange={(e) => setWalletOpReason(e.target.value)}
            disabled={busy === "walletOp" || walletOpConfirm}
            className={`${inputCls} mt-2 w-full`}
          >
            {REASON_CODES.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <textarea
            value={walletOpRemarks}
            onChange={(e) => setWalletOpRemarks(e.target.value)}
            rows={2}
            placeholder="Remarks (mandatory, audit-logged)"
            disabled={busy === "walletOp" || walletOpConfirm}
            className={`${inputCls} mt-2 w-full resize-none`}
          />

          {/* Inline confirmation card — replaces the browser confirm() */}
          {walletOpConfirm ? (
            <div
              className={`mt-3 rounded-xl border p-3 animate-fade-up ${
                walletOpType === "PUSH"
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-rose-200 bg-rose-50"
              }`}
            >
              <div className="flex items-start gap-2">
                <Sparkles
                  className={`mt-0.5 h-4 w-4 shrink-0 ${
                    walletOpType === "PUSH" ? "text-emerald-600" : "text-rose-600"
                  }`}
                />
                <div className="flex-1">
                  <p
                    className={`text-xs font-bold uppercase tracking-widest ${
                      walletOpType === "PUSH" ? "text-emerald-800" : "text-rose-800"
                    }`}
                  >
                    Confirm {walletOpType === "PUSH" ? "credit" : "debit"}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-800">
                    {walletOpType === "PUSH" ? "Credit" : "Debit"}{" "}
                    <b>{formatINR(Number(walletOpAmount) || 0)}</b>{" "}
                    {walletOpType === "PUSH" ? "to" : "from"}{" "}
                    <b>{user.name}</b>&rsquo;s{" "}
                    <b>{walletOpWalletType}</b> wallet?
                  </p>
                  <p className="mt-1 text-[11px] italic text-ink-500">
                    &ldquo;{walletOpRemarks.trim()}&rdquo; — {walletOpReason.replace(/_/g, " ")}
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === "walletOp"}
                  onClick={() => setWalletOpConfirm(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className={walletOpType === "PUSH" ? "from-emerald-600 to-emerald-500" : "from-rose-600 to-rose-500"}
                  isLoading={busy === "walletOp"}
                  disabled={busy === "walletOp"}
                  onClick={async () => {
                    const amt = Number(walletOpAmount);
                    setBusy("walletOp");
                    try {
                      const res = await fetch("/api/admin/wallet/operations", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          targetUserId: user.id,
                          type: walletOpType,
                          walletType: walletOpWalletType,
                          amount: amt,
                          reasonCode: walletOpReason,
                          remarks: walletOpRemarks.trim(),
                        }),
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data?.error ?? "Operation failed");
                      const staged = data.operation?.status === "PENDING_APPROVAL";

                      if (staged) {
                        setDrawerNotice({
                          kind: "pending",
                          text: `Staged for approval — a different admin must approve this ${walletOpType.toLowerCase()} of ${formatINR(amt)}.`,
                        });
                      } else {
                        // Optimistic balance update + pulse animation.
                        const key = walletOpWalletType === "PRIMARY" ? "primary" : "aeps";
                        setLiveBalances((prev) => ({
                          ...prev,
                          [key]: walletOpType === "PUSH" ? prev[key] + amt : prev[key] - amt,
                        }));
                        setPulse(key);
                        setDrawerNotice({
                          kind: "success",
                          text: `${walletOpType === "PUSH" ? "Credited" : "Debited"} ${formatINR(amt)} ${walletOpType === "PUSH" ? "to" : "from"} ${user.name} — ledger entry written.`,
                        });
                      }

                      setWalletOpAmount("");
                      setWalletOpRemarks("");
                      setWalletOpConfirm(false);
                      // Refresh the table behind the drawer; the in-drawer
                      // banner + balance pulse is the primary feedback.
                      onRefresh();
                    } catch (e) {
                      setDrawerNotice({
                        kind: "error",
                        text: e instanceof Error ? e.message : "Operation failed",
                      });
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === "walletOp"
                    ? "Processing…"
                    : `Yes, ${walletOpType === "PUSH" ? "credit" : "debit"}`}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              className={`mt-3 w-full ${walletOpType === "PUSH" ? "from-emerald-600 to-emerald-500 hover:shadow-emerald-200" : "from-rose-600 to-rose-500 hover:shadow-rose-200"}`}
              disabled={busy === "walletOp"}
              onClick={() => {
                const amt = Number(walletOpAmount);
                if (!Number.isFinite(amt) || amt <= 0) {
                  setDrawerNotice({ kind: "error", text: "Enter a valid amount greater than zero." });
                  amountRef.current?.focus();
                  return;
                }
                if (walletOpRemarks.trim().length < 3) {
                  setDrawerNotice({ kind: "error", text: "Remarks are mandatory (min 3 characters)." });
                  return;
                }
                if (walletOpType === "PULL") {
                  const bal = walletOpWalletType === "PRIMARY" ? liveBalances.primary : liveBalances.aeps;
                  const spendable = walletOpWalletType === "PRIMARY" ? bal - liveBalances.held : bal;
                  if (amt > spendable) {
                    setDrawerNotice({
                      kind: "error",
                      text: `Insufficient spendable balance — available ${formatINR(Math.max(0, spendable))}.`,
                    });
                    return;
                  }
                }
                setWalletOpConfirm(true);
              }}
            >
              {walletOpType === "PUSH" ? (
                <>
                  <ArrowUpCircle className="h-4 w-4" /> Credit user wallet
                </>
              ) : (
                <>
                  <ArrowDownCircle className="h-4 w-4" /> Debit user wallet
                </>
              )}
            </Button>
          )}
        </Section>

        {/* Scheme assignment */}
        <Section icon={Layers} title="Commission scheme">
          <div className="flex gap-2">
            <select value={schemeId} onChange={(e) => setSchemeId(e.target.value)} className={`${inputCls} flex-1`}>
              <option value="">Platform default</option>
              {schemes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={busy === "scheme"}
              onClick={async () => {
                try {
                  await patch("scheme", { action: "assignScheme", schemeId: schemeId || null });
                  onChanged("Scheme assignment updated.", true);
                } catch (e) {
                  onChanged(e instanceof Error ? e.message : "Failed", false);
                }
              }}
            >
              Save
            </Button>
          </div>
          <p className="mt-2 text-xs text-ink-400">
            One scheme now covers charges and POS settlement MDR. Assigning it here sets both.
          </p>
        </Section>

        {/* Limits */}
        <Section icon={Gauge} title="Limits & tier">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              placeholder="Wallet cap ₹"
              value={walletCap}
              onChange={(e) => setWalletCap(e.target.value)}
              className={inputCls}
            />
            <input
              type="number"
              placeholder="Daily settle cap ₹"
              value={settlementDailyCap}
              onChange={(e) => setSettlementDailyCap(e.target.value)}
              className={inputCls}
            />
            <input
              placeholder="Tier label (e.g. GOLD)"
              value={settlementTier}
              onChange={(e) => setSettlementTier(e.target.value)}
              className={inputCls}
            />
            <Button
              size="sm"
              disabled={busy === "limits"}
              onClick={async () => {
                try {
                  await patch("limits", {
                    action: "setLimits",
                    walletCap: walletCap ? Number(walletCap) : null,
                    settlementDailyCap: settlementDailyCap ? Number(settlementDailyCap) : null,
                    settlementTier: settlementTier || null,
                  });
                  onChanged("Limits updated.", true);
                } catch (e) {
                  onChanged(e instanceof Error ? e.message : "Failed", false);
                }
              }}
            >
              Save limits
            </Button>
          </div>
        </Section>

        {/* Settlement */}
        <Section icon={Banknote} title="T+1 auto-settlement">
          <div className="flex items-center justify-between rounded-xl border border-ink-100 px-3 py-2.5">
            <span className="text-sm text-ink-700">Auto-settle AEPS wallet daily</span>
            <button
              role="switch"
              aria-checked={autoSettle}
              disabled={busy === "settle"}
              onClick={async () => {
                const next = !autoSettle;
                setAutoSettle(next);
                try {
                  await patch("settle", { action: "settlementConfig", autoSettleEnabled: next });
                  onChanged(`Auto-settlement ${next ? "enabled" : "disabled"} for ${user.name}.`, true);
                } catch (e) {
                  setAutoSettle(!next);
                  onChanged(e instanceof Error ? e.message : "Failed", false);
                }
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                autoSettle ? "bg-emerald-500" : "bg-ink-200"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
                  autoSettle ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </Section>

        {/* Hierarchy Transfer (Master Admin only) */}
        {user.parent && <TransferParentSection user={user} onChanged={onChanged} busy={busy} setBusy={setBusy} />}

        {/* Security */}
        <Section icon={KeyRound} title="Access">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy === "pw"}
              onClick={async () => {
                try {
                  const data = await patch("pw", { action: "resetPassword" });
                  setResetResult(data.password);
                  onChanged("Password reset — share the new password securely.", true);
                } catch (e) {
                  onChanged(e instanceof Error ? e.message : "Failed", false);
                }
              }}
            >
              Reset password
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy === "2fa"}
              onClick={async () => {
                if (!confirm(`Reset 2FA for ${user.name}? They will set up a new authenticator on next login.`)) return;
                try {
                  await patch("2fa", { action: "reset2fa" });
                  onChanged("2FA reset — user must re-enroll their authenticator on next login.", true);
                } catch (e) {
                  onChanged(e instanceof Error ? e.message : "Failed", false);
                }
              }}
            >
              Reset 2FA
            </Button>
            {user.status === "ACTIVE" ? (
              <Button size="sm" variant="outline" disabled={busy === "suspend"} onClick={() => statusAction("suspend")}>
                Suspend user
              </Button>
            ) : (
              <Button size="sm" disabled={busy === "activate"} onClick={() => statusAction("activate")}>
                Re-activate user
              </Button>
            )}
          </div>
          {resetResult && (
            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
              New password: <b className="font-mono">{resetResult}</b>
              <p className="text-[11px] text-amber-700">
                Shown once — all existing sessions have been signed out.
              </p>
            </div>
          )}
        </Section>

        {/* Monthly Re-KYC */}
        <ReKycSection user={user} onChanged={onChanged} onRefresh={onRefresh} />
        </div>
      </div>
    </div>
  );
}

/* ─── Monthly Re-KYC reschedule (MASTER_ADMIN / ADMIN) ─────────────────────── */

type ReKycDetail = {
  reKycRequired: boolean;
  reKycDueAt: string | null;
  lastReKycAt: string | null;
};

function ReKycSection({
  user,
  onChanged,
  onRefresh,
}: {
  user: NetworkUser;
  onChanged: (msg: string, ok: boolean) => void;
  onRefresh: () => void;
}) {
  const [detail, setDetail] = useState<ReKycDetail | null>(null);
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/network/${user.id}`);
      const data = await res.json();
      if (res.ok && data.user) {
        setDetail({
          reKycRequired: !!data.user.reKycRequired,
          reKycDueAt: data.user.reKycDueAt ?? null,
          lastReKycAt: data.user.lastReKycAt ?? null,
        });
      }
    } catch {
      /* non-critical: controls still work without the current snapshot */
    }
  }, [user.id]);

  useEffect(() => {
    load();
  }, [load]);

  const fmt = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
      : "—";

  const act = async (mode: "now" | "postpone" | "clear") => {
    if (mode === "postpone" && !date) {
      onChanged("Pick a date to postpone to.", false);
      return;
    }
    setBusy(mode);
    try {
      const res = await fetch(`/api/admin/network/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rescheduleReKyc",
          mode,
          dueDate: mode === "postpone" ? date : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Update failed");
      const msg =
        mode === "now"
          ? `${user.name} must re-verify now.`
          : mode === "postpone"
          ? `Re-KYC postponed to ${fmt(data.reKycDueAt)}.`
          : `Re-KYC block cleared for ${user.name}.`;
      onChanged(msg, true);
      await load();
      onRefresh();
    } catch (e) {
      onChanged(e instanceof Error ? e.message : "Failed", false);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section icon={ShieldAlert} title="Monthly Re-KYC">
      <div className="rounded-xl border border-ink-100 bg-ink-50/60 px-3 py-2.5 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-ink-500">Status</span>
          <span
            className={`font-semibold ${
              detail?.reKycRequired ? "text-amber-700" : "text-emerald-700"
            }`}
          >
            {detail?.reKycRequired ? "Verification required" : "Current"}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-ink-500">Next due</span>
          <span className="font-medium text-ink-900">{fmt(detail?.reKycDueAt ?? null)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-ink-500">Last verified</span>
          <span className="font-medium text-ink-900">{fmt(detail?.lastReKycAt ?? null)}</span>
        </div>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
        Postpone to let the user transact today; they will be asked to re-verify
        again on the chosen date. &ldquo;Require now&rdquo; blocks transactions until
        they re-verify.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={date}
          min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
          onChange={(e) => setDate(e.target.value)}
          className={inputCls}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null || !date}
          onClick={() => act("postpone")}
        >
          Postpone
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null || !detail?.reKycRequired}
          onClick={() => act("clear")}
        >
          Clear block
        </Button>
        <Button
          size="sm"
          disabled={busy !== null || detail?.reKycRequired}
          onClick={() => act("now")}
        >
          Require now
        </Button>
      </div>
    </Section>
  );
}

function Snapshot({ label, value, pulse }: { label: string; value: string; pulse?: boolean }) {
  return (
    <div
      className={`rounded-xl px-3 py-2 text-center transition-colors duration-500 ${
        pulse ? "bg-emerald-100 ring-2 ring-emerald-300" : "bg-ink-50"
      }`}
    >
      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-500">{label}</p>
      <p
        className={`font-display text-sm font-bold transition-colors duration-500 ${
          pulse ? "text-emerald-700" : "text-ink-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/* ─── Transfer parent section (MA only) ───────────────────────────────────── */

type ParentCandidate = { id: string; name: string; shopName: string | null; phone: string };

function TransferParentSection({
  user,
  onChanged,
  busy,
  setBusy,
}: {
  user: NetworkUser;
  onChanged: (msg: string, ok: boolean) => void;
  busy: string | null;
  setBusy: (v: string | null) => void;
}) {
  const { data: session } = useSession();
  const isMasterAdmin = session?.user?.role === "MASTER_ADMIN";

  const [open, setOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [candidates, setCandidates] = useState<ParentCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedParent, setSelectedParent] = useState<ParentCandidate | null>(null);
  const [reason, setReason] = useState("");
  const [transferHistory, setTransferHistory] = useState<any[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  // Only MASTER_ADMIN sees this section
  if (!isMasterAdmin) return null;

  const searchParents = async (query: string) => {
    if (query.length < 2) {
      setCandidates([]);
      return;
    }
    setSearching(true);
    try {
      const parentRole = getParentRoleForTier(user.parent?.role ?? "");
      const params = new URLSearchParams({
        q: query,
        tier: parentRole,
        status: "all",
        page: "1",
        pageSize: "10",
      });
      const res = await fetch(`/api/admin/network?${params}`);
      if (res.ok) {
        const data = await res.json();
        const results = (data.users ?? [])
          .filter((u: any) => u.id !== user.parent?.id && u.status === "ACTIVE")
          .map((u: any) => ({ id: u.id, name: u.name, shopName: u.shopName, phone: u.phone }));
        setCandidates(results);
      }
    } finally {
      setSearching(false);
    }
  };

  const loadHistory = async () => {
    if (historyLoaded) return;
    try {
      const res = await fetch(`/api/admin/network/${user.id}/transfer`);
      if (res.ok) {
        const data = await res.json();
        setTransferHistory(data.transfers ?? []);
      }
    } finally {
      setHistoryLoaded(true);
    }
  };

  const initiateTransfer = async () => {
    if (!selectedParent) return;
    setBusy("transfer");
    try {
      const res = await fetch(`/api/admin/network/${user.id}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newParentId: selectedParent.id, reason: reason || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Transfer failed");
      onChanged(
        `Transfer initiated — ${selectedParent.name} must approve the declaration within 7 days.`,
        true
      );
      setOpen(false);
      setSelectedParent(null);
      setReason("");
      setSearchQ("");
      setCandidates([]);
      setHistoryLoaded(false);
    } catch (e) {
      onChanged(e instanceof Error ? e.message : "Transfer failed", false);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section icon={GitBranch} title="Transfer parent">
      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-xl border border-ink-100 px-3 py-2.5">
          <div className="text-sm text-ink-700">
            Current: <span className="font-semibold">{user.parent?.name ?? "None"}</span>
            <span className="ml-1 text-xs text-ink-400">
              ({user.parent?.role?.replace(/_/g, " ") ?? "—"})
            </span>
          </div>
        </div>

        {!open ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setOpen(true); loadHistory(); }}
            >
              Transfer to new parent
            </Button>
          </div>
        ) : (
          <div className="space-y-3 rounded-xl border border-brand-200 bg-brand-50/30 p-3">
            <p className="text-xs font-semibold text-brand-700">
              Reassign {user.name} under a new {user.parent?.role?.replace(/_/g, " ") ?? "parent"}
            </p>

            {/* Search for new parent */}
            <div className="relative">
              <input
                type="text"
                placeholder={`Search ${user.parent?.role?.replace(/_/g, " ").toLowerCase() ?? "parent"}...`}
                value={searchQ}
                onChange={(e) => {
                  setSearchQ(e.target.value);
                  searchParents(e.target.value);
                }}
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              />
              {searching && (
                <div className="absolute right-3 top-2.5">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-400 border-t-transparent" />
                </div>
              )}
            </div>

            {/* Candidates list */}
            {candidates.length > 0 && !selectedParent && (
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-ink-100 bg-white p-1">
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { setSelectedParent(c); setCandidates([]); setSearchQ(c.name); }}
                    className="w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-brand-50 transition"
                  >
                    <span className="font-medium text-ink-900">{c.name}</span>
                    <span className="ml-2 text-xs text-ink-400">{c.shopName ?? c.phone}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Selected parent chip */}
            {selectedParent && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span className="flex-1 text-sm font-medium text-emerald-800">{selectedParent.name}</span>
                <button
                  onClick={() => { setSelectedParent(null); setSearchQ(""); }}
                  className="text-emerald-400 hover:text-emerald-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Reason */}
            <input
              type="text"
              placeholder="Reason for transfer (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!selectedParent || busy === "transfer"}
                onClick={initiateTransfer}
              >
                {busy === "transfer" ? "Initiating..." : "Initiate transfer"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setOpen(false); setSelectedParent(null); setSearchQ(""); }}>
                Cancel
              </Button>
            </div>

            <p className="text-[11px] text-ink-400">
              The new parent must approve a responsibility declaration (signature + selfie + GPS) within 7 days. 
              The user&apos;s scheme will be cleared on transfer.
            </p>

            {/* Transfer History */}
            {transferHistory.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-500">Transfer history</p>
                {transferHistory.map((t: any) => (
                  <div key={t.id} className="rounded-lg border border-ink-100 bg-white px-2.5 py-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span>
                        {t.oldParent?.name} → {t.newParent?.name}
                      </span>
                      <span
                        className={`font-semibold ${
                          t.status === "APPROVED"
                            ? "text-emerald-600"
                            : t.status === "REJECTED"
                            ? "text-rose-600"
                            : t.status === "PENDING_DECLARATION"
                            ? "text-amber-600"
                            : "text-ink-400"
                        }`}
                      >
                        {t.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="text-ink-400">
                      {new Date(t.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      {t.reason && ` — ${t.reason}`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

function getParentRoleForTier(currentParentRole: string): string {
  return currentParentRole || "DISTRIBUTOR";
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-brand-600" />
        <h3 className="text-xs font-bold uppercase tracking-widest text-ink-500">{title}</h3>
      </div>
      {children}
    </div>
  );
}
