"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { StatTile, StatusPill, TabNav, ModalShell } from "@/components/dashboard/ui";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { formatINR, formatNumber } from "@/lib/utils";
import {
  Fingerprint,
  RefreshCw,
  UserPlus,
  Store,
  Clock,
  Ban,
  Wallet,
  Banknote,
  ShieldAlert,
  Landmark,
  History,
} from "lucide-react";

type Merchant = {
  id: string;
  provider: string;
  providerMerchantId: string | null;
  status: string;
  activatedAt: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    phone: string;
    role: string;
    accountStatus: string;
    aepsBalance: number;
  };
};

type Account = {
  id: string;
  holder: string;
  accountLast4: string;
  ifsc: string;
  bankName: string | null;
  status: string;
  pennyDropVerified: boolean;
  reviewNote: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string };
};

type Settlement = {
  id: string;
  amount: number;
  charge: number;
  mode: string;
  status: string;
  utr: string | null;
  detail: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string };
};

type OverviewData = {
  merchants: { total: number; pending: number; active: number; suspended: number; rejected: number };
  pendingAccountApprovals: number;
  float: { usersWithBalance: number; totalAmount: number };
  settled24h: { count: number; amount: number };
};

type Tab = "merchants" | "accounts" | "settlements";

const inputCls =
  "rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

