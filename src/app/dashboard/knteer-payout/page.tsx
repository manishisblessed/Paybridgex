"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Banknote,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  Download,
  Hash,
  IndianRupee,
  Landmark,
  Loader2,
  MessageCircle,
  Plus,
  Printer,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  User as UserIcon,
  Wallet,
  XCircle,
  Zap,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import {
  Panel,
  StatTile,
  StatusPill,
  EmptyState,
  ModalShell,
} from "@/components/dashboard/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { ReportActions } from "@/components/dashboard/ReportActions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { TxnPinDialog } from "@/components/security/TxnPinDialog";
import { formatINR, formatIST } from "@/lib/utils";
import { useAuth } from "@/lib/useAuth";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type KnteerBeneficiary = {
  id: string;
  accountLast4: string;
  ifscCode: string;
  accountHolderName: string;
  bankName: string;
  mobile: string;
  referenceId: string | null;
  registrationType: string;
  verificationCharge: number;
  isRegistered: boolean;
  isBankVerified: boolean;
  createdAt: string;
};

// Standard PayoutRequest lifecycle states (Bank Transfer rides this rail).
type TransferStatus =
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "PROCESSING"
  | "SUCCESS"
  | "FAILED"
  | "NEEDS_REVIEW"
  | "REVERSED"
  | "REJECTED";

type KnteerTransfer = {
  id: string;
  referenceId: string | null;
  transactionId: string | null;
  utr: string | null;
  status: TransferStatus;
  amount: number;
  serviceCharge: number;
  gst: number;
  totalDebit: number;
  mode: string;
  accountLast4: string;
  beneficiaryName: string;
  bankName: string | null;
  ifscCode: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
};

type WalletBalances = {
  walletBalance: number;
  heldBalance: number;
  spendable: number;
};

type View = "home" | "process-payout" | "add-beneficiary" | "history";
type WizardStep = "select-account" | "verify-account" | "enter-amount" | "confirm" | "result";

// ─────────────────────────────────────────────────────────────────────────────
// Constants + helpers
// ─────────────────────────────────────────────────────────────────────────────

const TX_STATUS_BADGE: Record<TransferStatus, "success" | "danger" | "warning" | "default"> = {
  SUCCESS: "success",
  FAILED: "danger",
  REJECTED: "danger",
  REVERSED: "warning",
  NEEDS_REVIEW: "warning",
  PENDING_APPROVAL: "default",
  APPROVED: "default",
  PROCESSING: "warning",
};

const TX_STATUS_LABEL: Record<TransferStatus, string> = {
  SUCCESS: "Success",
  FAILED: "Failed",
  REJECTED: "Rejected",
  REVERSED: "Refunded",
  NEEDS_REVIEW: "Under review",
  PENDING_APPROVAL: "Pending",
  APPROVED: "Queued",
  PROCESSING: "Processing",
};

// A transfer is still "in flight" (no final outcome yet) in these states.
const PENDING_STATES: ReadonlySet<TransferStatus> = new Set<TransferStatus>([
  "PENDING_APPROVAL",
  "APPROVED",
  "PROCESSING",
  "NEEDS_REVIEW",
]);

const inr2 = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_RE = /^\d{9,18}$/;

// ─────────────────────────────────────────────────────────────────────────────
// The page
// ─────────────────────────────────────────────────────────────────────────────

