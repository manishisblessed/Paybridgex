"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Panel, FilterBar, TabNav, StatusPill } from "@/components/dashboard/ui";
import { Reveal } from "@/components/motion";
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
  reKycRequired: boolean;
  reKycExempt: boolean;
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
  const [rekyc, setRekyc] = useState("all");
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
        rekyc,
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
  }, [tier, q, status, rekyc, page]);

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
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant={r.status === "ACTIVE" ? "success" : r.status === "SUSPENDED" ? "danger" : "warning"}>
            {r.status.replace(/_/g, " ")}
          </Badge>
          {r.reKycExempt ? (
            <Badge variant="brand">re-KYC exempt</Badge>
          ) : (
            r.reKycRequired && <Badge variant="warning">re-KYC due</Badge>
          )}
        </div>
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
      <Reveal distance={14} duration={0.4}>
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
      </Reveal>

      <TabNav
        tabs={TIERS.map(([key, label]) => ({
          key,
          label,
          count: tierCounts[key] ?? 0,
        }))}
        active={tier}
        onChange={(key) => {
          setTier(key);
          setPage(1);
        }}
      />

      <FilterBar>
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
        <select
          value={rekyc}
          onChange={(e) => {
            setRekyc(e.target.value);
            setPage(1);
          }}
          className={inputCls}
        >
          <option value="all">All re-KYC</option>
          <option value="due">Re-KYC due</option>
          <option value="exempt">Re-KYC exempt</option>
        </select>
      </FilterBar>

      <BulkServicesPanel
        tier={tier}
        tierCount={tierCounts[tier] ?? 0}
        onDone={(msg, ok) => {
          notify(msg, ok);
          load();
        }}
      />

      <DefaultServicesPanel tier={tier} onDone={notify} />

      <Reveal distance={16} duration={0.45}>
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
        />
      </Reveal>

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
    <Panel flush>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-left"
      >
        <span className="flex items-center gap-2.5 text-sm font-semibold text-ink-800">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-soft">
            <Power className="h-4 w-4" />
          </span>
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
    </Panel>
  );
}

/* -------------------------------- default services for NEW tier signups */