export default function AepsCentrePage() {
  const [tab, setTab] = useState<Tab>("merchants");
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [settleTarget, setSettleTarget] = useState<Merchant | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Account | null>(null);
  const notify = useCallback((text: string, ok: boolean) => {
    if (ok) toast.success(text);
    else toast.error(text);
  }, []);
  const pageSize = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ovRes, tabRes] = await Promise.all([
        fetch("/api/admin/aeps"),
        fetch(`/api/admin/aeps?view=${tab}&page=${page}${tab === "accounts" ? "&status=all" : ""}`),
      ]);
      const ov = await ovRes.json();
      const td = await tabRes.json();
      if (!ovRes.ok) throw new Error(ov?.error ?? "Failed to load AEPS centre");
      if (!tabRes.ok) throw new Error(td?.error ?? "Failed to load AEPS centre");
      setOverview(ov.overview);
      if (tab === "merchants") setMerchants(td.merchants);
      if (tab === "accounts") setAccounts(td.accounts);
      if (tab === "settlements") setSettlements(td.settlements);
      setTotal(td.total ?? 0);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Load failed", false);
    } finally {
      setLoading(false);
    }
  }, [tab, page, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (body: Record<string, unknown>, doneMsg: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/aeps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(typeof d?.error === "string" ? d.error : "Action failed");
      notify(doneMsg, true);
      load();
      return true;
    } catch (e) {
      notify(e instanceof Error ? e.message : "Action failed", false);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const merchantColumns: Column<Merchant>[] = [
    {
      key: "user",
      header: "Merchant",
      render: (m) => (
        <div>
          <p className="font-medium text-ink-900">{m.user.name}</p>
          <p className="text-xs text-ink-400">
            {m.user.email} · {m.user.role.toLowerCase().replace(/_/g, " ")}
          </p>
        </div>
      ),
    },
    {
      key: "provider",
      header: "Provider",
      render: (m) => (
        <div>
          <p className="text-sm font-medium">{m.provider}</p>
          <p className="text-xs text-ink-400">{m.providerMerchantId ?? "not linked"}</p>
        </div>
      ),
    },
    {
      key: "balance",
      header: "AEPS balance",
      render: (m) => <span className="font-semibold">{formatINR(m.user.aepsBalance)}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (m) => (
        <StatusPill
          status={m.status.toLowerCase()}
          tone={m.status === "ACTIVE" ? "success" : m.status === "PENDING" ? "warning" : "danger"}
        />
      ),
    },
    {
      key: "actions",
      header: "",
      render: (m) => (
        <div className="flex justify-end gap-1.5">
          {m.status !== "ACTIVE" && (
            <Button size="sm" disabled={busy} onClick={() => act({ action: "merchant_status", merchantId: m.id, status: "ACTIVE" }, "Merchant activated.")}>
              Activate
            </Button>
          )}
          {m.status === "ACTIVE" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: "merchant_status", merchantId: m.id, status: "SUSPENDED" }, "Merchant suspended.")}>
              Suspend
            </Button>
          )}
          {m.status === "PENDING" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: "merchant_status", merchantId: m.id, status: "REJECTED" }, "Merchant rejected.")}>
              Reject
            </Button>
          )}
          {m.user.aepsBalance > 0 && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setSettleTarget(m)}>
              Settle now
            </Button>
          )}
        </div>
      ),
    },
  ];

  const accountColumns: Column<Account>[] = [
    {
      key: "user",
      header: "User",
      render: (a) => (
        <div>
          <p className="font-medium text-ink-900">{a.user.name}</p>
          <p className="text-xs text-ink-400">{a.user.email}</p>
        </div>
      ),
    },
    {
      key: "account",
      header: "Bank account",
      render: (a) => (
        <div>
          <p className="font-medium">{a.holder}</p>
          <p className="text-xs text-ink-400">
            ····{a.accountLast4} · {a.ifsc} {a.bankName ? `· ${a.bankName}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "penny",
      header: "Penny drop",
      render: (a) => (
        <StatusPill
          status={a.pennyDropVerified ? "verified" : "not verified"}
          tone={a.pennyDropVerified ? "success" : "neutral"}
        />
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (a) => (
        <div>
          <StatusPill
            status={a.status.toLowerCase().replace(/_/g, " ")}
            tone={a.status === "APPROVED" ? "success" : a.status === "REJECTED" ? "danger" : "warning"}
          />
          {a.reviewNote && <p className="mt-0.5 text-xs text-ink-400">{a.reviewNote}</p>}
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (a) =>
        a.status === "PENDING_APPROVAL" ? (
          <div className="flex justify-end gap-1.5">
            <Button size="sm" disabled={busy} onClick={() => act({ action: "review_account", accountId: a.id, decision: "APPROVED" }, "Account approved.")}>
              Approve
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejectTarget(a)}>
              Reject
            </Button>
          </div>
        ) : null,
    },
  ];

  const settlementColumns: Column<Settlement>[] = [
    {
      key: "user",
      header: "User",
      render: (s) => (
        <div>
          <p className="font-medium text-ink-900">{s.user.name}</p>
          <p className="text-xs text-ink-400">{s.user.email}</p>
        </div>
      ),
    },
    { key: "amount", header: "Amount", render: (s) => <span className="font-semibold">{formatINR(s.amount)}</span> },
    { key: "charge", header: "Charge", render: (s) => <span>{s.charge > 0 ? formatINR(s.charge) : "—"}</span> },
    { key: "mode", header: "Mode", render: (s) => <StatusPill status={s.mode.toLowerCase()} tone="neutral" /> },
    {
      key: "status",
      header: "Status",
      render: (s) => (
        <div>
          <StatusPill
            status={s.status.toLowerCase()}
            tone={s.status === "SUCCESS" ? "success" : s.status === "FAILED" ? "danger" : "warning"}
          />
          {s.utr && <p className="mt-0.5 font-mono text-xs text-ink-400">{s.utr}</p>}
        </div>
      ),
    },
    {
      key: "at",
      header: "At",
      render: (s) => <span className="text-xs text-ink-500">{new Date(s.createdAt).toLocaleString("en-IN")}</span>,
    },
  ];

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          title="AEPS Centre"
          description="Aadhaar-enabled payments control — merchant onboarding, settlement account approvals, float and settlement history."
          actions={
            <div className="flex gap-2">
              <OnboardButton busy={busy} act={act} />
              <Button variant="outline" onClick={load}>
                <RefreshCw className="mr-2 h-4 w-4" /> Refresh
              </Button>
            </div>
          }
        />
      </Reveal>

      {overview && (
        <Stagger stagger={0.05} className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          <StaggerItem distance={14} duration={0.35}>
            <StatTile label="Active merchants" countTo={overview.merchants.active} icon={Store} tone="emerald" />
          </StaggerItem>
          <StaggerItem distance={14} duration={0.35}>
            <StatTile label="Pending merchants" countTo={overview.merchants.pending} icon={Clock} tone="amber" />
          </StaggerItem>
          <StaggerItem distance={14} duration={0.35}>
            <StatTile
              label="Suspended"
              countTo={overview.merchants.suspended}
              icon={Ban}
              tone={overview.merchants.suspended > 0 ? "rose" : "ink"}
            />
          </StaggerItem>
          <StaggerItem distance={14} duration={0.35}>
            <StatTile label="AEPS float" value={formatINR(overview.float.totalAmount)} icon={Wallet} tone="brand" />
          </StaggerItem>
          <StaggerItem distance={14} duration={0.35}>
            <StatTile label="Settled (24h)" value={formatINR(overview.settled24h.amount)} icon={Banknote} tone="emerald" />
          </StaggerItem>
          <StaggerItem distance={14} duration={0.35}>
            <StatTile
              label="Account approvals due"
              countTo={overview.pendingAccountApprovals}
              icon={ShieldAlert}
              tone={overview.pendingAccountApprovals > 0 ? "rose" : "ink"}
            />
          </StaggerItem>
        </Stagger>
      )}

      <TabNav
        tabs={[
          { key: "merchants", label: "Merchants", icon: Store },
          { key: "accounts", label: "Settlement accounts", icon: Landmark },
          { key: "settlements", label: "Settlement history", icon: History },
        ]}
        active={tab}
        onChange={(key) => {
          setTab(key as Tab);
          setPage(1);
        }}
      />

      {tab === "merchants" && (
        <Reveal distance={16} duration={0.45}>
          <DataTable columns={merchantColumns} data={merchants} loading={loading} />
        </Reveal>
      )}
      {tab === "accounts" && (
        <Reveal distance={16} duration={0.45}>
          <DataTable columns={accountColumns} data={accounts} loading={loading} />
        </Reveal>
      )}
      {tab === "settlements" && (
        <Reveal distance={16} duration={0.45}>
          <DataTable columns={settlementColumns} data={settlements} loading={loading} />
        </Reveal>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-500">
          <span>Page {page} of {pages} · {formatNumber(total)} rows</span>
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

      <ConfirmDialog
        open={settleTarget !== null}
        onClose={() => setSettleTarget(null)}
        busy={busy}
        tone="default"
        title="Settle AEPS balance now?"
        description={
          settleTarget && (
            <>
              <span className="font-semibold text-ink-900">{formatINR(settleTarget.user.aepsBalance)}</span> will be
              moved to <span className="font-semibold text-ink-900">{settleTarget.user.name}</span>&apos;s primary
              wallet immediately.
            </>
          )
        }
        confirmLabel="Settle now"
        onConfirm={async () => {
          if (!settleTarget) return;
          await act({ action: "settle_user", userId: settleTarget.user.id }, "Settlement executed.");
          setSettleTarget(null);
        }}
      />

      <ConfirmDialog
        open={rejectTarget !== null}
        onClose={() => setRejectTarget(null)}
        busy={busy}
        title="Reject this settlement account?"
        description={
          rejectTarget && (
            <>
              <span className="font-semibold text-ink-900">{rejectTarget.holder}</span> (····
              {rejectTarget.accountLast4} · {rejectTarget.ifsc}) for{" "}
              <span className="font-semibold text-ink-900">{rejectTarget.user.name}</span> will be rejected.
            </>
          )
        }
        confirmLabel="Reject"
        input={{ label: "Rejection note (optional)", placeholder: "Why is this account being rejected?" }}
        onConfirm={async (note) => {
          if (!rejectTarget) return;
          await act(
            { action: "review_account", accountId: rejectTarget.id, decision: "REJECTED", note: note || undefined },
            "Account rejected."
          );
          setRejectTarget(null);
        }}
      />
    </div>
  );
}

/* --------------------------------------------------------------- onboard */

function OnboardButton({
  busy,
  act,
}: {
  busy: boolean;
  act: (b: Record<string, unknown>, m: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [userId, setUserId] = useState("");
  const [provider, setProvider] = useState("PAYSPRINT");
  const [matches, setMatches] = useState<Array<{ id: string; label: string }>>([]);

  useEffect(() => {
    if (query.length < 3 || userId) return setMatches([]);
    const t = setTimeout(() => {
      fetch(`/api/admin/network?q=${encodeURIComponent(query)}&pageSize=5`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) =>
          setMatches(
            (d?.users ?? []).map((u: { id: string; name: string; email: string }) => ({
              id: u.id,
              label: `${u.name} (${u.email})`,
            }))
          )
        )
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [query, userId]);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus className="mr-2 h-4 w-4" /> Onboard merchant
      </Button>
      <ModalShell
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="AEPS Centre"
        title={
          <span className="inline-flex items-center gap-2">
            <Fingerprint className="h-4 w-4 text-brand-600" /> Onboard AEPS merchant
          </span>
        }
        subtitle="Creates the merchant record in PENDING state — activate after provider onboarding completes."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={busy || !userId}
              onClick={async () => {
                const ok = await act({ action: "onboard_merchant", userId, provider }, "Merchant record created (PENDING).");
                if (ok) {
                  setOpen(false);
                  setQuery("");
                  setUserId("");
                }
              }}
            >
              Onboard
            </Button>
          </>
        }
      >
        <label className="block text-xs text-ink-500">
          Network user
          <input
            className={`${inputCls} mt-1 w-full`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setUserId("");
            }}
            placeholder="Search name / email (min 3 chars)"
          />
        </label>
        {matches.length > 0 && (
          <div className="mt-1 overflow-hidden rounded-xl border border-ink-100 shadow-sm">
            {matches.map((m) => (
              <button
                key={m.id}
                className="block w-full px-3 py-2 text-left text-sm transition hover:bg-brand-50/60"
                onClick={() => {
                  setUserId(m.id);
                  setQuery(m.label);
                  setMatches([]);
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
        <label className="mt-3 block text-xs text-ink-500">
          Provider
          <select className={`${inputCls} mt-1 w-full`} value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="PAYSPRINT">Paysprint</option>
            <option value="EKYCHUB">eKYC Hub</option>
            <option value="MOCK">Mock (testing)</option>
          </select>
        </label>
      </ModalShell>
    </>
  );
}
