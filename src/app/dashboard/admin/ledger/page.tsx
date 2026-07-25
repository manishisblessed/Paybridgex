"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/useAuth";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { formatINR, formatNumber } from "@/lib/utils";
import { RefreshCw, Download, Search, Lock } from "lucide-react";

type Entry = {
  id: string;
  userId: string;
  user: { userCode: string | null; name: string; email: string; shopName: string | null; role: string };
  walletType: string;
  direction: "CREDIT" | "DEBIT";
  reason: string;
  amount: number;
  balanceAfter: number;
  refType: string | null;
  refId: string | null;
  note: string | null;
  createdAt: string;
};

/** Roles whose wallets can never be liened (matches the lien API guard). */
const STAFF_ROLES = ["ADMIN", "MASTER_ADMIN", "SUPPORT", "FINANCE"];

const LIEN_REASON_CODES = ["CHARGEBACK", "FRAUD", "DISPUTE", "INVESTIGATION", "OTHER"] as const;

const WALLET_REASONS = [
  "TOPUP",
  "WITHDRAW",
  "TRANSACTION",
  "COMMISSION",
  "REVERSAL",
  "ADJUSTMENT",
  "FUND_TRANSFER_IN",
  "FUND_TRANSFER_OUT",
  "FEE",
  "PENALTY",
  "PAYOUT",
  "SETTLEMENT",
  "AEPS_SETTLEMENT",
  "RENTAL",
];

const inputCls =
  "rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

