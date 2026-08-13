"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatINR, formatNumber } from "@/lib/utils";
import {
  RefreshCw,
  Eye,
  EyeOff,
  Search,
  ArrowUpCircle,
  ArrowDownCircle,
  Wallet,
  ShieldCheck,
  Lock,
  ShieldAlert,
  Activity,
  CreditCard,
  QrCode,
  Landmark,
  ArrowDownToLine,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

/* ---------------------------------------------------------------- types */

type TierBalance = {
  role: string;
  users: number;
  primary: number;
  aeps: number;
  held: number;
  total: number;
};

type Cumulative = {
  systemTotal: number;
  primaryTotal: number;
  aepsTotal: number;
  heldTotal: number;
  lienTotal: number;
  walletCount: number;
  tiers: TierBalance[];
};

type UserRow = {
  id: string;
  userCode: string | null;
  name: string;
  email: string;
  shopName: string | null;
  role: string;
  status: string;
  primary: number;
  aeps: number;
  held: number;
  lien: number;
  total: number;
};

type Lien = {
  id: string;
  amount: number;
  recoveredAmount: number;
  outstanding: number;
  reasonCode: string;
  remarks: string;
  status: "ACTIVE" | "RECOVERED" | "RELEASED";
  refType: string | null;
  refId: string | null;
  createdAt: string;
  targetUser?: { userCode: string | null; name: string; email: string; shopName: string | null; role: string };
  actor?: { name: string; email: string };
};

type Operation = {
  id: string;
  type: "PUSH" | "PULL";
  walletType: string;
  amount: number;
  reasonCode: string;
  remarks: string;
  status: string;
  createdAt: string;
  rejectedNote: string | null;
  targetUser?: { userCode: string | null; name: string; email: string; shopName: string | null; role: string };
  actor?: { name: string; email: string };
  approvedBy?: { name: string; email: string } | null;
};

const ROLE_LABEL: Record<string, string> = {
  RETAILER: "Retailers",
  DISTRIBUTOR: "Distributors",
  MASTER_DISTRIBUTOR: "Master Distributors",
  SUPER_DISTRIBUTOR: "Super Distributors",
};

const REASON_CODES = [
  "FUND_LOAD",
  "REFUND",
  "CHARGEBACK",
  "CORRECTION",
  "PENALTY",
  "PROMO",
  "OTHER",
] as const;

const LIEN_REASON_CODES = [
  "CHARGEBACK",
  "FRAUD",
  "DISPUTE",
  "INVESTIGATION",
  "OTHER",
] as const;

const inputCls =
  "w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

/* ---------------------------------------------------------------- page */

export default function WalletOpsPage() {
  const [tab, setTab] = useState<"balances" | "payin" | "topups" | "operate" | "liens" | "history">("balances");
  // Deep-link support: `?tab=payin` (e.g. from the top-bar "Payin · Today" card)
  // opens straight onto that tab. Read from the URL on mount so we don't need a
  // Suspense boundary around useSearchParams.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && ["balances", "payin", "topups", "operate", "liens", "history"].includes(t)) {
      setTab(t as typeof tab);
    }
  }, []);
  const [masked, setMasked] = useState(false);
  const [cumulative, setCumulative] = useState<Cumulative | null>(null);
  const notify = useCallback((text: string, ok: boolean) => {
    if (ok) toast.success(text);
    else toast.error(text);
  }, []);

  const loadCumulative = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/wallet/aggregates?view=cumulative");
      if (res.ok) setCumulative(await res.json());
    } catch {
      /* panel stays empty */
    }
  }, []);

  useEffect(() => {
    loadCumulative();
  }, [loadCumulative]);

  const money = useCallback(
    (n: number) => (masked ? "₹ ●●●●●" : formatINR(n)),
    [masked]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin · Money"
        title="Wallet Operations"
        description="Platform liability at a glance, user-wise balances, and audited admin credit/debit that executes immediately."
        actions={
          <>
            <Button variant="outline" onClick={() => setMasked((m) => !m)}>
              {masked ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              {masked ? "Show amounts" : "Mask amounts"}
            </Button>
            <Button variant="outline" onClick={loadCumulative}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </>
        }
      />

      {/* Cumulative liability */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-transparent bg-gradient-to-br from-brand-600 to-violet-600 p-4 text-white shadow-soft">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/70">
            System liability (all wallets)
          </p>
          <p className="mt-1 font-display text-2xl font-bold">
            {money(cumulative?.systemTotal ?? 0)}
          </p>
          <p className="text-[11px] text-white/70">
            across {formatNumber(cumulative?.walletCount ?? 0)} user wallets
          </p>
        </div>
        <MiniStat label="Primary wallets" value={money(cumulative?.primaryTotal ?? 0)} />
        <MiniStat label="AEPS wallets" value={money(cumulative?.aepsTotal ?? 0)} />
        <MiniStat label="On hold (in-flight)" value={money(cumulative?.heldTotal ?? 0)} />
        <MiniStat label="Frozen (liens)" value={money(cumulative?.lienTotal ?? 0)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(cumulative?.tiers ?? []).map((t) => (
          <div key={t.role} className="rounded-2xl border border-ink-100 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-ink-500">
                {ROLE_LABEL[t.role] ?? t.role}
              </p>
              <Badge>{formatNumber(t.users)}</Badge>
            </div>
            <p className="mt-1 font-display text-lg font-bold text-ink-900">{money(t.total)}</p>
            <p className="text-[11px] text-ink-500">
              Primary {money(t.primary)} · AEPS {money(t.aeps)}
            </p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-ink-100">
        {(
          [
            ["balances", "User-wise balances"],
            ["payin", "Live payin"],
            ["topups", "Wallet top-ups"],
            ["operate", "Push / Pull"],
            ["liens", "Liens"],
            ["history", "Operations history"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
              tab === key
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-ink-500 hover:text-ink-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "balances" && <UserBalancesTab money={money} />}
      {tab === "payin" && <PayinTab money={money} />}
      {tab === "topups" && <TopupsTab money={money} />}
      {tab === "operate" && (
        <OperateTab
          onDone={(msg, ok) => {
            notify(msg, ok);
            loadCumulative();
          }}
        />
      )}
      {tab === "liens" && (
        <LiensTab
          money={money}
          onDone={(msg, ok) => {
            notify(msg, ok);
            loadCumulative();
          }}
        />
      )}
      {tab === "history" && <HistoryTab money={money} onNotice={notify} />}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-ink-500">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold text-ink-900">{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------- payin tab */

type PayinRailStat = { rail: string; label: string; count: number; amount: number };
type PayinSummary = {
  accountId: string | null;
  balance: number;
  period: string;
  since: string;
  totalCount: number;
  totalAmount: number;
  rails: PayinRailStat[];
  asOf: string;
};

type TopupUserRow = {
  userId: string;
  userCode: string | null;
  name: string;
  shopName: string | null;
  role: string;
  count: number;
  amount: number;
  lastAt: string;
};
type TopupTxnRow = {
  refId: string;
  userId: string;
  userCode: string | null;
  name: string;
  shopName: string | null;
  amount: number;
  partner: string | null;
  createdAt: string;
};
type TopupsByUser = {
  period: string;
  since: string;
  asOf: string;
  totalCount: number;
  totalAmount: number;
  byUser: TopupUserRow[];
  rows: TopupTxnRow[];
};

const PAYIN_PERIODS = [
  ["today", "Today"],
  ["week", "This week"],
  ["month", "This month"],
  ["year", "This year"],
] as const;

function fmtPayinTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const RAIL_ICON: Record<string, typeof CreditCard> = {
  POS: CreditCard,
  PG: Landmark,
  QR: QrCode,
  TOPUP: ArrowDownToLine,
  OTHER: Wallet,
};

const RAIL_ACCENT: Record<string, string> = {
  POS: "from-sky-500 to-blue-600",
  PG: "from-violet-500 to-purple-600",
  QR: "from-emerald-500 to-teal-600",
  TOPUP: "from-amber-500 to-orange-600",
  OTHER: "from-ink-400 to-ink-600",
};

function PayinTab({ money }: { money: (n: number) => string }) {
  const [period, setPeriod] = useState<string>("today");
  const [data, setData] = useState<PayinSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/wallet/aggregates?view=payin&period=${period}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  // Live monitor — refresh on an interval so master-admin sees business as it lands.
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const periodLabel =
    PAYIN_PERIODS.find(([k]) => k === period)?.[1]?.toLowerCase() ?? "today";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl border border-ink-100 bg-white p-1">
          {PAYIN_PERIODS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                period === key ? "bg-brand-600 text-white" : "text-ink-500 hover:text-ink-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-ink-400">
          <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
          Live · auto-refreshes every 30s
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Headline cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-2xl border border-transparent bg-gradient-to-br from-brand-600 to-violet-600 p-4 text-white shadow-soft">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-white/80" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/70">
              Business {periodLabel}
            </p>
          </div>
          <p className="mt-1 font-display text-2xl font-bold">{money(data?.totalAmount ?? 0)}</p>
          <p className="text-[11px] text-white/70">
            {formatNumber(data?.totalCount ?? 0)} inbound transactions
          </p>
        </div>
        <MiniStat label="All-time business (all rails)" value={money(data?.balance ?? 0)} />
        <MiniStat
          label="Avg ticket size"
          value={money(
            data && data.totalCount > 0 ? data.totalAmount / data.totalCount : 0
          )}
        />
      </div>

      {/* Per-rail business */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(data?.rails ?? []).map((r) => {
          const Icon = RAIL_ICON[r.rail] ?? Wallet;
          const accent = RAIL_ACCENT[r.rail] ?? RAIL_ACCENT.OTHER;
          const share =
            data && data.totalAmount > 0 ? Math.round((r.amount / data.totalAmount) * 100) : 0;
          return (
            <div key={r.rail} className="rounded-2xl border border-ink-100 bg-white p-4">
              <div className="flex items-center justify-between">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${accent} text-white`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <Badge>{formatNumber(r.count)}</Badge>
              </div>
              <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-ink-500">
                {r.label}
              </p>
              <p className="mt-0.5 font-display text-xl font-bold text-ink-900">{money(r.amount)}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${accent}`}
                  style={{ width: `${share}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-ink-400">{share}% of {periodLabel}&rsquo;s volume</p>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-sky-600" />
          <p className="text-sm font-bold text-sky-800">Company payin wallet</p>
        </div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-sky-800">
          Every live acquiring inbound — POS captures, PG collections and QR settlements — is
          counted here in real time, read straight from each rail&rsquo;s source feed so it always
          matches your operational screens (POS mirrors the POS Fleet volume exactly). Wallet
          top-ups are excluded (they are agent funds, not company business). It is a monitor only:
          it never moves retailer funds, and each period resets at IST midnight.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ top-ups tab */

function TopupsTab({ money }: { money: (n: number) => string }) {
  const [period, setPeriod] = useState<string>("today");
  const [data, setData] = useState<TopupsByUser | null>(null);
  const [showTxns, setShowTxns] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/wallet/aggregates?view=topups&period=${period}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  const periodLabel =
    PAYIN_PERIODS.find(([k]) => k === period)?.[1]?.toLowerCase() ?? "today";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl border border-ink-100 bg-white p-1">
          {PAYIN_PERIODS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                period === key ? "bg-brand-600 text-white" : "text-ink-500 hover:text-ink-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="ml-auto">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Headline */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-2xl border border-transparent bg-gradient-to-br from-amber-500 to-orange-600 p-4 text-white shadow-soft">
          <div className="flex items-center gap-2">
            <ArrowDownToLine className="h-4 w-4 text-white/80" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/70">
              Wallet top-ups {periodLabel}
            </p>
          </div>
          <p className="mt-1 font-display text-2xl font-bold">{money(data?.totalAmount ?? 0)}</p>
          <p className="text-[11px] text-white/70">{formatNumber(data?.totalCount ?? 0)} top-ups</p>
        </div>
        <MiniStat label="Agents topped up" value={formatNumber(data?.byUser.length ?? 0)} />
        <MiniStat
          label="Avg top-up"
          value={money(data && data.totalCount > 0 ? data.totalAmount / data.totalCount : 0)}
        />
      </div>

      {/* By user */}
      <div className="rounded-2xl border border-ink-100 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold text-ink-900">Top-ups {periodLabel} · by user</p>
          {(data?.rows.length ?? 0) > 0 && (
            <button
              onClick={() => setShowTxns((s) => !s)}
              className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-semibold text-ink-600 hover:bg-ink-50"
            >
              {showTxns ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {showTxns ? "Hide transactions" : "Show transactions"}
            </button>
          )}
        </div>

        {loading && !data ? (
          <p className="mt-3 text-sm text-ink-400">Loading…</p>
        ) : (data?.byUser.length ?? 0) === 0 ? (
          <p className="mt-3 text-sm text-ink-400">No wallet top-ups {periodLabel}.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-left text-[11px] uppercase tracking-wider text-ink-400">
                  <th className="pb-2 font-semibold">User</th>
                  <th className="pb-2 text-right font-semibold">Top-ups</th>
                  <th className="pb-2 text-right font-semibold">Amount</th>
                  <th className="pb-2 text-right font-semibold">Last</th>
                </tr>
              </thead>
              <tbody>
                {(data?.byUser ?? []).map((u) => (
                  <tr key={u.userId} className="border-b border-ink-50 last:border-0">
                    <td className="py-2">
                      <div className="flex flex-col">
                        <span className="font-semibold text-ink-900">{u.shopName || u.name}</span>
                        <span className="text-[11px] text-ink-500">
                          {u.userCode ? <span className="font-medium text-brand-600">{u.userCode}</span> : null}
                          {u.userCode ? " · " : ""}
                          {u.role}
                        </span>
                      </div>
                    </td>
                    <td className="py-2 text-right text-ink-700">{formatNumber(u.count)}</td>
                    <td className="py-2 text-right font-semibold text-ink-900">{money(u.amount)}</td>
                    <td className="py-2 text-right text-[11px] text-ink-500">{fmtPayinTime(u.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showTxns && (data?.rows.length ?? 0) > 0 && (
          <div className="mt-4 overflow-x-auto rounded-xl border border-ink-100">
            <table className="w-full text-sm">
              <thead className="bg-ink-50/60">
                <tr className="text-left text-[11px] uppercase tracking-wider text-ink-400">
                  <th className="px-3 py-2 font-semibold">Time</th>
                  <th className="px-3 py-2 font-semibold">Ref</th>
                  <th className="px-3 py-2 font-semibold">User</th>
                  <th className="px-3 py-2 font-semibold">Provider</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows ?? []).map((t) => (
                  <tr key={t.refId} className="border-t border-ink-50">
                    <td className="px-3 py-2 text-[11px] text-ink-500">{fmtPayinTime(t.createdAt)}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-ink-600">{t.refId}</td>
                    <td className="px-3 py-2">
                      <span className="font-medium text-ink-900">{t.shopName || t.name}</span>
                      {t.userCode ? <span className="ml-1 text-[11px] text-brand-600">{t.userCode}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-ink-500">{t.partner ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-semibold text-ink-900">{money(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------ user-wise balances tab */

function UserBalancesTab({ money }: { money: (n: number) => string }) {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [sums, setSums] = useState({ primary: 0, aeps: 0, total: 0 });
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const pageSize = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        view: "users",
        role,
        q,
        page: String(page),
        pageSize: String(pageSize),
      });
      const res = await fetch(`/api/admin/wallet/aggregates?${params}`);
      const data = await res.json();
      if (res.ok) {
        setRows(data.rows);
        setTotal(data.total);
        setSums(data.sums);
      }
    } finally {
      setLoading(false);
    }
  }, [q, role, page]);

  useEffect(() => {
    const t = setTimeout(load, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const columns: Column<UserRow>[] = useMemo(
    () => [
      {
        key: "name",
        header: "User",
        render: (r) => (
          <div>
            <p className="font-semibold text-ink-900">
              {r.name}
              {r.userCode && <span className="ml-2 font-medium text-brand-600">{r.userCode}</span>}
            </p>
            <p className="text-[11px] text-ink-500">{r.shopName ?? r.email}</p>
          </div>
        ),
      },
      {
        key: "role",
        header: "Tier",
        render: (r) => <Badge variant="brand">{r.role.replace(/_/g, " ")}</Badge>,
      },
      {
        key: "status",
        header: "Status",
        render: (r) => (
          <Badge variant={r.status === "ACTIVE" ? "success" : "warning"}>{r.status}</Badge>
        ),
      },
      { key: "primary", header: "Primary", align: "right", render: (r) => money(r.primary) },
      { key: "aeps", header: "AEPS", align: "right", render: (r) => money(r.aeps) },
      { key: "held", header: "Held", align: "right", render: (r) => money(r.held) },
      {
        key: "lien",
        header: "Lien",
        align: "right",
        render: (r) =>
          r.lien > 0 ? (
            <span className="font-semibold text-rose-600">{money(r.lien)}</span>
          ) : (
            <span className="text-ink-300">—</span>
          ),
      },
      {
        key: "total",
        header: "Total",
        align: "right",
        render: (r) => <span className="font-semibold">{money(r.total)}</span>,
      },
    ],
    [money]
  );

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-400" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search name / shop / email / phone…"
            className={`${inputCls} w-72 pl-9`}
          />
        </div>
        <select
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setPage(1);
          }}
          className={`${inputCls} w-auto`}
        >
          <option value="ALL">All tiers</option>
          {Object.entries(ROLE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-ink-500">
          Filtered total: <b className="text-ink-800">{money(sums.total)}</b> · {formatNumber(total)} users
        </span>
      </div>

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
    </div>
  );
}

/* ------------------------------------------------------ push / pull tab */

type UserHit = { id: string; userCode: string | null; name: string; shop: string; role: string; walletBalance: number };

const ROLE_OPTIONS = [
  { value: "", label: "Select a role…" },
  { value: "super-distributor", label: "Super Distributor" },
  { value: "master-distributor", label: "Master Distributor" },
  { value: "distributor", label: "Distributor" },
  { value: "retailer", label: "Retailer" },
] as const;

function OperateTab({ onDone }: { onDone: (msg: string, ok: boolean) => void }) {
  const [filterRole, setFilterRole] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<UserHit[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selected, setSelected] = useState<UserHit | null>(null);
  const [type, setType] = useState<"PUSH" | "PULL">("PUSH");
  const [walletType, setWalletType] = useState<"PRIMARY" | "AEPS">("PRIMARY");
  const [amount, setAmount] = useState("");
  const [reasonCode, setReasonCode] = useState<string>("FUND_LOAD");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (selected) {
      setHits([]);
      return;
    }
    if (!filterRole && (!q || q.length < 2)) {
      setHits([]);
      return;
    }
    setLoadingUsers(true);
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ pageSize: "20" });
        if (filterRole) params.set("role", filterRole);
        if (q && q.length >= 2) params.set("q", q);
        const res = await fetch(`/api/admin/users?${params}`);
        const data = await res.json();
        if (res.ok) setHits(data.users ?? []);
      } catch {
        setHits([]);
      } finally {
        setLoadingUsers(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, filterRole, selected]);

  const submit = async () => {
    if (!selected) return onDone("Pick a target user first.", false);
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return onDone("Enter a valid amount.", false);
    if (remarks.trim().length < 3) return onDone("Remarks are mandatory (min 3 chars).", false);

    setBusy(true);
    try {
      const res = await fetch("/api/admin/wallet/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId: selected.id,
          type,
          walletType,
          amount: amt,
          reasonCode,
          remarks: remarks.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Operation failed — please check the amount and details."
        );
      onDone(
        `${type === "PUSH" ? "Credited" : "Debited"} ${formatINR(amt)} ${type === "PUSH" ? "to" : "from"} ${selected.name} — ledger entry written.`,
        true
      );
      setAmount("");
      setRemarks("");
      setSelected(null);
      setQ("");
    } catch (e) {
      onDone(e instanceof Error ? e.message : "Operation failed", false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="space-y-4 rounded-2xl border border-ink-100 bg-white p-5 lg:col-span-3">
        {/* Target user */}
        <div>
          <label className="text-xs font-bold uppercase tracking-widest text-ink-500">
            Target user
          </label>
          {selected ? (
            <div className="mt-1.5 flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50 px-3 py-2.5">
              <div>
                <p className="text-sm font-semibold text-ink-900">
                  {selected.name}
                  {selected.userCode && <span className="ml-2 font-medium text-brand-600">{selected.userCode}</span>}
                </p>
                <p className="text-[11px] text-ink-500">
                  {selected.shop} · {selected.role} · Wallet {formatINR(selected.walletBalance)}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setSelected(null); setQ(""); }}>
                Change
              </Button>
            </div>
          ) : (
            <div className="space-y-2 mt-1.5">
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={filterRole}
                  onChange={(e) => { setFilterRole(e.target.value); setQ(""); }}
                  className={inputCls}
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-400" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search name / shop…"
                    className={`${inputCls} pl-9`}
                  />
                </div>
              </div>
              {loadingUsers && (
                <p className="py-2 text-center text-xs text-ink-400">Loading users…</p>
              )}
              {!loadingUsers && hits.length > 0 && (
                <div className="max-h-52 overflow-y-auto rounded-xl border border-ink-100 bg-white">
                  {hits.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => {
                        setSelected(h);
                        setHits([]);
                      }}
                      className="flex w-full items-center justify-between border-b border-ink-50 px-3 py-2.5 text-left text-sm last:border-0 hover:bg-brand-50"
                    >
                      <span>
                        <span className="font-semibold text-ink-900">{h.name}</span>{" "}
                        {h.userCode && <span className="font-medium text-brand-600">{h.userCode}</span>}{" "}
                        <span className="text-ink-500">· {h.shop}</span>
                      </span>
                      <span className="shrink-0 ml-2 text-[11px] text-ink-500">{h.role} · {formatINR(h.walletBalance)}</span>
                    </button>
                  ))}
                </div>
              )}
              {!loadingUsers && filterRole && hits.length === 0 && q.length < 2 && (
                <p className="py-2 text-center text-xs text-ink-400">No users found for this role.</p>
              )}
            </div>
          )}
        </div>

        {/* Direction + wallet */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-ink-500">
              Operation
            </label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <button
                onClick={() => setType("PUSH")}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                  type === "PUSH"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-ink-200 text-ink-500 hover:border-ink-300"
                }`}
              >
                <ArrowUpCircle className="h-4 w-4" /> Push (credit)
              </button>
              <button
                onClick={() => setType("PULL")}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                  type === "PULL"
                    ? "border-rose-300 bg-rose-50 text-rose-700"
                    : "border-ink-200 text-ink-500 hover:border-ink-300"
                }`}
              >
                <ArrowDownCircle className="h-4 w-4" /> Pull (debit)
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-ink-500">
              Wallet
            </label>
            <select
              value={walletType}
              onChange={(e) => setWalletType(e.target.value as "PRIMARY" | "AEPS")}
              className={`${inputCls} mt-1.5`}
            >
              <option value="PRIMARY">Primary wallet</option>
              <option value="AEPS">AEPS wallet</option>
            </select>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-ink-500">
              Amount (₹)
            </label>
            <input
              type="number"
              min="1"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className={`${inputCls} mt-1.5`}
            />
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-ink-500">
              Reason code
            </label>
            <select
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              className={`${inputCls} mt-1.5`}
            >
              {REASON_CODES.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="text-xs font-bold uppercase tracking-widest text-ink-500">
            Remarks (mandatory, audit-logged)
          </label>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={2}
            placeholder="Why is this adjustment being made?"
            className={`${inputCls} mt-1.5 resize-none`}
          />
        </div>

        <Button onClick={submit} disabled={busy} className={`w-full ${type === "PUSH" ? "from-emerald-600 to-emerald-500 hover:shadow-emerald-200" : "from-rose-600 to-rose-500 hover:shadow-rose-200"}`} isLoading={busy}>
          <Wallet className="h-4 w-4" />
          {type === "PUSH" ? "Credit user wallet" : "Debit user wallet"}
        </Button>
      </div>

      <div className="space-y-3 lg:col-span-2">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-amber-600" />
            <p className="text-sm font-bold text-amber-800">Money-safety rules</p>
          </div>
          <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-amber-800">
            <li>• Every operation writes a ledger entry with your identity and remarks.</li>
            <li>• Operations execute immediately — no second-admin approval is required.</li>
            <li>• A credit that would push the user above the wallet cap is refused.</li>
            <li>• Pulls are refused when the user lacks spendable balance — negative balances are impossible.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- history tab */

function HistoryTab({
  money,
  onNotice,
}: {
  money: (n: number) => string;
  onNotice: (text: string, ok: boolean) => void;
}) {
  const [ops, setOps] = useState<Operation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const pageSize = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status,
        page: String(page),
        pageSize: String(pageSize),
      });
      const res = await fetch(`/api/admin/wallet/operations?${params}`);
      const data = await res.json();
      if (res.ok) {
        setOps(data.operations);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (id: string, action: "approve" | "reject" | "cancel") => {
    setActing(id);
    try {
      const res = await fetch(`/api/admin/wallet/operations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Action failed");
      onNotice(`Operation ${action}d.`, true);
      load();
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Action failed", false);
    } finally {
      setActing(null);
    }
  };

  const columns: Column<Operation>[] = [
    {
      key: "createdAt",
      header: "Date",
      render: (r) =>
        new Date(r.createdAt).toLocaleString("en-IN", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }),
    },
    {
      key: "targetUser",
      header: "User",
      render: (r) => (
        <div>
          <p className="font-semibold text-ink-900">
            {r.targetUser?.name ?? "—"}
            {r.targetUser?.userCode && <span className="ml-2 font-medium text-brand-600">{r.targetUser.userCode}</span>}
          </p>
          <p className="text-[11px] text-ink-500">{r.targetUser?.shopName ?? r.targetUser?.email}</p>
        </div>
      ),
    },
    {
      key: "type",
      header: "Op",
      render: (r) => (
        <Badge variant={r.type === "PUSH" ? "success" : "danger"}>
          {r.type} · {r.walletType}
        </Badge>
      ),
    },
    { key: "amount", header: "Amount", align: "right", render: (r) => money(r.amount) },
    { key: "reasonCode", header: "Reason", render: (r) => r.reasonCode.replace(/_/g, " ") },
    {
      key: "actor",
      header: "By",
      render: (r) => <span className="text-xs">{r.actor?.email ?? "—"}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge
          variant={
            r.status === "COMPLETED"
              ? "success"
              : r.status === "PENDING_APPROVAL"
              ? "warning"
              : "danger"
          }
        >
          {r.status.replace(/_/g, " ")}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (r) =>
        r.status === "PENDING_APPROVAL" ? (
          <div className="flex gap-1.5">
            <Button size="sm" disabled={acting === r.id} onClick={() => act(r.id, "approve")}>
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={acting === r.id}
              onClick={() => act(r.id, "reject")}
            >
              Reject
            </Button>
          </div>
        ) : null,
    },
  ];

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className={`${inputCls} w-auto`}
        >
          <option value="all">All statuses</option>
          <option value="PENDING_APPROVAL">Pending approval</option>
          <option value="COMPLETED">Completed</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={ops}
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
    </div>
  );
}

/* ------------------------------------------------------------- liens tab */

function LiensTab({
  money,
  onDone,
}: {
  money: (n: number) => string;
  onDone: (msg: string, ok: boolean) => void;
}) {
  // Place-lien form state.
  const [filterRole, setFilterRole] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<UserHit[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selected, setSelected] = useState<UserHit | null>(null);
  const [amount, setAmount] = useState("");
  const [reasonCode, setReasonCode] = useState<string>("CHARGEBACK");
  const [txnId, setTxnId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);

  // Liens list state.
  const [liens, setLiens] = useState<Lien[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("ACTIVE");
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const pageSize = 25;

  useEffect(() => {
    if (selected) {
      setHits([]);
      return;
    }
    if (!filterRole && (!q || q.length < 2)) {
      setHits([]);
      return;
    }
    setLoadingUsers(true);
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ pageSize: "20" });
        if (filterRole) params.set("role", filterRole);
        if (q && q.length >= 2) params.set("q", q);
        const res = await fetch(`/api/admin/users?${params}`);
        const data = await res.json();
        if (res.ok) setHits(data.users ?? []);
      } catch {
        setHits([]);
      } finally {
        setLoadingUsers(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, filterRole, selected]);

  const loadLiens = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status,
        page: String(page),
        pageSize: String(pageSize),
      });
      const res = await fetch(`/api/admin/wallet/liens?${params}`);
      const data = await res.json();
      if (res.ok) {
        setLiens(data.liens);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => {
    loadLiens();
  }, [loadLiens]);

  const submit = async () => {
    if (!selected) return onDone("Pick a target user first.", false);
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return onDone("Enter a valid amount.", false);
    if (remarks.trim().length < 3) return onDone("Remarks are mandatory (min 3 chars).", false);

    setBusy(true);
    try {
      const res = await fetch("/api/admin/wallet/liens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId: selected.id,
          amount: amt,
          reasonCode,
          remarks: remarks.trim(),
          ...(txnId.trim() ? { refType: "Transaction", refId: txnId.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Failed to place lien — please check the amount and details."
        );
      const lien = data.lien;
      const recovered = lien?.recoveredAmount ?? 0;
      onDone(
        recovered > 0
          ? `Lien placed on ${selected.name} — ${formatINR(recovered)} recovered immediately, ${formatINR(lien.outstanding)} pending against future credits.`
          : `Lien of ${formatINR(amt)} placed on ${selected.name} — will recover from incoming funds.`,
        true
      );
      setAmount("");
      setRemarks("");
      setTxnId("");
      setSelected(null);
      setQ("");
      loadLiens();
    } catch (e) {
      onDone(e instanceof Error ? e.message : "Failed to place lien", false);
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: string, action: "recover" | "release") => {
    setActing(id);
    try {
      const res = await fetch(`/api/admin/wallet/liens/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Action failed");
      onDone(action === "recover" ? "Recovery sweep run." : "Lien released.", true);
      loadLiens();
    } catch (e) {
      onDone(e instanceof Error ? e.message : "Action failed", false);
    } finally {
      setActing(null);
    }
  };

  const columns: Column<Lien>[] = [
    {
      key: "createdAt",
      header: "Placed",
      render: (r) =>
        new Date(r.createdAt).toLocaleString("en-IN", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }),
    },
    {
      key: "targetUser",
      header: "User",
      render: (r) => (
        <div>
          <p className="font-semibold text-ink-900">
            {r.targetUser?.name ?? "—"}
            {r.targetUser?.userCode && <span className="ml-2 font-medium text-brand-600">{r.targetUser.userCode}</span>}
          </p>
          <p className="text-[11px] text-ink-500">{r.targetUser?.shopName ?? r.targetUser?.email}</p>
        </div>
      ),
    },
    { key: "reasonCode", header: "Reason", render: (r) => r.reasonCode.replace(/_/g, " ") },
    { key: "amount", header: "Amount", align: "right", render: (r) => money(r.amount) },
    {
      key: "recoveredAmount",
      header: "Recovered",
      align: "right",
      render: (r) => <span className="text-emerald-600">{money(r.recoveredAmount)}</span>,
    },
    {
      key: "outstanding",
      header: "Outstanding",
      align: "right",
      render: (r) =>
        r.outstanding > 0 ? (
          <span className="font-semibold text-rose-600">{money(r.outstanding)}</span>
        ) : (
          <span className="text-ink-300">—</span>
        ),
    },
    {
      key: "ref",
      header: "Ref",
      render: (r) =>
        r.refId ? (
          <span className="text-[11px] text-ink-500">
            {r.refType === "Transaction" ? "Txn " : ""}
            {r.refId.slice(0, 10)}…
          </span>
        ) : (
          <span className="text-ink-300">—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge
          variant={
            r.status === "RECOVERED"
              ? "success"
              : r.status === "ACTIVE"
              ? "warning"
              : "danger"
          }
        >
          {r.status}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (r) =>
        r.status === "ACTIVE" ? (
          <div className="flex gap-1.5">
            <Button size="sm" disabled={acting === r.id} onClick={() => act(r.id, "recover")}>
              Recover
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={acting === r.id}
              onClick={() => act(r.id, "release")}
            >
              Release
            </Button>
          </div>
        ) : null,
    },
  ];

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 rounded-2xl border border-ink-100 bg-white p-5 lg:col-span-3">
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-ink-500">
              Target user
            </label>
            {selected ? (
              <div className="mt-1.5 flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50 px-3 py-2.5">
                <div>
                  <p className="text-sm font-semibold text-ink-900">
                    {selected.name}
                    {selected.userCode && <span className="ml-2 font-medium text-brand-600">{selected.userCode}</span>}
                  </p>
                  <p className="text-[11px] text-ink-500">
                    {selected.shop} · {selected.role} · Wallet {formatINR(selected.walletBalance)}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setSelected(null); setQ(""); }}>
                  Change
                </Button>
              </div>
            ) : (
              <div className="space-y-2 mt-1.5">
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={filterRole}
                    onChange={(e) => { setFilterRole(e.target.value); setQ(""); }}
                    className={inputCls}
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-400" />
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Search name / shop…"
                      className={`${inputCls} pl-9`}
                    />
                  </div>
                </div>
                {loadingUsers && (
                  <p className="py-2 text-center text-xs text-ink-400">Loading users…</p>
                )}
                {!loadingUsers && hits.length > 0 && (
                  <div className="max-h-52 overflow-y-auto rounded-xl border border-ink-100 bg-white">
                    {hits.map((h) => (
                      <button
                        key={h.id}
                        onClick={() => { setSelected(h); setHits([]); }}
                        className="flex w-full items-center justify-between border-b border-ink-50 px-3 py-2.5 text-left text-sm last:border-0 hover:bg-brand-50"
                      >
                        <span>
                          <span className="font-semibold text-ink-900">{h.name}</span>{" "}
                          {h.userCode && <span className="font-medium text-brand-600">{h.userCode}</span>}{" "}
                          <span className="text-ink-500">· {h.shop}</span>
                        </span>
                        <span className="shrink-0 ml-2 text-[11px] text-ink-500">{h.role} · {formatINR(h.walletBalance)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-ink-500">
                Lien amount (₹)
              </label>
              <input
                type="number"
                min="1"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className={`${inputCls} mt-1.5`}
              />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-ink-500">
                Reason code
              </label>
              <select
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                className={`${inputCls} mt-1.5`}
              >
                {LIEN_REASON_CODES.map((c) => (
                  <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-ink-500">
              Transaction ID (optional — links the lien to a transaction)
            </label>
            <input
              value={txnId}
              onChange={(e) => setTxnId(e.target.value)}
              placeholder="Transaction id this lien is against"
              className={`${inputCls} mt-1.5`}
            />
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-ink-500">
              Remarks (mandatory, audit-logged)
            </label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={2}
              placeholder="Why is this lien being placed?"
              className={`${inputCls} mt-1.5 resize-none`}
            />
          </div>

          <Button
            onClick={submit}
            disabled={busy}
            isLoading={busy}
            className="w-full from-rose-600 to-rose-500 hover:shadow-rose-200"
          >
            <Lock className="h-4 w-4" /> Place lien &amp; recover
          </Button>
        </div>

        <div className="space-y-3 lg:col-span-2">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              <p className="text-sm font-bold text-amber-800">How liens work</p>
            </div>
            <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-amber-800">
              <li>• Funds are frozen instantly and cannot be spent — spendable can never go negative.</li>
              <li>• The freeze is invisible to the user; only the recovery debit (&ldquo;Recovery against txn #…&rdquo;) shows.</li>
              <li>• Recovery is eager: available funds and every future credit are swept to the Company Suspense account until fully recovered.</li>
              <li>• Release returns any still-outstanding amount to the user; already-recovered money stays with the company.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Liens list */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className={`${inputCls} w-auto`}
          >
            <option value="all">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="RECOVERED">Recovered</option>
            <option value="RELEASED">Released</option>
          </select>
          <Button variant="outline" size="sm" onClick={loadLiens} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <DataTable columns={columns} data={liens} loading={loading} />

        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span className="text-ink-500">Page {page} / {pages}</span>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