function DefaultServicesPanel({
  tier,
  onDone,
}: {
  tier: string;
  onDone: (msg: string, ok: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/admin/network/default-services")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setServices((d.services ?? []).map((s: ServiceOption) => ({ key: s.key, name: s.name })));
        const forTier: string[] = d.defaults?.[tier] ?? [];
        setSelectedKeys(new Set(forTier));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, tier]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/network/default-services", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: tier, serviceKeys: Array.from(selectedKeys) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Save failed");
      onDone(
        `Default services for new ${tier.replace(/_/g, " ").toLowerCase()}s saved (${selectedKeys.size} selected).`,
        true
      );
    } catch (e) {
      onDone(e instanceof Error ? e.message : "Save failed", false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel flush>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-left"
      >
        <span className="flex items-center gap-2.5 text-sm font-semibold text-ink-800">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-accent-500 to-emerald-600 text-white shadow-soft">
            <Sparkles className="h-4 w-4" />
          </span>
          Default services for new {tier.replace(/_/g, " ").toLowerCase()} signups
        </span>
        <Badge>{open ? "collapse" : "expand"}</Badge>
      </button>
      {open && (
        <div className="border-t border-ink-100 p-5">
          <p className="mb-3 text-xs text-ink-500">
            Newly created / onboarded {tier.replace(/_/g, " ").toLowerCase()}s start with exactly
            these services enabled. Leave empty to start them with no services (enable manually per
            user). This does not change existing users.
          </p>
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
              <p className="text-xs text-ink-400">
                {loading ? "Loading service catalog…" : "No services available."}
              </p>
            )}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button size="sm" disabled={saving || loading} onClick={save}>
              {saving ? "Saving…" : "Save defaults"}
            </Button>
            <span className="text-xs text-ink-400">{selectedKeys.size} selected</span>
          </div>
        </div>
      )}
    </Panel>
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
        className="relative h-full w-full max-w-md overflow-y-auto rounded-l-3xl border-l border-ink-100 bg-white shadow-2xl animate-fade-up"
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
                      if (!res.ok)
                        throw new Error(
                          typeof data?.error === "string"
                            ? data.error
                            : "Operation failed — please check the amount and details."
                        );

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

        {/* Approval status override (Pending / Approved / Rejected) */}
        <ApprovalStatusSection user={user} onChanged={onChanged} onClose={onClose} busy={busy} setBusy={setBusy} />

        {/* Change distributor / parent (Master Admin only) */}
        {user.parent && (
          <TransferParentSection
            user={user}
            onChanged={onChanged}
            onClose={onClose}
            busy={busy}
            setBusy={setBusy}
          />
        )}

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
  reKycExempt: boolean;
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
  const { data: session } = useSession();
  const isMasterAdmin = session?.user?.role === "MASTER_ADMIN";
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
          reKycExempt: !!data.user.reKycExempt,
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

  const toggleExempt = async (next: boolean) => {
    setBusy("exempt");
    try {
      const res = await fetch(`/api/admin/network/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setReKycExempt", exempt: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Update failed");
      onChanged(
        next
          ? `${user.name} is now exempt from monthly re-KYC.`
          : `${user.name} is back under monthly re-KYC.`,
        true
      );
      await load();
      onRefresh();
    } catch (e) {
      onChanged(e instanceof Error ? e.message : "Failed", false);
    } finally {
      setBusy(null);
    }
  };

  const exempt = !!detail?.reKycExempt;

  return (
    <Section icon={ShieldAlert} title="Monthly Re-KYC">
      <div className="rounded-xl border border-ink-100 bg-ink-50/60 px-3 py-2.5 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-ink-500">Status</span>
          <span
            className={`font-semibold ${
              exempt
                ? "text-brand-600"
                : detail?.reKycRequired
                ? "text-amber-700"
                : "text-emerald-700"
            }`}
          >
            {exempt ? "Exempt" : detail?.reKycRequired ? "Verification required" : "Current"}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-ink-500">Next due</span>
          <span className="font-medium text-ink-900">
            {exempt ? "—" : fmt(detail?.reKycDueAt ?? null)}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-ink-500">Last verified</span>
          <span className="font-medium text-ink-900">{fmt(detail?.lastReKycAt ?? null)}</span>
        </div>
      </div>

      {/* Exemption — master-admin only. Bypasses the monthly gate entirely. */}
      {isMasterAdmin && (
        <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-xl border border-ink-100 bg-white px-3 py-2.5">
          <input
            type="checkbox"
            checked={exempt}
            disabled={busy !== null}
            onChange={(e) => toggleExempt(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-400"
          />
          <span className="text-sm">
            <span className="font-semibold text-ink-900">Exempt from monthly re-KYC</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-400">
              This user will never be asked to re-verify and is never blocked by the
              monthly gate. Use sparingly.
            </span>
          </span>
        </label>
      )}

      {!exempt && (
        <>
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
        </>
      )}
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
  onClose,
  busy,
  setBusy,
}: {
  user: NetworkUser;
  onChanged: (msg: string, ok: boolean) => void;
  onClose: () => void;
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

  const changeDistributor = async () => {
    if (!selectedParent) return;
    if (reason.trim().length < 3) {
      onChanged("A change reason is required (min 3 characters).", false);
      return;
    }
    setBusy("transfer");
    try {
      const res = await fetch(`/api/admin/network/${user.id}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newParentId: selectedParent.id,
          reason: reason.trim(),
          mode: "direct",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Change failed");
      onChanged(
        `${user.name} moved under ${selectedParent.name}. ID, wallet & history unchanged; scheme reset to platform default.`,
        true
      );
      // The user's parent/scheme snapshot in the drawer is now stale — close it
      // so a fresh open reflects the change.
      onClose();
    } catch (e) {
      onChanged(e instanceof Error ? e.message : "Change failed", false);
    } finally {
      setBusy(null);
    }
  };

  const parentLabel =
    user.parent?.role === "DISTRIBUTOR" ? "distributor" : user.parent?.role?.replace(/_/g, " ").toLowerCase() ?? "parent";
  const sectionTitle = user.parent?.role === "DISTRIBUTOR" ? "Change distributor" : "Change parent";

  return (
    <Section icon={GitBranch} title={sectionTitle}>
      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-xl border border-ink-100 px-3 py-2.5">
          <div className="text-sm text-ink-700">
            Current {parentLabel}: <span className="font-semibold">{user.parent?.name ?? "None"}</span>
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
              Change {parentLabel}
            </Button>
          </div>
        ) : (
          <div className="space-y-3 rounded-xl border border-brand-200 bg-brand-50/30 p-3">
            <p className="text-xs font-semibold text-brand-700">
              Move {user.name} under a new {parentLabel}
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

            {/* Reason (required) */}
            <input
              type="text"
              placeholder="Reason for change (required)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!selectedParent || reason.trim().length < 3 || busy === "transfer"}
                onClick={changeDistributor}
              >
                {busy === "transfer" ? "Applying..." : `Change ${parentLabel} now`}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setOpen(false); setSelectedParent(null); setSearchQ(""); setReason(""); }}>
                Cancel
              </Button>
            </div>

            <p className="text-[11px] text-ink-400">
              Takes effect immediately. The retailer keeps the same ID, wallet and
              transaction history — only the {parentLabel} changes and the scheme is
              reset to the platform default.
            </p>

            {/* Change history — Current → New, reason, changed by, date */}
            {transferHistory.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-500">Change history</p>
                {transferHistory.map((t: any) => (
                  <div key={t.id} className="rounded-lg border border-ink-100 bg-white px-2.5 py-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink-800">
                        {t.oldParent?.name ?? "—"} → {t.newParent?.name ?? "—"}
                      </span>
                      <StatusPill
                        status={t.status.replace(/_/g, " ")}
                        tone={
                          t.status === "APPROVED"
                            ? "success"
                            : t.status === "REJECTED"
                            ? "danger"
                            : t.status === "PENDING_DECLARATION"
                            ? "warning"
                            : "neutral"
                        }
                        className="shrink-0"
                      />
                    </div>
                    <p className="mt-0.5 text-ink-500">
                      {new Date(t.approvedAt ?? t.createdAt).toLocaleString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {t.initiatedBy?.name && ` · by ${t.initiatedBy.name}`}
                    </p>
                    {t.reason && <p className="text-ink-400">Reason: {t.reason}</p>}
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

/* ─── Approval status override (Pending / Approved / Rejected) ─────────────── */

type ApprovalTarget = "APPROVED" | "PENDING" | "REJECTED";

const APPROVAL_OPTIONS: {
  target: ApprovalTarget;
  label: string;
  on: string;
  off: string;
}[] = [
  {
    target: "APPROVED",
    label: "Approved",
    on: "border-emerald-300 bg-emerald-50 text-emerald-700 shadow-sm",
    off: "border-ink-200 text-ink-500 hover:border-emerald-200 hover:text-emerald-600",
  },
  {
    target: "PENDING",
    label: "Pending",
    on: "border-amber-300 bg-amber-50 text-amber-700 shadow-sm",
    off: "border-ink-200 text-ink-500 hover:border-amber-200 hover:text-amber-600",
  },
  {
    target: "REJECTED",
    label: "Rejected",
    on: "border-rose-300 bg-rose-50 text-rose-700 shadow-sm",
    off: "border-ink-200 text-ink-500 hover:border-rose-200 hover:text-rose-600",
  },
];

/** Map a User.status to its approval label for the current-state display. */
function statusToApproval(status: string): ApprovalTarget {
  if (status === "ACTIVE") return "APPROVED";
  if (status === "SUSPENDED" || status === "CLOSED") return "REJECTED";
  return "PENDING";
}

function ApprovalStatusSection({
  user,
  onChanged,
  onClose,
  busy,
  setBusy,
}: {
  user: NetworkUser;
  onChanged: (msg: string, ok: boolean) => void;
  onClose: () => void;
  busy: string | null;
  setBusy: (v: string | null) => void;
}) {
  const current = statusToApproval(user.status);
  const [target, setTarget] = useState<ApprovalTarget>(current);
  const [reason, setReason] = useState("");

  const dirty = target !== current;
  const needsReason = target === "REJECTED";

  const apply = async () => {
    if (needsReason && reason.trim().length < 3) {
      onChanged("A reason is required to reject an account (min 3 characters).", false);
      return;
    }
    setBusy("approval");
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "setApprovalStatus",
          target,
          reason: reason.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Update failed");
      const msg =
        target === "APPROVED"
          ? `${user.name} approved — account is active.`
          : target === "REJECTED"
          ? `${user.name} rejected — login and transactions are now blocked.`
          : `${user.name} moved to pending review — access paused.`;
      onChanged(msg, true);
      onClose();
    } catch (e) {
      onChanged(e instanceof Error ? e.message : "Update failed", false);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section icon={CheckCircle2} title="Approval status">
      <div className="flex items-center justify-between rounded-xl border border-ink-100 px-3 py-2.5 text-sm">
        <span className="text-ink-500">Current</span>
        <Badge
          variant={
            current === "APPROVED" ? "success" : current === "REJECTED" ? "danger" : "warning"
          }
        >
          {APPROVAL_OPTIONS.find((o) => o.target === current)?.label}
        </Badge>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        {APPROVAL_OPTIONS.map((o) => (
          <button
            key={o.target}
            type="button"
            disabled={busy !== null}
            onClick={() => setTarget(o.target)}
            className={`rounded-xl border px-3 py-2 text-xs font-semibold transition disabled:opacity-60 ${
              target === o.target ? o.on : o.off
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {needsReason && (
        <input
          type="text"
          placeholder="Reason for rejection (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={`${inputCls} mt-2 w-full`}
        />
      )}

      <Button
        size="sm"
        className="mt-3 w-full"
        disabled={!dirty || busy !== null || (needsReason && reason.trim().length < 3)}
        onClick={apply}
      >
        {busy === "approval" ? "Applying..." : "Update status"}
      </Button>

      <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
        Change the status in any direction. <b>Rejected</b> fully locks the account —
        no login and no transactions. Any active session is signed out immediately.
      </p>
    </Section>
  );
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
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-soft">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <h3 className="text-xs font-bold uppercase tracking-widest text-ink-500">{title}</h3>
      </div>
      {children}
    </div>
  );
}