export default function LedgerExplorerPage() {
  const { session } = useAuth();
  // Full admins can always place liens; a sub-admin needs the wallet-ops tab.
  // FINANCE (read-only oversight) never can.
  const canLien = useMemo(() => {
    const role = session?.role;
    if (role === "master-admin" || role === "admin") return true;
    if (role === "sub-admin") return (session?.allowedTabs ?? []).includes("wallet-ops");
    return false;
  }, [session?.role, session?.allowedTabs]);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [sums, setSums] = useState({ credit: 0, debit: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState("");
  const [userId, setUserId] = useState("");
  const [walletType, setWalletType] = useState("all");
  const [direction, setDirection] = useState("all");
  const [reason, setReason] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [lienFor, setLienFor] = useState<Entry | null>(null);
  const pageSize = 50;

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const qParam = sp.get("q");
    const idParam = sp.get("userId");
    if (qParam) setQ(qParam);
    if (idParam) setUserId(idParam);
  }, []);

  const buildParams = useCallback(
    (extra?: Record<string, string>) => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (userId) params.set("userId", userId);
      else if (q) params.set("q", q);
      if (walletType !== "all") params.set("walletType", walletType);
      if (direction !== "all") params.set("direction", direction);
      if (reason !== "all") params.set("reason", reason);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v);
      return params;
    },
    [q, userId, walletType, direction, reason, from, to, page]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/wallet/ledger?${buildParams()}`);
      const data = await res.json();
      if (res.ok) {
        setEntries(data.entries);
        setTotal(data.total);
        setSums(data.sums);
      }
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => {
    const t = setTimeout(load, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const exportFile = (fmt: "csv" | "zip") => {
    window.open(`/api/admin/wallet/ledger?${buildParams({ format: fmt })}`, "_blank");
  };

  const columns: Column<Entry>[] = [
    {
      key: "createdAt",
      header: "Date",
      render: (r) =>
        new Date(r.createdAt).toLocaleString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }),
    },
    {
      key: "user",
      header: "User",
      render: (r) => (
        <div>
          <p className="font-semibold text-ink-900">
            {r.user.name}
            {r.user.userCode && <span className="ml-2 font-medium text-brand-600">{r.user.userCode}</span>}
          </p>
          <p className="text-[11px] text-ink-500">{r.user.shopName ?? r.user.email}</p>
        </div>
      ),
    },
    {
      key: "walletType",
      header: "Wallet",
      render: (r) => <Badge variant={r.walletType === "AEPS" ? "accent" : "brand"}>{r.walletType}</Badge>,
    },
    {
      key: "direction",
      header: "Type",
      render: (r) => (
        <Badge variant={r.direction === "CREDIT" ? "success" : "danger"}>{r.direction}</Badge>
      ),
    },
    { key: "reason", header: "Reason", render: (r) => r.reason.replace(/_/g, " ") },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (r) => (
        <span className={r.direction === "CREDIT" ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>
          {r.direction === "CREDIT" ? "+" : "−"}
          {formatINR(r.amount)}
        </span>
      ),
    },
    {
      key: "balanceAfter",
      header: "Balance after",
      align: "right",
      render: (r) => formatINR(r.balanceAfter),
    },
    {
      key: "refType",
      header: "Source",
      render: (r) => (
        <span className="font-mono text-[11px] text-ink-500">
          {r.refType ?? "—"}
          {r.refId ? ` · ${r.refId.slice(0, 12)}` : ""}
        </span>
      ),
    },
    {
      key: "note",
      header: "Note",
      render: (r) => (
        <span className="block max-w-[220px] truncate text-xs text-ink-600" title={r.note ?? ""}>
          {r.note ?? "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (r) =>
        !canLien || STAFF_ROLES.includes(r.user.role) ? null : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setLienFor(r)}
            title="Place a lien on this user against this transaction"
          >
            <Lock className="h-3.5 w-3.5" /> Lien
          </Button>
        ),
    },
  ];

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin · Money"
        title="Ledger Explorer"
        description="Every rupee that has ever moved, across both wallet books. Filter, inspect and export — the ledger is append-only and never edited."
        actions={
          <>
            <Button variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button variant="outline" onClick={() => exportFile("csv")}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            <Button variant="outline" onClick={() => exportFile("zip")}>
              <Download className="h-4 w-4" /> ZIP
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">
            Credits (filtered)
          </p>
          <p className="mt-1 font-display text-xl font-bold text-emerald-700">
            {formatINR(sums.credit)}
          </p>
        </div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-rose-600">
            Debits (filtered)
          </p>
          <p className="mt-1 font-display text-xl font-bold text-rose-700">{formatINR(sums.debit)}</p>
        </div>
        <div className="rounded-2xl border border-ink-100 bg-white p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-ink-500">Entries</p>
          <p className="mt-1 font-display text-xl font-bold text-ink-900">{formatNumber(total)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-400" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setUserId("");
              setPage(1);
            }}
            placeholder="Search user / shop / email…"
            className={`${inputCls} w-64 pl-9`}
          />
        </div>
        <select value={walletType} onChange={(e) => { setWalletType(e.target.value); setPage(1); }} className={inputCls}>
          <option value="all">Both wallets</option>
          <option value="PRIMARY">Primary</option>
          <option value="AEPS">AEPS</option>
        </select>
        <select value={direction} onChange={(e) => { setDirection(e.target.value); setPage(1); }} className={inputCls}>
          <option value="all">Credit + Debit</option>
          <option value="CREDIT">Credits</option>
          <option value="DEBIT">Debits</option>
        </select>
        <select value={reason} onChange={(e) => { setReason(e.target.value); setPage(1); }} className={inputCls}>
          <option value="all">All reasons</option>
          {WALLET_REASONS.map((r) => (
            <option key={r} value={r}>
              {r.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className={inputCls} />
        <span className="text-xs text-ink-400">to</span>
        <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className={inputCls} />
      </div>

      <DataTable
        columns={columns}
        data={entries}
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

      {lienFor && (
        <PlaceLienModal
          entry={lienFor}
          onClose={() => setLienFor(null)}
          onDone={() => {
            setLienFor(null);
            load();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------ place-lien modal */

function PlaceLienModal({
  entry,
  onClose,
  onDone,
}: {
  entry: Entry;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(String(entry.amount || ""));
  const [reasonCode, setReasonCode] = useState<string>("CHARGEBACK");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);

  // Link the lien to the transaction this ledger entry references (fall back to
  // the wallet-entry id so the recovery is always traceable to a source).
  const refType = entry.refType ?? "WalletTxn";
  const refId = entry.refId ?? entry.id;

  const submit = async () => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return toast.error("Enter a valid amount.");
    if (remarks.trim().length < 3) return toast.error("Remarks are mandatory (min 3 chars).");

    setBusy(true);
    try {
      const res = await fetch("/api/admin/wallet/liens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId: entry.userId,
          amount: amt,
          reasonCode,
          remarks: remarks.trim(),
          refType,
          refId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to place lien");
      const recovered = data.lien?.recoveredAmount ?? 0;
      toast.success(
        recovered > 0
          ? `Lien placed — ${formatINR(recovered)} recovered now, ${formatINR(data.lien.outstanding)} pending against future credits.`
          : `Lien of ${formatINR(amt)} placed — will recover from incoming funds.`
      );
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to place lien");
    } finally {
      setBusy(false);
    }
  };

  const fieldCls =
    "w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Admin · Money"
      title="Place lien"
      subtitle={`On ${entry.user.name} · against ${refType} #${refId.slice(0, 14)}`}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            isLoading={busy}
            disabled={busy}
            className="from-rose-600 to-rose-500 hover:shadow-rose-200"
          >
            <Lock className="h-4 w-4" /> Place lien &amp; recover
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-ink-100 bg-ink-50/50 p-3 text-[13px] text-ink-600">
          Freezes funds on <b className="text-ink-800">{entry.user.name}</b> and eagerly recovers
          them (and all future credits) into the Company Suspense account until fully recovered. The
          freeze is invisible to the user; the recovery shows as
          &ldquo;Recovery against txn #…&rdquo;.
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
              className={`${fieldCls} mt-1.5`}
            />
            <p className="mt-1 text-[11px] text-ink-400">
              Transaction amount: {formatINR(entry.amount)}
            </p>
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-ink-500">
              Reason code
            </label>
            <select
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              className={`${fieldCls} mt-1.5`}
            >
              {LIEN_REASON_CODES.map((c) => (
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
            rows={3}
            placeholder="Why is this lien being placed?"
            className={`${fieldCls} mt-1.5 resize-none`}
          />
        </div>
      </div>
    </Modal>
  );
}
