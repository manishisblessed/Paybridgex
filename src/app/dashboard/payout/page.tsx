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
  Lock,
  MessageCircle,
  Plus,
  Printer,
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
import { formatINR } from "@/lib/utils";
import { useAuth } from "@/lib/useAuth";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Beneficiary = {
  id: string;
  accountLast4: string;
  ifsc: string;
  holderName: string;
  verifiedName: string | null;
  contactMobile: string | null;
  isVerified: boolean;
  verificationStatus: "PENDING" | "SUCCESS" | "FAILED";
  failureReason: string | null;
  createdAt: string;
  verifiedAt: string | null;
};

type ServiceStatus = {
  available: boolean;
  partnerEnabled: boolean;
  adminEnabled: boolean;
  reason: string | null;
  balances: { walletBalance: number; heldBalance: number; spendable: number } | null;
};

type Fee = { base: number; gst: number; total: number; gstPercent: number };

type PayoutStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "PROCESSING"
  | "SUCCESS"
  | "FAILED"
  | "REJECTED"
  | "REVERSED";

type Payout = {
  id: string;
  beneficiaryName: string;
  accountLast4: string;
  mode: "IMPS";
  amount: number;
  serviceCharge: number;
  gst: number;
  totalDebit: number;
  status: PayoutStatus;
  utr: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
};

type Balances = { walletBalance: number; heldBalance: number; spendable: number };

type Quote = { serviceCharge: number; gst: number; totalDebit: number; gstPercent: number };

type View = "home" | "process-payout" | "add-beneficiary" | "history";
type WizardStep = "select-account" | "enter-amount" | "confirm" | "result";

// ─────────────────────────────────────────────────────────────────────────────
// Constants + helpers
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<PayoutStatus, "success" | "danger" | "warning" | "brand" | "default"> = {
  SUCCESS: "success",
  FAILED: "danger",
  REJECTED: "danger",
  REVERSED: "danger",
  PROCESSING: "brand",
  APPROVED: "brand",
  PENDING_APPROVAL: "warning",
  DRAFT: "default",
};

const STATUS_LABEL: Record<PayoutStatus, string> = {
  SUCCESS: "Success",
  FAILED: "Failed",
  REJECTED: "Rejected",
  REVERSED: "Reversed",
  PROCESSING: "Processing",
  APPROVED: "Approved",
  PENDING_APPROVAL: "Pending approval",
  DRAFT: "Draft",
};

const inr2 = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_RE = /^\d{9,18}$/;

// ─────────────────────────────────────────────────────────────────────────────
// The page
// ─────────────────────────────────────────────────────────────────────────────