export default function KnteerPayoutPage() {
  const [view, setView] = useState<View>("home");
  const [error, setError] = useState<string | null>(null);

  const [transfers, setTransfers] = useState<KnteerTransfer[]>([]);
  const [fetching, setFetching] = useState(true);

  const [beneficiaries, setBeneficiaries] = useState<KnteerBeneficiary[]>([]);
  const [fetchingBenes, setFetchingBenes] = useState(true);

  const [wallet, setWallet] = useState<WalletBalances | null>(null);
  const [fetchingBalance, setFetchingBalance] = useState(true);

  const [showNoAccountModal, setShowNoAccountModal] = useState(false);

  const registeredBenes = useMemo(
    () => beneficiaries.filter((b) => b.isRegistered),
    [beneficiaries]
  );

  // ── Fetchers ───────────────────────────────────────────────────────────────

  const fetchTransfers = useCallback(async () => {
    try {
      setFetching(true);
      const res = await fetch("/api/knteer-payout/status");
      if (!res.ok) {
        // 503 = feature flag off on server — not a user-facing error; show empty state
        if (res.status === 503) { setTransfers([]); return; }
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to fetch transfers");
      }
      const json = await res.json();
      setTransfers((json.transfers as KnteerTransfer[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load transfer history.");
    } finally {
      setFetching(false);
    }
  }, []);

  const fetchBenes = useCallback(async () => {
    try {
      setFetchingBenes(true);
      const res = await fetch("/api/knteer-payout/accounts");
      if (!res.ok) throw new Error("Failed to fetch beneficiaries");
      const json = await res.json();
      setBeneficiaries((json.beneficiaries as KnteerBeneficiary[]) ?? []);
    } catch {
      // silent: UI shows "no accounts" state naturally
    } finally {
      setFetchingBenes(false);
    }
  }, []);

  const fetchBalance = useCallback(async () => {
    try {
      setFetchingBalance(true);
      const res = await fetch("/api/knteer-payout/balance");
      // 503 = feature flag off — wallet panel shows "—" naturally; no crash
      if (!res.ok) { setWallet(null); return; }
      const json = await res.json();
      setWallet(json.wallet as WalletBalances);
    } catch {
      setWallet(null);
    } finally {
      setFetchingBalance(false);
    }
  }, []);

  useEffect(() => {
    fetchTransfers();
    fetchBenes();
    fetchBalance();
  }, [fetchTransfers, fetchBenes, fetchBalance]);

  const refreshAll = useCallback(() => {
    fetchTransfers();
    fetchBenes();
    fetchBalance();
  }, [fetchTransfers, fetchBenes, fetchBalance]);

  const handleStartPayout = () => {
    if (registeredBenes.length === 0) {
      setShowNoAccountModal(true);
      return;
    }
    setError(null);
    setView("process-payout");
  };

  // ── Report rows for CSV/PDF/XLSX ──────────────────────────────────────────
  const reportRows = transfers.map((r) => ({
    referenceId: r.referenceId ?? r.id,
    transactionId: r.transactionId ?? "—",
    beneficiary: r.beneficiaryName,
    account: `****${r.accountLast4}`,
    bank: r.bankName ?? "—",
    mode: r.mode,
    amount: r.amount,
    serviceCharge: r.serviceCharge,
    gst: r.gst,
    totalDebit: r.totalDebit,
    status: TX_STATUS_LABEL[r.status],
    utr: r.utr ?? "—",
    date: formatIST(r.createdAt),
  }));

  const cols: Column<KnteerTransfer>[] = [
    {
      key: "beneficiaryName",
      header: "Beneficiary",
      render: (r) => (
        <div>
          <div className="font-semibold text-ink-900">{r.beneficiaryName}</div>
          <div className="font-mono text-xs text-ink-500">
            ****{r.accountLast4}
            {r.bankName ? ` · ${r.bankName}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (r) => <span className="font-semibold">{formatINR(r.amount)}</span>,
    },
    {
      key: "totalDebit",
      header: "Total debited",
      align: "right",
      render: (r) => (
        <div className="text-right">
          <div className="font-semibold">{inr2(r.totalDebit)}</div>
          {r.serviceCharge + r.gst > 0 && (
            <div className="text-[11px] text-ink-500">
              +{inr2(r.serviceCharge + r.gst)} charges
            </div>
          )}
        </div>
      ),
    },
    {
      key: "utr",
      header: "UTR",
      render: (r) =>
        r.utr ? (
          <span className="font-mono text-xs">{r.utr}</span>
        ) : (
          <span className="text-xs text-ink-400">—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge variant={TX_STATUS_BADGE[r.status]}>{TX_STATUS_LABEL[r.status]}</Badge>
      ),
    },
    {
      key: "createdAt",
      header: "When",
      render: (r) => (
        <span className="whitespace-nowrap text-xs text-ink-500">
          {formatIST(r.createdAt, { dateStyle: "medium", timeStyle: "short" })}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          eyebrow="Bank Transfer"
          title="Send a bank transfer"
          description="Disburse to any registered bank account via IMPS or NEFT. Register a beneficiary once and transfer any time — no re-entry of account details needed."
          actions={
            <>
              <Button
                variant="outline"
                onClick={refreshAll}
                disabled={fetching || fetchingBenes}
              >
                <RefreshCw
                  className={`h-4 w-4 ${fetching || fetchingBenes ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
              {transfers.length > 0 && (
                <ReportActions
                  filename="knteer-payouts"
                  title="Paybridgex · Bank Transfers"
                  subtitle="My bank transfers"
                  columns={[
                    { key: "referenceId", header: "Reference ID" },
                    { key: "transactionId", header: "Transaction ID" },
                    { key: "beneficiary", header: "Beneficiary" },
                    { key: "account", header: "Account" },
                    { key: "bank", header: "Bank" },
                    { key: "mode", header: "Mode" },
                    { key: "amount", header: "Amount (INR)" },
                    { key: "serviceCharge", header: "Service charge" },
                    { key: "gst", header: "GST" },
                    { key: "totalDebit", header: "Total debited" },
                    { key: "status", header: "Status" },
                    { key: "utr", header: "UTR" },
                    { key: "date", header: "When" },
                  ]}
                  rows={reportRows}
                />
              )}
            </>
          }
        />
      </Reveal>

      {/* Partner wallet balance snapshot */}
      <Stagger stagger={0.05} className="grid gap-4 sm:grid-cols-3">
        <StaggerItem distance={14} duration={0.35}>
          <StatTile
            label="Wallet spendable"
            value={wallet != null ? formatINR(wallet.spendable) : "—"}
            icon={Wallet}
            tone="emerald"
            loading={fetchingBalance && !wallet}
          />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile
            label="Registered accounts"
            value={fetchingBenes ? "—" : String(registeredBenes.length)}
            icon={CreditCard}
            tone="brand"
            loading={fetchingBenes}
          />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile
            label="Total transfers"
            value={fetching ? "—" : String(transfers.length)}
            icon={Landmark}
            tone="violet"
            loading={fetching}
          />
        </StaggerItem>
      </Stagger>

      {/* Error banner */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              onClick={() => setError(null)}
              aria-label="Dismiss"
              className="text-rose-400 hover:text-rose-600"
            >
              <XCircle className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── HOME ─────────────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {view === "home" && (
          <motion.div
            key="home"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-6"
          >
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <HeroCard
                title="New transfer"
                subtitle="Send money to a registered bank account via IMPS or NEFT"
                cta={
                  registeredBenes.length > 0
                    ? `${registeredBenes.length} registered · Ready to use`
                    : "Add a beneficiary first"
                }
                icon={Send}
                gradient="from-brand-500 to-brand-700"
                glow="from-brand-400/25 to-cyan-400/25"
                onClick={handleStartPayout}
              />
              <HeroCard
                title="Add bank account"
                subtitle="Verify & register a beneficiary — account details stored securely"
                cta="One-time registration · Free for user"
                icon={Plus}
                gradient="from-emerald-500 to-teal-600"
                glow="from-emerald-400/25 to-teal-400/25"
                onClick={() => {
                  setError(null);
                  setView("add-beneficiary");
                }}
              />
            </div>

            {/* Beneficiary list */}
            <KnteerBeneficiaryList
              beneficiaries={beneficiaries}
              loading={fetchingBenes}
              onRefresh={fetchBenes}
              onDelete={async (id) => {
                // Note: deletion not exposed via API — just remove locally
                setBeneficiaries((prev) => prev.filter((b) => b.id !== id));
              }}
            />

            {/* Quick jump to history */}
            {transfers.length > 0 && (
              <button
                onClick={() => setView("history")}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
              >
                <Clock className="h-4 w-4" />
                View {transfers.length} recent transfer
                {transfers.length !== 1 ? "s" : ""}
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </motion.div>
        )}

        {view === "process-payout" && (
          <motion.div
            key="process"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <BackButton onClick={() => setView("home")} />
            <KnteerTransferWizard
              beneficiaries={registeredBenes}
              spendable={wallet?.spendable ?? null}
              onDone={() => {
                setView("home");
                refreshAll();
              }}
              onError={setError}
            />
          </motion.div>
        )}

        {view === "add-beneficiary" && (
          <motion.div
            key="add"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <BackButton onClick={() => setView("home")} />
            <AddKnteerBeneficiaryPanel
              onDone={() => {
                setView("home");
                fetchBenes();
                fetchBalance();
              }}
              onError={setError}
            />
          </motion.div>
        )}

        {view === "history" && (
          <motion.div
            key="history"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <BackButton onClick={() => setView("home")} />
            <DataTable
              title={`${transfers.length} transfer${transfers.length === 1 ? "" : "s"}`}
              columns={cols}
              data={transfers}
              loading={fetching}
              empty="No transfers yet. Send one to see it here."
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* No-account modal */}
      <ModalShell
        open={showNoAccountModal}
        onClose={() => setShowNoAccountModal(false)}
        size="sm"
        eyebrow="Bank Transfer"
        title="No registered bank account yet"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowNoAccountModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setShowNoAccountModal(false);
                setView("add-beneficiary");
              }}
            >
              <Plus className="h-4 w-4" />
              Add account
            </Button>
          </>
        }
      >
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <p className="text-sm text-ink-600">
            You need to add and register a bank account before initiating a transfer. Account
            verification is free — no fee is deducted from your wallet.
          </p>
        </div>
      </ModalShell>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-ink-600 transition-colors hover:text-ink-900"
    >
      <ArrowLeft className="h-4 w-4" />
      Back
    </button>
  );
}

function HeroCard({
  title,
  subtitle,
  cta,
  icon: Icon,
  gradient,
  glow,
  onClick,
}: {
  title: string;
  subtitle: string;
  cta: string;
  icon: React.ComponentType<{ className?: string }>;
  gradient: string;
  glow: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="group relative overflow-hidden rounded-2xl border border-ink-100 bg-white p-6 text-left shadow-sm transition-shadow hover:shadow-lg"
    >
      <div
        className={`absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gradient-to-br ${glow} blur-2xl transition-transform duration-700 group-hover:scale-150`}
      />
      <div className="absolute right-4 top-4 opacity-0 transition-opacity group-hover:opacity-100">
        <ChevronRight className="h-5 w-5 text-brand-500" />
      </div>
      <div className="relative">
        <div
          className={`mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-soft transition-transform group-hover:scale-110 group-hover:rotate-3 ${gradient}`}
        >
          <Icon className="h-7 w-7" />
        </div>
        <h3 className="font-display text-lg font-bold text-ink-900">{title}</h3>
        <p className="mt-1 text-sm text-ink-500">{subtitle}</p>
        <div className="mt-4 inline-flex items-center gap-1 rounded-full bg-ink-50 px-2.5 py-1 text-xs font-semibold text-ink-700">
          <Sparkles className="h-3 w-3" />
          {cta}
        </div>
      </div>
    </motion.button>
  );
}

function KnteerBeneficiaryList({
  beneficiaries,
  loading,
  onRefresh,
  onDelete,
}: {
  beneficiaries: KnteerBeneficiary[];
  loading: boolean;
  onRefresh: () => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const [search, setSearch] = useState("");

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return beneficiaries;
    return beneficiaries.filter(
      (b) =>
        b.accountHolderName.toLowerCase().includes(q) ||
        b.accountLast4.includes(q) ||
        b.ifscCode.toLowerCase().includes(q) ||
        b.bankName.toLowerCase().includes(q) ||
        b.mobile.includes(q)
    );
  }, [beneficiaries, search]);

  if (loading && beneficiaries.length === 0) {
    return (
      <Panel flush className="p-8 text-center text-sm text-ink-500">
        <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
        Loading saved accounts…
      </Panel>
    );
  }

  if (beneficiaries.length === 0) {
    return (
      <EmptyState
        icon={CreditCard}
        title="No registered bank accounts yet"
        message="Add one to start sending transfers — registration is instant."
        compact
      />
    );
  }

  return (
    <Panel flush className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
        <h3 className="inline-flex items-center gap-2 font-display text-base font-semibold text-ink-900">
          <ShieldCheck className="h-5 w-5 text-emerald-600" />
          Bank accounts ({beneficiaries.length})
        </h3>
        <button
          onClick={onRefresh}
          aria-label="Refresh"
          className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Search bar */}
      <div className="border-b border-ink-100 px-5 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input
            className="pl-10 pr-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, account last-4, IFSC, or bank"
            aria-label="Search bank accounts"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            >
              <XCircle className="h-4 w-4" />
            </button>
          )}
        </div>
        {search.trim() && (
          <p className="mt-2 text-[11px] text-ink-500">
            {displayed.length} match{displayed.length === 1 ? "" : "es"} for &ldquo;
            {search.trim()}&rdquo;
          </p>
        )}
      </div>

      {displayed.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-ink-50 text-ink-400">
            <Search className="h-5 w-5" />
          </div>
          <p className="text-sm font-semibold text-ink-700">No matching accounts</p>
          <p className="mt-0.5 text-xs text-ink-500">
            No account matches &ldquo;{search.trim()}&rdquo;.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-ink-100">
          {displayed.map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-ink-50/50"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`grid h-10 w-10 place-items-center rounded-xl ${
                    b.isBankVerified ? "bg-brand-50 text-brand-700" : "bg-emerald-50 text-emerald-600"
                  }`}
                >
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-ink-900">{b.accountHolderName}</p>
                  <p className="font-mono text-xs text-ink-500">
                    ****{b.accountLast4} · {b.ifscCode} · {b.bankName}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {b.isBankVerified ? (
                  <StatusPill status="Verified" />
                ) : (
                  <StatusPill status="Registered" />
                )}
                <button
                  onClick={async () => {
                    if (!confirm("Remove this beneficiary from your list?")) return;
                    await onDelete(b.id);
                  }}
                  aria-label="Remove beneficiary"
                  className="grid h-8 w-8 place-items-center rounded-lg text-rose-700 hover:bg-rose-50 disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Transfer wizard: select-account → verify-account → enter-amount → confirm → result
// ─────────────────────────────────────────────────────────────────────────────

type KnteerTransferResult = {
  id: string;
  referenceId: string | null;
  transactionId: string | null;
  utr: string | null;
  status: TransferStatus;
  amount: number;
  serviceCharge: number;
  gst: number;
  totalDebit: number;
  mode: string;
  beneficiaryName: string;
  bankName: string | null;
  accountLast4: string;
  createdAt: string;
};

type Quote = {
  serviceCharge: number;
  gst: number;
  totalDebit: number;
  gstPercent: number;
  limit: number | null;
  withinLimit: boolean;
  spendable: number;
  affordable: boolean;
};

function KnteerTransferWizard({
  beneficiaries,
  spendable,
  onDone,
  onError,
}: {
  beneficiaries: KnteerBeneficiary[];
  spendable: number | null;
  onDone: () => void;
  onError: (msg: string | null) => void;
}) {
  const [step, setStep] = useState<WizardStep>("select-account");
  const [selected, setSelected] = useState<KnteerBeneficiary | null>(null);
  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState("1000");
  const [paymentMode, setPaymentMode] = useState<"IMPS" | "NEFT">("IMPS");
  const [remarks, setRemarks] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<KnteerTransferResult | null>(null);

  // Live, server-authoritative scheme quote for the entered amount.
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const amountNum = Number(amount) || 0;

  // Debounced quote fetch whenever the amount/mode changes on the amount step.
  useEffect(() => {
    if (step !== "enter-amount") return;
    if (!(amountNum > 0)) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    let cancelled = false;
    setQuoteLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/knteer-payout/quote?amount=${amountNum}&mode=${paymentMode}`
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setQuote(null);
          setQuoteError(typeof data.error === "string" ? data.error : "Could not price this amount.");
        } else {
          setQuote(data as Quote);
          setQuoteError(null);
        }
      } catch {
        if (!cancelled) {
          setQuote(null);
          setQuoteError("Could not price this amount.");
        }
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [step, amountNum, paymentMode]);

  // Submit is allowed only when a scheme slab priced it, it's within the slab
  // ceiling, and the wallet can cover the full debit (amount + charge + GST).
  const canProceed = Boolean(
    quote &&
      !quoteLoading &&
      quote.withinLimit &&
      quote.affordable &&
      (quote.limit == null || amountNum <= quote.limit) &&
      amountNum > 0
  );

  const displayedBenes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return beneficiaries;
    return beneficiaries.filter(
      (b) =>
        b.accountHolderName.toLowerCase().includes(q) ||
        b.accountLast4.includes(q) ||
        b.ifscCode.toLowerCase().includes(q) ||
        b.bankName.toLowerCase().includes(q)
    );
  }, [beneficiaries, search]);

  async function submitWithPin(pin: string): Promise<string | null> {
    if (!selected) return "No beneficiary selected";
    setSubmitting(true);
    try {
      const nonceRes = await fetch("/api/security/nonce");
      if (!nonceRes.ok) throw new Error("Could not start a secure session. Please retry.");
      const { nonce } = (await nonceRes.json()) as { nonce: string };

      const res = await fetch("/api/knteer-payout/transfer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-submit-nonce": nonce,
          "x-txn-pin": pin,
        },
        body: JSON.stringify({
          beneficiaryId: selected.id,
          amount: amountNum,
          paymentMode,
          remarks: remarks.trim() || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if ((data as { txnPin?: unknown }).txnPin)
          return typeof data.error === "string" ? data.error : "PIN verification failed";
        const fieldErrors = (data as { error?: { fieldErrors?: Record<string, string[]> } })
          .error?.fieldErrors;
        const firstField = fieldErrors ? Object.values(fieldErrors)[0]?.[0] : undefined;
        const msg =
          typeof data.error === "string"
            ? data.error
            : ((data as { error?: { formErrors?: string[] } }).error?.formErrors?.[0]) ??
              firstField ??
              "Failed to submit transfer";
        throw new Error(msg);
      }

      setPinOpen(false);
      const transfer = (data as { transfer: KnteerTransferResult }).transfer;
      setResult(transfer);
      setStep("result");
      return null;
    } catch (err) {
      setPinOpen(false);
      onError(err instanceof Error ? err.message : "Failed to submit transfer");
      return null;
    } finally {
      setSubmitting(false);
    }
  }

  // ── Steps ─────────────────────────────────────────────────────────────────

  if (step === "select-account") {
    return (
      <Panel flush className="overflow-hidden">
        <div className="border-b border-ink-100 px-5 py-4">
          <h3 className="inline-flex items-center gap-2 font-display text-base font-semibold text-ink-900">
            <CreditCard className="h-5 w-5 text-brand-700" />
            Select bank account
          </h3>
          <p className="mt-0.5 text-xs text-ink-500">
            Choose a registered beneficiary to send the transfer to.
          </p>
        </div>

        <div className="border-b border-ink-100 px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input
              className="pl-10 pr-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, account last-4, IFSC, or bank"
              autoFocus
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-ink-400 hover:bg-ink-100 hover:text-ink-700"
              >
                <XCircle className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {displayedBenes.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-ink-50 text-ink-400">
              <Search className="h-5 w-5" />
            </div>
            <p className="text-sm font-semibold text-ink-700">No matching accounts</p>
          </div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {displayedBenes.map((b) => (
              <li key={b.id}>
                <button
                  onClick={() => {
                    setSelected(b);
                    setStep("verify-account");
                  }}
                  className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-brand-50/50"
                >
                  <div className="flex items-center gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
                        {b.accountHolderName}
                        {b.isBankVerified && (
                          <BadgeCheck className="h-4 w-4 text-emerald-500" />
                        )}
                      </p>
                      <p className="font-mono text-xs text-ink-500">
                        ****{b.accountLast4} · {b.ifscCode} · {b.bankName}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="h-5 w-5 text-ink-400" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    );
  }

  if (step === "verify-account" && selected) {
    return (
      <Panel flush className="overflow-hidden">
        <div className="border-b border-ink-100 px-5 py-4">
          <h3 className="inline-flex items-center gap-2 font-display text-base font-semibold text-ink-900">
            <ShieldCheck className="h-5 w-5 text-brand-700" />
            Confirm account
          </h3>
          <p className="mt-0.5 text-xs text-ink-500">
            Confirm these are the right account details before you transfer.
          </p>
        </div>
        <div className="space-y-4 p-5">
          {/* Account identity card */}
          <div
            className={`rounded-2xl border p-4 ${
              selected.isBankVerified
                ? "border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50"
                : "border-brand-200 bg-brand-50/50"
            }`}
          >
            <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest">
              {selected.isBankVerified ? (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <BadgeCheck className="h-3.5 w-3.5" /> Verified by bank
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-brand-700">
                  <ShieldCheck className="h-3.5 w-3.5" /> Registered
                </span>
              )}
            </div>
            <p className="font-display text-xl font-bold text-ink-900">
              {selected.accountHolderName}
            </p>
            <p className="mt-0.5 text-xs text-ink-500">{selected.bankName}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <InfoTile label="Account" value={`****${selected.accountLast4}`} mono />
            <InfoTile label="IFSC" value={selected.ifscCode} mono />
            <InfoTile label="Bank" value={selected.bankName} />
            <InfoTile label="Mobile" value={selected.mobile} mono />
          </div>

          <p className="rounded-lg border border-ink-100 bg-ink-50/60 px-3 py-2 text-[11px] text-ink-500">
            Money sent via IMPS/NEFT cannot be recalled. Make sure the name above matches the
            person you intend to pay.
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setStep("select-account")}>
              Back
            </Button>
            <Button onClick={() => setStep("enter-amount")}>
              <ShieldCheck className="h-4 w-4" />
              Confirm &amp; continue
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Panel>
    );
  }

  if (step === "enter-amount" && selected) {
    return (
      <Panel flush className="overflow-hidden">
        <div className="border-b border-ink-100 px-5 py-4">
          <h3 className="inline-flex items-center gap-2 font-display text-base font-semibold text-ink-900">
            <IndianRupee className="h-5 w-5 text-brand-700" />
            Transfer details
          </h3>
        </div>
        <div className="space-y-4 p-5">
          <div className="flex items-center gap-3 rounded-xl bg-brand-50/70 p-3">
            <Building2 className="h-5 w-5 text-brand-700" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink-900">
                {selected.accountHolderName}
              </p>
              <p className="font-mono text-xs text-brand-800">
                ****{selected.accountLast4} · {selected.ifscCode}
              </p>
            </div>
            <button
              onClick={() => setStep("select-account")}
              className="text-xs font-semibold text-brand-700 hover:underline"
            >
              Change
            </button>
          </div>

          <div>
            <Label>Amount (₹)</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={amount}
              min={1}
              max={200000}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div>
            <Label>Payment mode</Label>
            <div className="grid grid-cols-2 gap-2">
              <ModeChip
                active={paymentMode === "IMPS"}
                label="IMPS (instant)"
                icon={<Zap className="h-3.5 w-3.5" />}
                onClick={() => setPaymentMode("IMPS")}
              />
              <ModeChip
                active={paymentMode === "NEFT"}
                label="NEFT"
                icon={<Banknote className="h-3.5 w-3.5" />}
                onClick={() => setPaymentMode("NEFT")}
              />
            </div>
          </div>

          <div>
            <Label>Remarks (optional)</Label>
            <Input
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g. Salary, Payment for invoice #123"
              maxLength={100}
            />
          </div>

          {spendable != null && (
            <p className="text-right text-xs text-ink-500">
              Wallet spendable: <span className="font-semibold text-ink-700">{inr2(spendable)}</span>
            </p>
          )}

          {amountNum > 0 && (
            <div className="rounded-xl border border-ink-100 bg-ink-50/60 p-4 text-sm">
              {quoteLoading ? (
                <div className="flex items-center justify-center gap-2 py-2 text-ink-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Pricing…
                </div>
              ) : quote && quote.withinLimit ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-ink-600">Beneficiary receives</span>
                    <span className="font-semibold text-ink-900">{inr2(amountNum)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-600">Service charge</span>
                    <span className="text-ink-700">{inr2(quote.serviceCharge)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-600">GST ({quote.gstPercent}%)</span>
                    <span className="text-ink-700">{inr2(quote.gst)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between border-t border-ink-200 pt-2">
                    <span className="font-semibold text-ink-800">Total debited from wallet</span>
                    <span className="font-display text-base font-bold text-brand-800">
                      {inr2(quote.totalDebit)}
                    </span>
                  </div>
                  {!quote.affordable && (
                    <p className="flex items-center gap-1.5 pt-1 text-xs font-medium text-rose-600">
                      <AlertCircle className="h-3.5 w-3.5" />
                      Insufficient wallet balance — you need {inr2(quote.totalDebit)} spendable.
                    </p>
                  )}
                  {quote.limit != null && amountNum > quote.limit && (
                    <p className="flex items-center gap-1.5 pt-1 text-xs font-medium text-rose-600">
                      <AlertCircle className="h-3.5 w-3.5" />
                      Maximum allowed per transfer is {inr2(quote.limit)}.
                    </p>
                  )}
                </div>
              ) : (
                <p className="flex items-center gap-1.5 text-xs font-medium text-rose-600">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {quoteError ??
                    "No pricing is configured for this amount. Please contact support or try a different amount."}
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setStep("verify-account")}>
              Back
            </Button>
            <Button onClick={() => setStep("confirm")} disabled={!canProceed}>
              Review &amp; confirm
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Panel>
    );
  }

  if (step === "confirm" && selected) {
    return (
      <Panel flush className="overflow-hidden">
        <div className="border-b border-ink-100 px-5 py-4">
          <h3 className="inline-flex items-center gap-2 font-display text-base font-semibold text-ink-900">
            <CheckCircle2 className="h-5 w-5 text-brand-700" />
            Confirm transfer
          </h3>
          <p className="mt-0.5 text-xs text-ink-500">
            Review carefully — this cannot be undone once approved.
          </p>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <InfoTile label="Beneficiary" value={selected.accountHolderName} />
            <InfoTile label="Account" value={`****${selected.accountLast4}`} mono />
            <InfoTile label="IFSC" value={selected.ifscCode} mono />
            <InfoTile label="Mode" value={paymentMode === "IMPS" ? "IMPS (instant)" : "NEFT"} />
            {remarks.trim() && (
              <div className="col-span-2">
                <InfoTile label="Remarks" value={remarks.trim()} />
              </div>
            )}
            <div className="col-span-2 rounded-xl bg-brand-50/70 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-brand-700">
                Transfer amount
              </p>
              <p className="font-display text-2xl font-bold text-brand-800">{inr2(amountNum)}</p>
              {quote && quote.withinLimit && (
                <div className="mt-2 space-y-1 border-t border-brand-200/70 pt-2 text-xs text-brand-900/90">
                  <div className="flex items-center justify-between">
                    <span>Service charge</span>
                    <span>{inr2(quote.serviceCharge)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>GST ({quote.gstPercent}%)</span>
                    <span>{inr2(quote.gst)}</span>
                  </div>
                  <div className="flex items-center justify-between font-semibold">
                    <span>Total debited from wallet</span>
                    <span>{inr2(quote.totalDebit)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setStep("enter-amount")}>
              Back
            </Button>
            <Button className="flex-1" onClick={() => setPinOpen(true)} disabled={!canProceed}>
              <Send className="h-4 w-4" />
              Confirm &amp; send
            </Button>
          </div>
        </div>

        <TxnPinDialog
          open={pinOpen}
          title="Confirm transfer"
          detail={`${paymentMode} · ${selected.accountHolderName}`}
          amount={amountNum}
          busy={submitting}
          onConfirm={submitWithPin}
          onCancel={() => !submitting && setPinOpen(false)}
        />
      </Panel>
    );
  }

  if (step === "result" && result) {
    return <KnteerTransferReceipt result={result} onDone={onDone} />;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Add-beneficiary panel (verify → register)
// ─────────────────────────────────────────────────────────────────────────────

type VerificationState = {
  isValid: boolean;
  accountHolderName: string | null;
  bankName: string | null;
  verificationCharges: number;
  referenceId: string | null;
  message: string;
} | null;

function AddKnteerBeneficiaryPanel({
  onDone,
  onError,
}: {
  onDone: () => void;
  onError: (msg: string | null) => void;
}) {
  // Form fields
  const [accNumber, setAccNumber] = useState("");
  const [confirmAcc, setConfirmAcc] = useState("");
  const [ifscCode, setIfscCode] = useState("");
  const [accountHolderName, setAccountHolderName] = useState("");
  const [bankName, setBankName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");

  // Flow state
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<VerificationState>(null);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<
    | null
    | { kind: "success"; accountLast4: string; accountHolderName: string }
    | { kind: "failed"; message: string }
  >(null);
  const [countdown, setCountdown] = useState(3);

  // Celebration countdown
  useEffect(() => {
    if (outcome?.kind !== "success") return;
    if (countdown <= 0) {
      onDone();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [outcome, countdown, onDone]);

  const canVerify =
    !verifying &&
    ACCOUNT_RE.test(accNumber) &&
    accNumber === confirmAcc &&
    IFSC_RE.test(ifscCode.toUpperCase());

  const canRegister =
    !submitting &&
    canVerify &&
    accountHolderName.trim().length >= 3 &&
    /^\d{10}$/.test(mobile) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function handleVerify() {
    onError(null);
    setVerified(null);
    setVerifying(true);
    try {
      const res = await fetch("/api/knteer-payout/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountNumber: accNumber,
          ifscCode: ifscCode.toUpperCase(),
          bankName: bankName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg =
          typeof data.error === "string"
            ? data.error
            : (data.error?.formErrors?.[0] as string | undefined) ?? "Verification failed";
        throw new Error(msg);
      }
      const v = (data as { verification: VerificationState }).verification;
      setVerified(v);
      // Auto-fill name from bank if valid
      if (v?.accountHolderName && !accountHolderName.trim()) {
        setAccountHolderName(v.accountHolderName);
      }
      if (v?.bankName && !bankName.trim()) {
        setBankName(v.bankName);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not verify account");
    } finally {
      setVerifying(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    setOutcome(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/knteer-payout/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountNumber: accNumber,
          ifscCode: ifscCode.toUpperCase(),
          accountHolderName: accountHolderName.trim(),
          bankName: bankName.trim(),
          mobile,
          email: email.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const fieldErrors = (data.error as { fieldErrors?: Record<string, string[]> } | undefined)
          ?.fieldErrors;
        const firstField = fieldErrors ? Object.values(fieldErrors)[0]?.[0] : undefined;
        const msg =
          typeof data.error === "string"
            ? data.error
            : (data.error?.formErrors?.[0] as string | undefined) ?? firstField ?? "Failed to register";
        throw new Error(msg);
      }
      const acc = (data as { account: { accountLast4: string; accountHolderName: string } }).account;
      setOutcome({
        kind: "success",
        accountLast4: acc.accountLast4,
        accountHolderName: acc.accountHolderName,
      });
      setCountdown(3);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to register account");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Success overlay ────────────────────────────────────────────────────────
  if (outcome?.kind === "success") {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="overflow-hidden rounded-3xl border border-ink-100 bg-white shadow-glow"
      >
        <div className="bg-gradient-to-br from-emerald-500 to-teal-600 p-8 text-center text-white">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", damping: 12, delay: 0.1 }}
            className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-white/20"
          >
            <CheckCircle2 className="h-9 w-9" />
          </motion.div>
          <h3 className="font-display text-xl font-bold">Account registered!</h3>
          <p className="mt-1 text-sm text-white/80">
            {outcome.accountHolderName} · ****{outcome.accountLast4}
          </p>
        </div>
        <div className="p-6 text-center">
          <p className="text-sm text-ink-600">
            Your bank account has been successfully registered. You can now use it to send
            transfers.
          </p>
          <p className="mt-3 text-xs text-ink-400">
            Returning to your account list in {countdown}s…
          </p>
          <Button className="mt-4 w-full" onClick={onDone}>
            Go to accounts
          </Button>
        </div>
      </motion.div>
    );
  }

  return (
    <form onSubmit={handleRegister} className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Form */}
      <Panel flush className="overflow-hidden lg:col-span-2">
        <div className="border-b border-ink-100 bg-gradient-to-r from-brand-50/60 to-teal-50/60 px-5 py-4">
          <h3 className="inline-flex items-center gap-2 font-display text-base font-semibold text-ink-900">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-teal-600 text-white shadow-soft">
              <ShieldCheck className="h-4 w-4" />
            </div>
            Add &amp; register bank account
          </h3>
          <p className="ml-10 mt-1 text-xs text-ink-500">
            Verify the account first to auto-fill the account holder name from bank records,
            then register to save it for future transfers.
          </p>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label>Account number *</Label>
              <div className="relative">
                <Hash className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <Input
                  className="pl-10"
                  value={accNumber}
                  onChange={(e) => {
                    setAccNumber(e.target.value.replace(/\D/g, ""));
                    setVerified(null);
                  }}
                  placeholder="Enter account number"
                  maxLength={18}
                />
              </div>
            </div>
            <div>
              <Label>Confirm account number *</Label>
              <div className="relative">
                <Hash className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <Input
                  className="pl-10"
                  value={confirmAcc}
                  onChange={(e) => setConfirmAcc(e.target.value.replace(/\D/g, ""))}
                  placeholder="Re-enter account number"
                  maxLength={18}
                />
              </div>
              {confirmAcc && accNumber !== confirmAcc && (
                <p className="mt-1 text-xs text-rose-600">Account numbers do not match</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label>IFSC code *</Label>
              <Input
                value={ifscCode}
                onChange={(e) => {
                  setIfscCode(e.target.value.toUpperCase());
                  setVerified(null);
                }}
                placeholder="e.g. SBIN0001234"
                maxLength={11}
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={!canVerify || verifying}
                onClick={handleVerify}
              >
                {verifying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : verified?.isValid ? (
                  <BadgeCheck className="h-4 w-4 text-emerald-600" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                {verifying
                  ? "Verifying…"
                  : verified?.isValid
                  ? "Re-verify"
                  : "Verify account"}
              </Button>
            </div>
          </div>

          {/* Verification result banner */}
          {verified && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className={`rounded-xl border p-3 ${
                verified.isValid
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              }`}
            >
              {verified.isValid ? (
                <div className="flex items-start gap-2">
                  <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">
                      {verified.accountHolderName ?? "Account verified"}
                    </p>
                    {verified.bankName && (
                      <p className="text-xs opacity-80">{verified.bankName}</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p className="text-sm">{verified.message || "Account could not be verified"}</p>
                </div>
              )}
            </motion.div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label>Account holder name *</Label>
              <div className="relative">
                <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <Input
                  className="pl-10"
                  value={accountHolderName}
                  onChange={(e) => setAccountHolderName(e.target.value)}
                  placeholder="As per bank records"
                />
              </div>
            </div>
            <div>
              <Label>Bank name *</Label>
              <div className="relative">
                <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <Input
                  className="pl-10"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="e.g. State Bank of India"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label>Mobile number *</Label>
              <Input
                type="tel"
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="10-digit mobile"
                maxLength={10}
              />
            </div>
            <div>
              <Label>Email *</Label>
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contact@example.com"
              />
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={!canRegister || submitting}>
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            {submitting ? "Registering…" : "Register bank account"}
          </Button>
        </div>
      </Panel>

      {/* Help panel */}
      <div className="space-y-4">
        <Panel className="p-5 text-sm">
          <h4 className="mb-3 font-display font-semibold text-ink-900">How it works</h4>
          <ol className="space-y-3 text-ink-600">
            <li className="flex gap-2">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-700">
                1
              </span>
              <span>Enter account number and IFSC, then click Verify to auto-fill the holder name from the bank.</span>
            </li>
            <li className="flex gap-2">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-700">
                2
              </span>
              <span>Fill in mobile and other details, then click Register. The account is saved securely — you won't need to re-enter it.</span>
            </li>
            <li className="flex gap-2">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-700">
                3
              </span>
              <span>Use &ldquo;New transfer&rdquo; anytime to send money to any registered account.</span>
            </li>
          </ol>
        </Panel>

        <Panel className="p-5 text-sm">
          <h4 className="mb-2 font-display font-semibold text-ink-900">Security</h4>
          <p className="text-xs text-ink-500">
            Your full account number is encrypted (AES-256) in our database. Only the last 4
            digits are displayed. The full number is decrypted server-side only when initiating
            a transfer — never sent to your browser.
          </p>
        </Panel>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Transfer receipt
// ─────────────────────────────────────────────────────────────────────────────

function KnteerTransferReceipt({
  result,
  onDone,
}: {
  result: KnteerTransferResult;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const { session } = useAuth();
  const payBy = session?.userCode
    ? `Pay by Paybridgex · RT Code ${session.userCode}`
    : "Pay by Paybridgex";

  const isSuccess = result.status === "SUCCESS";
  const isFailed = result.status === "FAILED" || result.status === "REJECTED";
  const isPending = PENDING_STATES.has(result.status);
  const headerGradient = isSuccess
    ? "from-emerald-500 to-emerald-700"
    : isFailed
    ? "from-rose-500 to-rose-700"
    : "from-amber-500 to-amber-600";

  const displayDate = formatIST(result.createdAt);
  const chargesTotal = result.serviceCharge + result.gst;

  const summaryText = `Bank Transfer Receipt
Status: ${TX_STATUS_LABEL[result.status]}
Amount: ₹${result.amount.toFixed(2)}
Beneficiary: ${result.beneficiaryName}
Account: ****${result.accountLast4}
${result.bankName ? `Bank: ${result.bankName}\n` : ""}Mode: ${result.mode}
${result.utr ? `UTR: ${result.utr}\n` : ""}Reference ID: ${result.referenceId ?? result.id}
${result.transactionId ? `Transaction ID: ${result.transactionId}\n` : ""}Date: ${displayDate}

${payBy}`;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="overflow-hidden rounded-3xl border border-ink-100 bg-white shadow-glow"
    >
      <div className={`bg-gradient-to-br ${headerGradient} p-6 text-center text-white`}>
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", damping: 12, delay: 0.1 }}
          className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-white/20 backdrop-blur"
        >
          {isSuccess ? (
            <CheckCircle2 className="h-9 w-9" />
          ) : isFailed ? (
            <XCircle className="h-9 w-9" />
          ) : (
            <Clock className="h-9 w-9" />
          )}
        </motion.div>
        <h3 className="font-display text-xl font-bold">
          {isSuccess ? "Transfer sent!" : isFailed ? "Transfer failed" : "Transfer processing"}
        </h3>
        <p className="mt-1 text-sm text-white/80">
          {isPending
            ? "Your transfer is being processed — UTR will appear once it clears."
            : TX_STATUS_LABEL[result.status]}
        </p>
        <p className="mt-3 font-display text-3xl font-bold">{inr2(result.amount)}</p>
      </div>

      <div className="p-6">
        <div className="mb-5 border-t-2 border-dashed border-ink-200" />

        <div className="space-y-2">
          <ReceiptRow label="Beneficiary" value={result.beneficiaryName} />
          <ReceiptRow label="Account" value={`****${result.accountLast4}`} mono />
          {result.bankName && <ReceiptRow label="Bank" value={result.bankName} />}
          <ReceiptRow label="Mode" value={result.mode} />
          {result.utr && <ReceiptRow label="UTR" value={result.utr} mono copy />}
          <ReceiptRow label="Reference ID" value={result.referenceId ?? result.id} mono copy />
          {result.transactionId && (
            <ReceiptRow label="Transaction ID" value={result.transactionId} mono copy />
          )}
          <ReceiptRow label="Amount" value={inr2(result.amount)} />
          {chargesTotal > 0 && (
            <ReceiptRow label="Charges + GST" value={inr2(chargesTotal)} />
          )}
          {result.totalDebit > result.amount && (
            <ReceiptRow label="Total debited" value={inr2(result.totalDebit)} strong />
          )}
          <ReceiptRow label="Date" value={displayDate} />
        </div>

        <div className="my-5 border-t-2 border-dashed border-ink-200" />

        <p className="mb-4 text-center text-sm font-semibold text-emerald-600">{payBy}</p>

        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-ink-500">
          Share receipt
        </p>
        <div className="grid grid-cols-3 gap-2">
          <ShareBtn
            icon={<MessageCircle className="h-5 w-5" />}
            label="WhatsApp"
            color="bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            onClick={() =>
              window.open(`https://wa.me/?text=${encodeURIComponent(summaryText)}`, "_blank")
            }
          />
          <ShareBtn
            icon={copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
            label={copied ? "Copied!" : "Copy"}
            color="bg-brand-50 text-brand-700 hover:bg-brand-100"
            onClick={async () => {
              await navigator.clipboard.writeText(summaryText);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          />
          <ShareBtn
            icon={<Download className="h-5 w-5" />}
            label="Download"
            color="bg-violet-50 text-violet-700 hover:bg-violet-100"
            onClick={() => {
              const blob = new Blob([summaryText], { type: "text/plain" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `bank_transfer_${result.referenceId ?? result.id}.txt`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          />
        </div>

        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onDone}>
            Done
          </Button>
          {isPending && (
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                window.location.href = `/api/knteer-payout/status?id=${result.id}`;
              }}
            >
              <Search className="h-4 w-4" />
              Check status
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small reusable components
// ─────────────────────────────────────────────────────────────────────────────

function ModeChip({
  active,
  disabled,
  label,
  icon,
  note,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  icon?: React.ReactNode;
  note?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-0.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
        active
          ? "border-brand-500 bg-brand-600 text-white shadow-soft"
          : disabled
          ? "border-ink-100 bg-ink-50 text-ink-400"
          : "border-ink-200 bg-white text-ink-700 hover:border-brand-300"
      }`}
    >
      <span className="inline-flex items-center gap-1">
        {icon}
        {label}
      </span>
      {note && <span className="text-[10px] font-normal opacity-70">{note}</span>}
    </button>
  );
}

function InfoTile({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl bg-ink-50/60 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-500">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold text-ink-900 ${mono ? "font-mono" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function ReceiptRow({
  label,
  value,
  mono,
  strong,
  copy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
  copy?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between border-b border-ink-100 py-2 last:border-b-0">
      <span className="text-sm text-ink-500">{label}</span>
      <span className="flex items-center gap-1.5">
        <span
          className={`text-sm ${mono ? "font-mono" : ""} ${
            strong ? "font-bold text-ink-900" : "font-semibold text-ink-800"
          }`}
        >
          {value}
        </span>
        {copy && (
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            aria-label="Copy"
            className="rounded p-0.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
          </button>
        )}
      </span>
    </div>
  );
}

function ShareBtn({
  icon,
  label,
  color,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1 rounded-xl p-3 text-[11px] font-semibold transition-colors ${color}`}
    >
      {icon}
      {label}
    </button>
  );
}