export default function PayoutPage() {
  const [view, setView] = useState<View>("home");
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState<Payout[]>([]);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [fetching, setFetching] = useState(true);

  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [fetchingBenes, setFetchingBenes] = useState(true);
  const [fee, setFee] = useState<Fee | null>(null);

  const [service, setService] = useState<ServiceStatus | null>(null);
  const [loadingService, setLoadingService] = useState(true);

  const [showNoAccountModal, setShowNoAccountModal] = useState(false);

  const verifiedBenes = useMemo(() => beneficiaries.filter((b) => b.isVerified), [beneficiaries]);

  // ── Fetchers ───────────────────────────────────────────────────────────────

  const fetchPayouts = useCallback(async () => {
    try {
      setFetching(true);
      const res = await fetch("/api/payout");
      if (!res.ok) throw new Error("Failed to fetch payouts");
      const json = await res.json();
      setRows(json.payouts as Payout[]);
      setBalances(json.balances as Balances);
    } catch {
      setError("Could not load payouts.");
    } finally {
      setFetching(false);
    }
  }, []);

  const fetchBenes = useCallback(async () => {
    try {
      setFetchingBenes(true);
      const res = await fetch("/api/payout/beneficiaries");
      if (!res.ok) throw new Error("Failed to fetch beneficiaries");
      const json = await res.json();
      setBeneficiaries(json.beneficiaries as Beneficiary[]);
      setFee(json.fee as Fee);
    } catch {
      // silent: the UI shows the "no accounts" state naturally
    } finally {
      setFetchingBenes(false);
    }
  }, []);

  const fetchService = useCallback(async () => {
    try {
      setLoadingService(true);
      const res = await fetch("/api/payout/service-status");
      if (!res.ok) throw new Error();
      const json = (await res.json()) as ServiceStatus;
      setService(json);
      if (json.balances) setBalances(json.balances);
    } catch {
      setService({
        available: false,
        partnerEnabled: false,
        adminEnabled: false,
        reason: null,
        balances: null,
      });
    } finally {
      setLoadingService(false);
    }
  }, []);

  useEffect(() => {
    fetchPayouts();
    fetchBenes();
    fetchService();
  }, [fetchPayouts, fetchBenes, fetchService]);

  const refreshAll = useCallback(() => {
    fetchPayouts();
    fetchBenes();
    fetchService();
  }, [fetchPayouts, fetchBenes, fetchService]);

  const handleStartPayout = () => {
    if (verifiedBenes.length === 0) {
      setShowNoAccountModal(true);
      return;
    }
    setError(null);
    setView("process-payout");
  };

  // ── Report rows for CSV/PDF/XLSX ──────────────────────────────────────────
  const reportRows = rows.map((r) => ({
    id: r.id,
    beneficiary: r.beneficiaryName,
    account: `****${r.accountLast4}`,
    mode: r.mode,
    amount: r.amount,
    charge: r.serviceCharge,
    gst: r.gst,
    total: r.totalDebit,
    status: STATUS_LABEL[r.status],
    utr: r.utr ?? "—",
    date: new Date(r.createdAt).toLocaleString("en-IN"),
  }));

  const cols: Column<Payout>[] = [
    {
      key: "beneficiaryName",
      header: "Beneficiary",
      render: (r) => (
        <div>
          <div className="font-semibold text-ink-900">{r.beneficiaryName}</div>
          <div className="font-mono text-xs text-ink-500">****{r.accountLast4} · {r.mode}</div>
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
      header: "Total debit",
      align: "right",
      render: (r) => (
        <div className="text-right">
          <div className="font-semibold">{inr2(r.totalDebit)}</div>
          <div className="text-[11px] text-ink-500">+{inr2(r.serviceCharge + r.gst)} fees</div>
        </div>
      ),
    },
    {
      key: "utr",
      header: "UTR",
      render: (r) =>
        r.utr ? <span className="font-mono text-xs">{r.utr}</span> : <span className="text-xs text-ink-400">—</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <div>
          <Badge variant={STATUS_BADGE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
          {r.status === "FAILED" && r.failureReason && (
            <div className="mt-1 max-w-[200px] truncate text-[11px] text-rose-600" title={r.failureReason}>
              {r.failureReason}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "createdAt",
      header: "When",
      render: (r) => (
        <span className="whitespace-nowrap text-xs text-ink-500">
          {new Date(r.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
      <PageHeader
        eyebrow="Payouts"
        title="Send a payout"
        description="Disburse to any verified bank account via IMPS. The beneficiary receives the full amount; service charge + 18% GST are added on top of your debit."
        actions={
          <>
            <ServicePill loading={loadingService} status={service} onRefresh={fetchService} />
            <Button variant="outline" onClick={refreshAll} disabled={fetching}>
              <RefreshCw className={`h-4 w-4 ${fetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {rows.length > 0 && (
              <ReportActions
                filename="payouts"
                title="Paybridgex · Payouts"
                subtitle="My payouts"
                columns={[
                  { key: "id", header: "Payout ID" },
                  { key: "beneficiary", header: "Beneficiary" },
                  { key: "account", header: "Account" },
                  { key: "mode", header: "Mode" },
                  { key: "amount", header: "Amount (INR)" },
                  { key: "charge", header: "Service charge" },
                  { key: "gst", header: "GST" },
                  { key: "total", header: "Total debit" },
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

      {/* Wallet snapshot — always visible */}
      <Stagger stagger={0.05} className="grid gap-4 sm:grid-cols-3">
        <StaggerItem distance={14} duration={0.35}>
          <StatTile label="Spendable" value={balances ? formatINR(balances.spendable) : "—"} icon={Wallet} tone="emerald" loading={fetching && !balances} />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile label="Wallet balance" value={balances ? formatINR(balances.walletBalance) : "—"} icon={Landmark} tone="brand" loading={fetching && !balances} />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile label="On hold" value={balances ? formatINR(balances.heldBalance) : "—"} icon={Lock} tone="violet" loading={fetching && !balances} />
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
            <button onClick={() => setError(null)} aria-label="Dismiss" className="text-rose-400 hover:text-rose-600">
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
                title="New payout"
                subtitle="Send money to a verified bank account via IMPS"
                cta={verifiedBenes.length > 0 ? `${verifiedBenes.length} verified · Ready to use` : "Add a beneficiary first"}
                icon={Send}
                gradient="from-brand-500 to-brand-700"
                glow="from-brand-400/25 to-cyan-400/25"
                onClick={handleStartPayout}
              />
              <HeroCard
                title="Add bank account"
                subtitle="Verify via penny-drop & save to your beneficiary book"
                cta={fee ? `${inr2(fee.total)} · One-time per account` : "One-time verification fee"}
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
            <BeneficiaryList
              beneficiaries={beneficiaries}
              loading={fetchingBenes}
              onRefresh={fetchBenes}
              onDelete={async (id) => {
                await fetch(`/api/payout/beneficiaries?id=${encodeURIComponent(id)}`, { method: "DELETE" });
                fetchBenes();
              }}
              onRecheck={async (id) => {
                const res = await fetch("/api/payout/beneficiaries", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ id }),
                });
                const data = await res.json();
                if (data.beneficiary) {
                  setBeneficiaries((prev) => prev.map((b) => (b.id === id ? data.beneficiary : b)));
                }
              }}
            />

            {/* Quick jump to history */}
            {rows.length > 0 && (
              <button
                onClick={() => setView("history")}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
              >
                <Clock className="h-4 w-4" />
                View {rows.length} recent payout{rows.length !== 1 ? "s" : ""}
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
            <ProcessPayoutWizard
              beneficiaries={verifiedBenes}
              spendable={balances?.spendable ?? 0}
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
            <AddBeneficiaryPanel
              fee={fee}
              onDone={() => {
                setView("home");
                fetchBenes();
                fetchService();
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
              title={`${rows.length} payout${rows.length === 1 ? "" : "s"}`}
              columns={cols}
              data={rows}
              loading={fetching}
              empty="No payouts yet. Send one to see it here."
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* No-account modal shown when user tries to start a payout with no verified beneficiaries */}
      <ModalShell
        open={showNoAccountModal}
        onClose={() => setShowNoAccountModal(false)}
        size="sm"
        eyebrow="Payouts"
        title="No verified bank account yet"
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
            You need to add and verify a bank account before sending a payout. A one-time
            penny-drop verification fee of {fee ? inr2(fee.total) : "₹4 + GST"} applies.
          </p>
        </div>
      </ModalShell>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function ServicePill({
  loading,
  status,
  onRefresh,
}: {
  loading: boolean;
  status: ServiceStatus | null;
  onRefresh: () => void;
}) {
  const active = status?.available;
  return (
    <div
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm ${
        loading
          ? "border-ink-200 bg-white text-ink-500"
          : active
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-rose-200 bg-rose-50 text-rose-700"
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${loading ? "bg-ink-300" : active ? "bg-emerald-500" : "bg-rose-500"}`} />
      {loading ? "Checking service…" : active ? "Service active" : status?.reason || "Service unavailable"}
      <button
        onClick={onRefresh}
        aria-label="Refresh service status"
        className="ml-1 rounded-full p-0.5 text-ink-500 hover:bg-white/70"
      >
        <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}

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
      <div className={`absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gradient-to-br ${glow} blur-2xl transition-transform duration-700 group-hover:scale-150`} />
      <div className="absolute right-4 top-4 opacity-0 transition-opacity group-hover:opacity-100">
        <ChevronRight className="h-5 w-5 text-brand-500" />
      </div>
      <div className="relative">
        <div className={`mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-soft transition-transform group-hover:scale-110 group-hover:rotate-3 ${gradient}`}>
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

function BeneficiaryList({
  beneficiaries,
  loading,
  onRefresh,
  onRecheck,
  onDelete,
}: {
  beneficiaries: Beneficiary[];
  loading: boolean;
  onRefresh: () => void;
  onRecheck: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

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
        title="No saved bank accounts yet"
        message="Add one to start sending payouts — verification takes a few seconds."
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
      <ul className="divide-y divide-ink-100">
        {beneficiaries.map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-ink-50/50">
            <div className="flex items-center gap-3">
              <div
                className={`grid h-10 w-10 place-items-center rounded-xl ${
                  b.isVerified ? "bg-brand-50 text-brand-700" : "bg-amber-50 text-amber-600"
                }`}
              >
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-ink-900">{b.verifiedName || b.holderName}</p>
                <p className="font-mono text-xs text-ink-500">****{b.accountLast4} · {b.ifsc}</p>
                {!b.isVerified && (
                  <p
                    className={`mt-0.5 text-[11px] ${
                      b.verificationStatus === "PENDING" ? "text-amber-600" : "text-rose-600"
                    }`}
                  >
                    {b.verificationStatus === "PENDING"
                      ? "Verification pending at bank — use Re-check"
                      : b.failureReason || "Verification failed — delete and re-add"}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {b.isVerified ? (
                <StatusPill status="Verified" />
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyId === b.id}
                  onClick={async () => {
                    setBusyId(b.id);
                    try {
                      await onRecheck(b.id);
                    } finally {
                      setBusyId(null);
                    }
                  }}
                >
                  {busyId === b.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Re-check
                </Button>
              )}
              <button
                onClick={async () => {
                  if (!confirm("Delete this beneficiary?")) return;
                  await onDelete(b.id);
                }}
                aria-label="Delete beneficiary"
                className="grid h-8 w-8 place-items-center rounded-lg text-rose-700 hover:bg-rose-50 disabled:opacity-30"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Process payout wizard: select-account → enter-amount → confirm → result
// ─────────────────────────────────────────────────────────────────────────────

type PayoutResult = {
  id: string;
  beneficiaryName: string;
  accountLast4: string;
  amount: number;
  serviceCharge: number;
  gst: number;
  totalDebit: number;
  status: PayoutStatus;
  createdAt: string;
  utr?: string | null;
  reference?: string | null;
};

function ProcessPayoutWizard({
  beneficiaries,
  spendable,
  onDone,
  onError,
}: {
  beneficiaries: Beneficiary[];
  spendable: number;
  onDone: () => void;
  onError: (msg: string | null) => void;
}) {
  const [step, setStep] = useState<WizardStep>("select-account");
  const [selected, setSelected] = useState<Beneficiary | null>(null);
  const [amount, setAmount] = useState("1000");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PayoutResult | null>(null);
  const idemKey = useRef<string>(crypto.randomUUID());

  const amountNum = Number(amount) || 0;

  useEffect(() => {
    if (step !== "enter-amount") return;
    if (!amountNum || amountNum <= 0) {
      setQuote(null);
      return;
    }
    let active = true;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/payout/quote?amount=${amountNum}&mode=IMPS`);
        if (!res.ok) throw new Error();
        const json = (await res.json()) as Quote;
        if (active) setQuote(json);
      } catch {
        if (active) setQuote(null);
      } finally {
        if (active) setQuoting(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [amountNum, step]);

  const insufficient = useMemo(
    () => quote != null && quote.totalDebit > spendable,
    [quote, spendable]
  );

  async function submitWithPin(pin: string): Promise<string | null> {
    if (!selected) return "No beneficiary selected";
    setSubmitting(true);
    try {
      const nonceRes = await fetch("/api/security/nonce");
      if (!nonceRes.ok) throw new Error("Could not start a secure session. Please retry.");
      const { nonce } = (await nonceRes.json()) as { nonce: string };

      const res = await fetch("/api/payout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idemKey.current,
          "x-submit-nonce": nonce,
          "x-txn-pin": pin,
        },
        body: JSON.stringify({
          mode: "IMPS",
          amount: amountNum,
          beneficiaryId: selected.id,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        if (json.txnPin) return typeof json.error === "string" ? json.error : "PIN verification failed";
        const fieldErrors = json.error?.fieldErrors as Record<string, string[]> | undefined;
        const firstField = fieldErrors ? Object.values(fieldErrors)[0]?.[0] : undefined;
        const msg =
          typeof json.error === "string"
            ? json.error
            : (json.error?.formErrors?.[0] as string | undefined) ?? firstField ?? "Failed to submit payout";
        throw new Error(msg);
      }
      const data = await res.json();
      idemKey.current = crypto.randomUUID();
      setPinOpen(false);
      setResult({
        ...data.payout,
        reference: data.payout.id,
      });
      setStep("result");
      return null;
    } catch (err) {
      setPinOpen(false);
      onError(err instanceof Error ? err.message : "Failed to submit");
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
          <p className="mt-0.5 text-xs text-ink-500">Choose a verified beneficiary to send the payout to.</p>
        </div>
        <ul className="divide-y divide-ink-100">
          {beneficiaries.map((b) => (
            <li key={b.id}>
              <button
                onClick={() => {
                  setSelected(b);
                  setStep("enter-amount");
                }}
                className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-brand-50/50"
              >
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-ink-900">{b.verifiedName || b.holderName}</p>
                    <p className="font-mono text-xs text-ink-500">****{b.accountLast4} · {b.ifsc}</p>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-ink-400" />
              </button>
            </li>
          ))}
        </ul>
      </Panel>
    );
  }

  if (step === "enter-amount" && selected) {
    return (
      <Panel flush className="overflow-hidden">
        <div className="border-b border-ink-100 px-5 py-4">
          <h3 className="inline-flex items-center gap-2 font-display text-base font-semibold text-ink-900">
            <IndianRupee className="h-5 w-5 text-brand-700" />
            Payout details
          </h3>
        </div>
        <div className="space-y-4 p-5">
          <div className="flex items-center gap-3 rounded-xl bg-brand-50/70 p-3">
            <Building2 className="h-5 w-5 text-brand-700" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink-900">{selected.verifiedName || selected.holderName}</p>
              <p className="font-mono text-xs text-brand-800">****{selected.accountLast4} · {selected.ifsc}</p>
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
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div>
            <Label>Transfer mode</Label>
            <div className="grid grid-cols-3 gap-2">
              <ModeChip active label="IMPS (instant)" icon={<Zap className="h-3.5 w-3.5" />} />
              <ModeChip disabled label="NEFT" note="Coming soon" />
              <ModeChip disabled label="RTGS" note="Coming soon" />
            </div>
          </div>

          {amountNum > 0 && (
            <div className="rounded-xl border border-ink-100 bg-ink-50/60 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-ink-600">Beneficiary receives</span>
                <span className="font-semibold text-ink-900">{inr2(amountNum)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-ink-600">Service charge</span>
                <span>{quote ? inr2(quote.serviceCharge) : "—"}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-ink-600">GST{quote ? ` (${quote.gstPercent}%)` : ""}</span>
                <span>{quote ? inr2(quote.gst) : "—"}</span>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-ink-100 pt-2">
                <span className="font-semibold text-ink-900">
                  Total debit{quoting && <Loader2 className="ml-2 inline h-3 w-3 animate-spin" />}
                </span>
                <span className="font-display text-lg font-bold text-brand-700">{quote ? inr2(quote.totalDebit) : "—"}</span>
              </div>
              <p className="mt-2 text-[11px] text-ink-500">
                Spendable: {inr2(spendable)} · Funds are held on submit and debited on success.
              </p>
            </div>
          )}

          {insufficient && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              Total debit exceeds your spendable balance.
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setStep("select-account")}>
              Back
            </Button>
            <Button
              onClick={() => setStep("confirm")}
              disabled={!quote || insufficient || amountNum <= 0}
            >
              Review & confirm
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
            Confirm payout
          </h3>
          <p className="mt-0.5 text-xs text-ink-500">Review carefully — this cannot be undone once approved.</p>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <InfoTile label="Beneficiary" value={selected.verifiedName || selected.holderName} />
            <InfoTile label="Account" value={`****${selected.accountLast4}`} mono />
            <InfoTile label="IFSC" value={selected.ifsc} mono />
            <InfoTile label="Mode" value="IMPS (instant)" />
            <div className="col-span-2 rounded-xl bg-brand-50/70 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-brand-700">Beneficiary receives</p>
              <p className="font-display text-2xl font-bold text-brand-800">{inr2(amountNum)}</p>
              {quote && (
                <p className="mt-1 text-xs text-brand-700/80">
                  You pay {inr2(quote.totalDebit)} (₹{quote.serviceCharge} charge + ₹{quote.gst} GST)
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setStep("enter-amount")}>
              Back
            </Button>
            <Button className="flex-1" onClick={() => setPinOpen(true)}>
              <Send className="h-4 w-4" />
              Confirm & send
            </Button>
          </div>
        </div>

        <TxnPinDialog
          open={pinOpen}
          title="Confirm payout"
          detail={`IMPS · ${selected.verifiedName || selected.holderName}`}
          amount={quote?.totalDebit ?? amountNum}
          busy={submitting}
          onConfirm={submitWithPin}
          onCancel={() => !submitting && setPinOpen(false)}
        />
      </Panel>
    );
  }

  if (step === "result" && result) {
    return <PayoutReceipt result={result} onDone={onDone} />;
  }

  return null;
}

function ModeChip({
  active,
  disabled,
  label,
  icon,
  note,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  icon?: React.ReactNode;
  note?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-0.5 rounded-xl border px-3 py-2 text-xs font-semibold ${
        active
          ? "border-brand-500 bg-brand-600 text-white shadow-soft"
          : disabled
          ? "border-ink-100 bg-ink-50 text-ink-400"
          : "border-ink-200 bg-white text-ink-700"
      }`}
    >
      <span className="inline-flex items-center gap-1">
        {icon}
        {label}
      </span>
      {note && <span className="text-[10px] font-normal opacity-70">{note}</span>}
    </div>
  );
}

function InfoTile({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-ink-50/60 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-500">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold text-ink-900 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Receipt view (WhatsApp / Copy / Download / Print)
// ─────────────────────────────────────────────────────────────────────────────

function PayoutReceipt({ result, onDone }: { result: PayoutResult; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const { session } = useAuth();
  const payBy = session?.userCode
    ? `Pay by Paybridgex · RT Code ${session.userCode}`
    : "Pay by Paybridgex";
  const isSuccess = result.status === "SUCCESS";
  const isFailed = result.status === "FAILED" || result.status === "REJECTED" || result.status === "REVERSED";

  const headerGradient = isSuccess
    ? "from-emerald-500 to-emerald-700"
    : isFailed
    ? "from-rose-500 to-rose-700"
    : "from-amber-500 to-amber-600";

  const summaryText = `Payout Receipt
Status: ${STATUS_LABEL[result.status]}
Amount: ₹${result.amount.toFixed(2)}
Beneficiary: ${result.beneficiaryName}
Account: ****${result.accountLast4}
Mode: IMPS
${result.utr ? `UTR: ${result.utr}\n` : ""}Reference: ${result.reference || result.id}
Charges (incl. GST): ₹${(result.serviceCharge + result.gst).toFixed(2)}
Date: ${new Date(result.createdAt).toLocaleString("en-IN")}

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
          {isSuccess ? <CheckCircle2 className="h-9 w-9" /> : isFailed ? <XCircle className="h-9 w-9" /> : <Clock className="h-9 w-9" />}
        </motion.div>
        <h3 className="font-display text-xl font-bold">
          {isSuccess ? "Payout submitted" : isFailed ? "Payout failed" : "Payout processing"}
        </h3>
        <p className="mt-1 text-sm text-white/80">
          {result.status === "PENDING_APPROVAL" ? "Awaiting approval by the checker" : result.status === "APPROVED" ? "Processing your payout" : STATUS_LABEL[result.status]}
        </p>
        <p className="mt-3 font-display text-3xl font-bold">{inr2(result.amount)}</p>
      </div>

      <div className="p-6">
        <div className="mb-5 border-t-2 border-dashed border-ink-200" />

        <div className="space-y-2">
          <ReceiptRow label="Beneficiary" value={result.beneficiaryName} />
          <ReceiptRow label="Account" value={`****${result.accountLast4}`} mono />
          <ReceiptRow label="Mode" value="IMPS" />
          {result.utr && <ReceiptRow label="UTR" value={result.utr} mono copy />}
          <ReceiptRow label="Reference" value={result.reference || result.id} mono copy />
          <ReceiptRow label="Amount" value={inr2(result.amount)} />
          <ReceiptRow label="Service charge" value={inr2(result.serviceCharge)} />
          <ReceiptRow label={`GST (18%)`} value={inr2(result.gst)} />
          <ReceiptRow label="Total debit" value={inr2(result.totalDebit)} strong />
          <ReceiptRow
            label="Date"
            value={new Date(result.createdAt).toLocaleString("en-IN", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          />
        </div>

        <div className="my-5 border-t-2 border-dashed border-ink-200" />

        <p className="mb-4 text-center text-sm font-semibold text-emerald-600">{payBy}</p>

        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-ink-500">Share receipt</p>
        <div className="grid grid-cols-4 gap-2">
          <ShareBtn
            icon={<MessageCircle className="h-5 w-5" />}
            label="WhatsApp"
            color="bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(summaryText)}`, "_blank")}
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
              a.download = `payout_${result.reference || result.id}.txt`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          />
          <ShareBtn
            icon={<Printer className="h-5 w-5" />}
            label="Print"
            color="bg-ink-100 text-ink-800 hover:bg-ink-200"
            onClick={() => printReceipt(result, summaryText, headerGradient, payBy)}
          />
        </div>

        <div className="mt-6 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onDone}>
            Done
          </Button>
          {result.status === "PROCESSING" && (
            <Button className="flex-1" onClick={onDone}>
              <Search className="h-4 w-4" />
              Check status
            </Button>
          )}
        </div>
      </div>
    </motion.div>
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
          className={`text-sm ${mono ? "font-mono" : ""} ${strong ? "font-bold text-ink-900" : "font-semibold text-ink-800"}`}
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

function printReceipt(result: PayoutResult, text: string, gradient: string, payBy: string) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.document.write(`
<html>
  <head>
    <title>Payout Receipt · ${result.reference || result.id}</title>
    <style>
      body { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; max-width: 420px; margin: 24px auto; padding: 20px; color: #111827; }
      .head { text-align: center; padding: 24px; border-radius: 16px; color: #fff; background: linear-gradient(135deg, ${gradient.includes("emerald") ? "#10b981, #047857" : gradient.includes("rose") ? "#ef4444, #b91c1c" : "#f59e0b, #d97706"}); }
      .amt { font-size: 28px; font-weight: 800; margin-top: 8px; }
      .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-size: 14px; }
      .lab { color: #6b7280; }
      .val { font-weight: 600; }
      .div { border-top: 2px dashed #e5e7eb; margin: 16px 0; }
      .foot { text-align: center; font-size: 12px; color: #9ca3af; margin-top: 20px; }
    </style>
  </head>
  <body>
    <div class="head">
      <div style="font-weight:700">Paybridgex · Payout</div>
      <div class="amt">₹${result.amount.toFixed(2)}</div>
    </div>
    <div class="div"></div>
    ${text
      .split("\n")
      .slice(1)
      .map((line) => {
        const [lab, ...rest] = line.split(":");
        if (!lab || rest.length === 0) return "";
        return `<div class="row"><span class="lab">${lab.trim()}</span><span class="val">${rest.join(":").trim()}</span></div>`;
      })
      .join("")}
    <div class="div"></div>
    <div class="foot"><div style="font-weight:600;color:#059669;margin-bottom:4px">${payBy}</div>Paybridgex · Payout Receipt</div>
  </body>
</html>`);
  printWindow.document.close();
  printWindow.print();
}

// ─────────────────────────────────────────────────────────────────────────────
// Add-beneficiary panel (with penny-drop) + celebration overlay
// ─────────────────────────────────────────────────────────────────────────────

function AddBeneficiaryPanel({
  fee,
  onDone,
  onError,
}: {
  fee: Fee | null;
  onDone: () => void;
  onError: (msg: string | null) => void;
}) {
  const [accNumber, setAccNumber] = useState("");
  const [confirmAcc, setConfirmAcc] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [holderName, setHolderName] = useState("");
  const [contactMobile, setContactMobile] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<
    | null
    | {
        kind: "success";
        beneficiary: Beneficiary;
      }
    | {
        kind: "pending";
        message: string;
      }
    | {
        kind: "failed";
        message: string;
      }
  >(null);
  const [countdown, setCountdown] = useState(3);

  const namesMatch = accNumber && confirmAcc && accNumber === confirmAcc;
  const canSubmit =
    !submitting &&
    ACCOUNT_RE.test(accNumber) &&
    accNumber === confirmAcc &&
    IFSC_RE.test(ifsc) &&
    holderName.trim().length >= 3 &&
    /^\d{10}$/.test(contactMobile);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    setOutcome(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/payout/beneficiaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountNumber: accNumber,
          confirmAccountNumber: confirmAcc,
          ifsc: ifsc.toUpperCase(),
          holderName: holderName.trim(),
          contactMobile,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const fieldErrors = data.error?.fieldErrors as Record<string, string[]> | undefined;
        const firstField = fieldErrors ? Object.values(fieldErrors)[0]?.[0] : undefined;
        const msg =
          typeof data.error === "string" ? data.error : (data.error?.formErrors?.[0] as string | undefined) ?? firstField ?? "Failed to verify";
        throw new Error(msg);
      }

      const bene = data.beneficiary as Beneficiary;
      if (bene.isVerified) {
        setOutcome({ kind: "success", beneficiary: bene });
        setCountdown(3);
      } else if (bene.verificationStatus === "PENDING") {
        setOutcome({
          kind: "pending",
          message: data.pendingMessage || "Verification in progress. Use Re-check from the account list to poll.",
        });
      } else {
        setOutcome({
          kind: "failed",
          message: bene.failureReason || "Verification failed. Please double-check the details and try again.",
        });
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to verify");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <form
        onSubmit={handleSubmit}
        className="grid grid-cols-1 gap-6 lg:grid-cols-3"
      >
        {/* Form */}
        <Panel flush className="overflow-hidden lg:col-span-2">
          <div className="border-b border-ink-100 bg-gradient-to-r from-emerald-50/60 to-teal-50/60 px-5 py-4">
            <h3 className="inline-flex items-center gap-2 font-display text-base font-semibold text-ink-900">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-soft">
                <ShieldCheck className="h-4 w-4" />
              </div>
              Add & verify bank account
            </h3>
            <p className="ml-10 mt-1 text-xs text-ink-500">
              We&apos;ll send <strong>₹1</strong> via IMPS to confirm the account is real.{" "}
              <strong>{fee ? inr2(fee.total) : "₹4 + GST"}</strong> is debited from your wallet as a one-time verification fee.
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
                    onChange={(e) => setAccNumber(e.target.value.replace(/\D/g, ""))}
                    maxLength={18}
                    placeholder="9–18 digits"
                    required
                  />
                </div>
              </div>
              <div>
                <Label>Confirm account number *</Label>
                <div className="relative">
                  <Hash className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                  <Input
                    className={`pl-10 ${
                      confirmAcc && !namesMatch ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100" : ""
                    }`}
                    value={confirmAcc}
                    onChange={(e) => setConfirmAcc(e.target.value.replace(/\D/g, ""))}
                    maxLength={18}
                    placeholder="Re-enter account number"
                    required
                  />
                  {namesMatch && (
                    <Check className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-500" />
                  )}
                </div>
                {confirmAcc && !namesMatch && (
                  <p className="mt-1 text-[11px] text-rose-600">Account numbers do not match.</p>
                )}
              </div>
              <div>
                <Label>IFSC *</Label>
                <div className="relative">
                  <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                  <Input
                    className="pl-10"
                    value={ifsc}
                    onChange={(e) => setIfsc(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                    maxLength={11}
                    placeholder="HDFC0001234"
                    required
                  />
                </div>
              </div>
              <div>
                <Label>Account holder name *</Label>
                <div className="relative">
                  <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                  <Input
                    className="pl-10"
                    value={holderName}
                    onChange={(e) => setHolderName(e.target.value)}
                    placeholder="As per passbook"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="max-w-xs">
              <Label>Contact mobile *</Label>
              <Input
                type="tel"
                inputMode="numeric"
                value={contactMobile}
                onChange={(e) => setContactMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="10-digit mobile"
                required
              />
            </div>

            {outcome?.kind === "pending" && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <Clock className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">Verification in progress</p>
                  <p className="text-xs">{outcome.message}</p>
                </div>
              </div>
            )}
            {outcome?.kind === "failed" && (
              <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">Verification failed</p>
                  <p className="text-xs">{outcome.message}</p>
                  <ul className="mt-2 list-disc pl-4 text-xs text-rose-600">
                    <li>Confirm the account number from your passbook / cheque</li>
                    <li>Confirm the IFSC matches the branch (not the bank code)</li>
                    <li>Confirm the account is active and not closed/frozen</li>
                  </ul>
                </div>
              </div>
            )}

            <Button type="submit" size="lg" className="w-full" isLoading={submitting} disabled={!canSubmit}>
              <ShieldCheck className="h-4 w-4" />
              Verify & add account{fee ? ` (${inr2(fee.total)})` : ""}
            </Button>
          </div>
        </Panel>

        {/* Live card preview + info */}
        <div className="space-y-4">
          <motion.div
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            className="relative overflow-hidden rounded-2xl bg-[#0b1030] p-5 text-white shadow-glow"
          >
            <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-accent-400/20 blur-3xl" />
            <div className="absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-brand-500/30 blur-3xl" />
            <div className="relative">
              <div className="mb-6 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/60">Bank account</span>
                <Banknote className="h-5 w-5 text-white/60" />
              </div>
              <div className="mb-5 font-mono text-lg tracking-wider">
                {accNumber ? accNumber.match(/.{1,4}/g)?.join(" ") : "•••• •••• •••• ••••"}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-white/50">Holder</p>
                  <p className="truncate text-sm font-semibold">{holderName || "Account holder"}</p>
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-white/50">IFSC</p>
                  <p className="font-mono text-sm">{ifsc || "XXXX0000000"}</p>
                </div>
              </div>
            </div>
          </motion.div>

          <div className="rounded-2xl border border-ink-100 bg-gradient-to-br from-brand-50 to-accent-50 p-5 shadow-sm">
            <h4 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-ink-500">How it works</h4>
            <div className="space-y-3">
              {[
                { icon: IndianRupee, text: `${fee ? inr2(fee.total) : "₹4 + GST"} debited from wallet` },
                { icon: Send, text: "₹1 sent via IMPS to your account" },
                { icon: BadgeCheck, text: "Bank confirms the beneficiary name" },
                { icon: Sparkles, text: "Account verified & ready for payouts" },
              ].map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white text-emerald-600 shadow-sm">
                    <s.icon className="h-3.5 w-3.5" />
                  </div>
                  <p className="text-sm text-ink-700">{s.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </form>

      {/* Celebration overlay */}
      <AnimatePresence>
        {outcome?.kind === "success" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 grid place-items-center bg-ink-900/60 p-4 backdrop-blur"
          >
            <motion.div
              initial={{ scale: 0.85, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", damping: 18, stiffness: 200 }}
              className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-glow"
            >
              <div className="relative h-32 overflow-hidden bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-600">
                {[...Array(10)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="absolute"
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{
                      opacity: [0, 1, 0],
                      scale: [0, 1, 0],
                      rotate: [0, 360],
                    }}
                    transition={{ duration: 2 + Math.random() * 2, repeat: Infinity, delay: Math.random() * 2 }}
                    style={{ left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%` }}
                  >
                    <Sparkles className="h-3 w-3 text-white/80" />
                  </motion.div>
                ))}
                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: "spring", damping: 10, stiffness: 150, delay: 0.2 }}
                  className="absolute -bottom-10 left-1/2 grid h-20 w-20 -translate-x-1/2 place-items-center rounded-full border-4 border-emerald-500 bg-white shadow-glow"
                >
                  <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                </motion.div>
              </div>
              <div className="px-6 pt-14 pb-6 text-center">
                <h3 className="font-display text-2xl font-bold text-ink-900">Verification successful!</h3>
                <p className="mt-1 text-sm text-ink-500">Your bank account is ready to receive payouts.</p>

                {outcome.beneficiary.verifiedName && (
                  <div className="mt-4 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-4">
                    <div className="mb-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-emerald-700">
                      <BadgeCheck className="h-3 w-3" />
                      Verified by bank
                    </div>
                    <p className="font-display text-lg font-bold text-ink-900">{outcome.beneficiary.verifiedName}</p>
                    <p className="mt-0.5 font-mono text-xs text-ink-500">
                      ****{outcome.beneficiary.accountLast4} · {outcome.beneficiary.ifsc}
                    </p>
                  </div>
                )}

                <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-ink-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Redirecting in {countdown}s…
                </p>

                <Button size="lg" className="mt-4 w-full" onClick={onDone}>
                  Go to payouts
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
