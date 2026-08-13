"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  QrCode,
  IndianRupee,
  Clock,
  CheckCircle2,
  UploadCloud,
  RefreshCw,
  Zap,
  Banknote,
  Store,
  Receipt,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { StatCard } from "@/components/dashboard/StatCard";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input, Label } from "@/components/ui/Input";
import { formatINR } from "@/lib/utils";
import { QrSettlementReportTab } from "./QrSettlementReportTab";

type QrHeadroom = {
  collected: number;
  collectedCount: number;
  dailyLimit: number | null;
  dailyLimitCount: number | null;
  remainingAmount: number | null;
  remainingCount: number | null;
};

type ActiveQr = {
  id: string;
  label: string;
  upiVpa: string | null;
  imageUrl: string;
  activatedAt: string;
  nearFull?: boolean;
  headroom?: QrHeadroom | null;
};

type DailyUsage = {
  amount: number;
  count: number;
  amountLimit: number;
  countLimit: number;
};

type Claim = {
  id: string;
  qrLabel: string;
  amount: number;
  utr: string | null;
  cardLast4: string | null;
  paidAt: string | null;
  status: "PENDING" | "AWAITING_SECOND_APPROVAL" | "APPROVED" | "SETTLEABLE" | "SETTLED" | "REJECTED" | "CLAWED_BACK";
  netAmount: number | null;
  mdrAmount: number | null;
  settledVia: string | null;
  settledAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

type SettleableClaim = {
  id: string;
  qrLabel: string;
  amount: number;
  utr: string | null;
  cardLast4: string | null;
  paidAt: string | null;
  settleableAt: string | null;
  instant: { mdrAmount: number; netAmount: number } | null;
  t1: { mdrAmount: number; netAmount: number } | null;
};

/**
 * Current wall-clock time formatted for a `datetime-local` input's `max`.
 * `datetime-local` reads its value/max in the browser's local timezone, so we
 * shift by the tz offset before slicing — otherwise `toISOString()` (UTC) would
 * cap "Paid on" at now-minus-offset (e.g. 5:15 PM instead of 10:45 PM in IST).
 */
function localDateTimeMax(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

/** UTR when present, else the RuPay card's last 4 (card collections have no UTR). */
function claimIdentifier(row: { utr: string | null; cardLast4: string | null }): string {
  if (row.utr) return row.utr;
  if (row.cardLast4) return `•••• ${row.cardLast4}`;
  return "—";
}

function QrHeadroomMeter({ headroom }: { headroom: QrHeadroom }) {
  const capped = headroom.dailyLimit != null || headroom.dailyLimitCount != null;
  if (!capped) {
    return <p className="mt-3 text-[11px] text-ink-500">No daily collection cap on this QR.</p>;
  }
  const amtPct =
    headroom.dailyLimit != null && headroom.dailyLimit > 0
      ? (headroom.collected / headroom.dailyLimit) * 100
      : headroom.dailyLimitCount != null && headroom.dailyLimitCount > 0
        ? (headroom.collectedCount / headroom.dailyLimitCount) * 100
        : 0;
  const remaining = headroom.remainingAmount;
  const remainingCount = headroom.remainingCount;
  const exhausted = (remaining != null && remaining <= 0) || (remainingCount != null && remainingCount <= 0);
  return (
    <div className="mx-auto mt-3 w-full max-w-xs rounded-xl bg-white/90 p-3 text-left shadow-sm">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-ink-700">Today on this QR</span>
        <span className="shrink-0 text-ink-500">
          {headroom.dailyLimit != null ? (
            <>
              {formatINR(headroom.collected)} / {formatINR(headroom.dailyLimit)}
            </>
          ) : (
            <>
              {headroom.collectedCount}/{headroom.dailyLimitCount} txns
            </>
          )}
        </span>
      </div>
      {headroom.dailyLimit != null && headroom.dailyLimitCount != null && (
        <p className="mt-0.5 text-right text-[10px] text-ink-400">
          {headroom.collectedCount}/{headroom.dailyLimitCount} txns
        </p>
      )}
      <div className="mt-2 h-1.5 w-full rounded-full bg-ink-100">
        <div
          className={`h-1.5 rounded-full ${amtPct >= 100 ? "bg-rose-500" : amtPct >= 80 ? "bg-amber-500" : "bg-brand-500"}`}
          style={{ width: `${Math.min(100, amtPct)}%` }}
        />
      </div>
      <p className={`mt-1.5 text-[11px] font-medium ${exhausted ? "text-rose-700" : "text-ink-800"}`}>
        {exhausted
          ? "This QR is full for today — collect on the next QR."
          : remaining != null
            ? `You may take ${formatINR(remaining)} more on this QR today${
                remainingCount != null ? ` (${remainingCount} txn${remainingCount === 1 ? "" : "s"} left)` : ""
              }. Any extra amount must go on the next QR.`
            : remainingCount != null
              ? `${remainingCount} transaction${remainingCount === 1 ? "" : "s"} left on this QR today.`
              : null}
      </p>
    </div>
  );
}

function QrCollectCard({
  qr,
  title,
  selected,
  selectable,
  onSelect,
  onRefresh,
  refreshing,
}: {
  qr: ActiveQr;
  title: string;
  selected: boolean;
  selectable: boolean;
  onSelect: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-center gap-2">
        <h3 className="font-display text-base font-semibold text-ink-900">{title}</h3>
        {onRefresh && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRefresh();
            }}
            className="grid h-7 w-7 place-items-center rounded-lg text-ink-400 hover:bg-white hover:text-ink-700"
            title="Refresh remaining amount"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-600">
        {qr.label}
        {qr.upiVpa ? (
          <>
            {" · "}
            <span className="font-mono font-semibold">{qr.upiVpa}</span>
          </>
        ) : null}
      </p>
      {qr.headroom && <QrHeadroomMeter headroom={qr.headroom} />}
      {qr.nearFull && qr.headroom?.remainingAmount != null && qr.headroom.remainingAmount > 0 && (
        <div className="mx-auto mt-3 flex max-w-xs items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-left text-[11px] font-medium text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Almost full — refresh before each new collection so you see the latest remaining amount.
        </div>
      )}
      <div className="mx-auto mt-4 grid max-w-xs place-items-center rounded-2xl bg-white p-4 shadow-soft">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr.imageUrl} alt={`${qr.label} collection QR`} className="w-full rounded-xl" />
      </div>
      <a
        href={qr.imageUrl}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-semibold text-brand-700 shadow-sm"
      >
        <UploadCloud className="h-3.5 w-3.5 rotate-180" />
        Open full size / download
      </a>
      {selectable && (
        <div className="mt-3">
          <span
            className={
              selected
                ? "inline-flex rounded-full bg-brand-600 px-3 py-1 text-[11px] font-semibold text-white"
                : "inline-flex rounded-full border border-ink-200 bg-white px-3 py-1 text-[11px] font-semibold text-ink-600"
            }
          >
            {selected ? "Selected for claims" : "Tap to claim payments on this QR"}
          </span>
        </div>
      )}
    </>
  );

  const shell =
    "rounded-2xl border p-6 text-center " +
    (selected
      ? "border-brand-400 bg-gradient-to-br from-brand-50 to-accent-50 shadow-soft ring-2 ring-brand-200"
      : selectable
        ? "cursor-pointer border-ink-100 bg-gradient-to-br from-ink-50 to-white hover:border-brand-200"
        : "border-ink-100 bg-gradient-to-br from-brand-50 to-accent-50");

  if (selectable) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        className={shell}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
      >
        {inner}
      </div>
    );
  }
  return <div className={shell}>{inner}</div>;
}

const STATUS_BADGE: Record<Claim["status"], { label: string; variant: "success" | "warning" | "danger" | "brand" | "accent" }> = {
  PENDING: { label: "Under review", variant: "warning" },
  AWAITING_SECOND_APPROVAL: { label: "Under review", variant: "warning" },
  APPROVED: { label: "Credited", variant: "success" },
  SETTLEABLE: { label: "Ready to settle", variant: "accent" },
  SETTLED: { label: "Settled", variant: "success" },
  REJECTED: { label: "Rejected", variant: "danger" },
  CLAWED_BACK: { label: "Reversed", variant: "danger" },
};

export default function QrCollectionsPage() {
  const { data: authSession, status: sessionStatus } = useSession();
  // Only RETAILERs collect on the shop QR and file claims. DT/MD/SD (and any
  // admin who lands here) get the network-facing Settlement Report only — scoped
  // to their downline retailers + their own commission, the QR analogue of the
  // POS model. The collect/claim/settlement APIs are RETAILER-guarded too, so
  // this isn't just cosmetic.
  const role = (authSession?.user as { role?: string } | undefined)?.role;
  const isRetailer = role === "RETAILER";

  const [qr, setQr] = useState<ActiveQr | null>(null);
  const [overflowQr, setOverflowQr] = useState<ActiveQr | null>(null);
  const [claimQrId, setClaimQrId] = useState<string | null>(null);
  const [qrReason, setQrReason] = useState<string | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [dailyUsage, setDailyUsage] = useState<DailyUsage | null>(null);
  const [settleable, setSettleable] = useState<SettleableClaim[]>([]);
  const [instantEnabled, setInstantEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  // Retailers switch between "Collect & Claim" and "Settlement Report"; everyone
  // else is pinned to the report (they have no QR/claim surface).
  const [tab, setTab] = useState<"collect" | "report">("collect");
  const activeTab: "collect" | "report" = isRetailer ? tab : "report";

  // Claim form
  const [amount, setAmount] = useState("");
  const [cardLast4, setCardLast4] = useState("");
  const [utr, setUtr] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [screenshot, setScreenshot] = useState<{ name: string; dataUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Instant-settle selection
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [settling, setSettling] = useState(false);

  const refresh = useCallback(async () => {
    // Collect/claim/settlement data is retailer-only; the endpoints 403 for
    // other roles, so skip the fetch entirely for them.
    if (!isRetailer) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [qrRes, clRes, stRes] = await Promise.all([
        fetch("/api/qr/active"),
        fetch("/api/qr/claims"),
        fetch("/api/qr/settlement/pending"),
      ]);
      if (qrRes.ok) {
        const d = await qrRes.json();
        setQr(d.qr);
        setOverflowQr(d.overflowQr ?? null);
        setQrReason(d.reason ?? null);
      }
      if (clRes.ok) {
        const cd = await clRes.json();
        setClaims(cd.claims ?? []);
        setDailyUsage(cd.dailyUsage ?? null);
      }
      if (stRes.ok) {
        const st = await stRes.json();
        setSettleable(st.claims ?? []);
        setInstantEnabled(Boolean(st.instantEnabled));
      }
    } catch {
      toast.error("Could not load QR data — check your connection.");
    } finally {
      setLoading(false);
    }
  }, [isRetailer]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!qr) {
      setClaimQrId(null);
      return;
    }
    setClaimQrId((prev) => {
      if (prev === qr.id || (overflowQr && prev === overflowQr.id)) return prev;
      return qr.id;
    });
  }, [qr, overflowQr]);

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Screenshot must be under 5 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setScreenshot({ name: file.name, dataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  }

  async function submitClaim(e: React.FormEvent) {
    e.preventDefault();
    const collectQr = claimQrId === overflowQr?.id ? overflowQr : qr;
    if (!collectQr || !screenshot) return;
    if (!/^\d{4}$/.test(cardLast4.trim())) {
      toast.error("Enter the last 4 digits of the RuPay card");
      return;
    }
    const remaining = collectQr.headroom?.remainingAmount;
    const claimAmount = Number(amount);
    if (remaining != null && Number.isFinite(claimAmount) && claimAmount > remaining) {
      toast.error(
        remaining <= 0
          ? "This QR has no remaining capacity today — collect on the next QR."
          : `This QR only has ${formatINR(remaining)} remaining today. Collect that much here and the rest on the next QR.`
      );
      return;
    }
    setBusy(true);
    try {
      const trimmedUtr = utr.trim();
      const res = await fetch("/api/qr/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qrId: collectQr.id,
          amount: Number(amount),
          cardLast4: cardLast4.trim(),
          // UPI UTR and the paid-on time are optional (card collections omit them).
          ...(trimmedUtr ? { utr: trimmedUtr } : {}),
          ...(paidAt ? { paidAt: new Date(paidAt).toISOString() } : {}),
          screenshotDataUrl: screenshot.dataUrl,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        toast.error(typeof d.error === "string" ? d.error : "Claim submission failed — check the details");
        return;
      }
      const ref = d.claim.utr ? `UTR ${d.claim.utr}` : `card ••••${d.claim.cardLast4 ?? cardLast4.trim()}`;
      toast.success(
        `Claim submitted for ${formatINR(d.claim.amount)} (${ref}). It will be credited to your wallet after verification.`
      );
      setAmount("");
      setCardLast4("");
      setUtr("");
      setPaidAt("");
      setScreenshot(null);
      if (fileRef.current) fileRef.current.value = "";
      refresh();
    } catch {
      toast.error("Network error — check 'My claims' before retrying to avoid duplicates.");
    } finally {
      setBusy(false);
    }
  }

  const pendingAmount = claims
    .filter((c) => c.status === "PENDING" || c.status === "AWAITING_SECOND_APPROVAL")
    .reduce((s, c) => s + c.amount, 0);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const creditedThisMonth = claims
    .filter((c) => c.status === "SETTLED" && c.settledAt && new Date(c.settledAt) >= monthStart)
    .reduce((s, c) => s + (c.netAmount ?? c.amount), 0);

  // ── Instant settlement ──
  const readySettleable = settleable.filter((c) => c.instant !== null);
  const selectedClaims = readySettleable.filter((c) => selected[c.id]);
  const allSelected = readySettleable.length > 0 && selectedClaims.length === readySettleable.length;
  const settleableTotal = settleable.reduce((s, c) => s + c.amount, 0);
  const instantNet = selectedClaims.reduce((s, c) => s + (c.instant?.netAmount ?? 0), 0);
  const instantFee = selectedClaims.reduce((s, c) => s + (c.instant?.mdrAmount ?? 0), 0);

  function toggleSel(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }
  function toggleAllSel() {
    if (allSelected) {
      setSelected({});
    } else {
      const next: Record<string, boolean> = {};
      for (const c of readySettleable) next[c.id] = true;
      setSelected(next);
    }
  }

  async function runInstantSettle() {
    const ids = selectedClaims.map((c) => c.id);
    if (ids.length === 0) return;
    setSettling(true);
    try {
      const res = await fetch("/api/qr/settlement/instant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimIds: ids }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof d.error === "string" ? d.error : "Instant settlement failed");
        return;
      }
      toast.success(
        `Settled ${d.settled} claim${d.settled === 1 ? "" : "s"} · ${formatINR(d.totalAmount)} credited to your wallet.`
      );
      if (d.failed > 0) toast.warning(`${d.failed} could not be settled and will auto-settle T+1.`);
      setSelected({});
      refresh();
    } catch {
      toast.error("Network error — refresh before retrying to avoid duplicates.");
    } finally {
      setSettling(false);
      setConfirmOpen(false);
    }
  }

  const settleCols: Column<SettleableClaim>[] = [
    {
      key: "id",
      header: "",
      render: (r) =>
        instantEnabled && r.instant ? (
          <input type="checkbox" checked={!!selected[r.id]} onChange={() => toggleSel(r.id)} className="h-4 w-4 accent-brand-600" />
        ) : (
          <span title="Will auto-settle T+1" className="text-ink-300">—</span>
        ),
    },
    { key: "utr", header: "Ref / Card", render: (r) => <span className="font-mono text-xs">{claimIdentifier(r)}</span> },
    { key: "amount", header: "Amount", align: "right", render: (r) => <span className="font-semibold">{formatINR(r.amount)}</span> },
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
      render: (r) =>
        r.t1 ? (
          <div>
            <div className="font-medium text-ink-700">{formatINR(r.t1.netAmount)}</div>
            <div className="text-[10px] text-ink-500">fee {formatINR(r.t1.mdrAmount)}</div>
          </div>
        ) : (
          <span className="text-xs text-ink-400">—</span>
        ),
    },
  ];

  const cols: Column<Claim>[] = [
    { key: "utr", header: "Ref / Card", render: (r) => <span className="font-mono text-xs">{claimIdentifier(r)}</span> },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (r) => (
        <div>
          <span className="font-semibold">{formatINR(r.amount)}</span>
          {r.status === "SETTLED" && r.netAmount != null && (
            <div className="text-[10px] text-emerald-600">
              net {formatINR(r.netAmount)}
              {r.settledVia === "INSTANT_BUTTON" ? " · instant" : r.settledVia === "T1_CRON" ? " · T+1" : ""}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "paidAt",
      header: "Paid at",
      render: (r) =>
        r.paidAt ? new Date(r.paidAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—",
    },
    { key: "qrLabel", header: "QR" },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        const b = STATUS_BADGE[r.status];
        return (
          <div>
            <Badge variant={b.variant}>{b.label}</Badge>
            {r.reviewNote && <div className="mt-1 text-xs text-ink-500">{r.reviewNote}</div>}
          </div>
        );
      },
    },
    {
      key: "createdAt",
      header: "Submitted",
      render: (r) => new Date(r.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
    },
    {
      key: "id",
      header: "Proof",
      align: "right",
      render: (r) => (
        <a
          href={`/api/qr/claims/${r.id}/screenshot`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1 text-xs font-semibold text-ink-700 hover:border-ink-300"
          title="Open the payment screenshot"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          View
        </a>
      ),
    },
  ];

  const collectQr = claimQrId === overflowQr?.id ? overflowQr : qr;
  const remainingOnCollect = collectQr?.headroom?.remainingAmount ?? null;
  const claimAmt = Number(amount);
  const splitExtra =
    remainingOnCollect != null && Number.isFinite(claimAmt) && claimAmt > remainingOnCollect
      ? Math.round((claimAmt - remainingOnCollect) * 100) / 100
      : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="QR Collections"
        title={isRetailer ? "Collect on the shop QR" : "QR Settlement & Commission"}
        description={
          isRetailer
            ? "Take customer payments on the live QR up to its remaining daily amount. If the customer is paying more than what's left, collect the rest on the next QR."
            : "QR collections across your retailer network — volume, MDR, settlements and the commission you earn on each claim."
        }
      />

      {/* Retailers toggle Collect & Claim vs Settlement Report; DT/MD/SD only
          ever see the report, so the switcher is hidden for them. */}
      {isRetailer && (
        <div className="flex gap-1 rounded-xl border border-ink-100 bg-ink-50/60 p-1">
          {([
            { id: "collect", label: "Collect & Claim", icon: Store },
            { id: "report", label: "Settlement Report", icon: Receipt },
          ] as const).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={
                tab === id
                  ? "flex-1 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-ink-900 shadow-sm"
                  : "flex-1 rounded-lg px-4 py-2 text-sm font-semibold text-ink-500 transition-colors hover:text-ink-700"
              }
            >
              <span className="flex items-center justify-center gap-2"><Icon className="h-4 w-4" /> {label}</span>
            </button>
          ))}
        </div>
      )}

      {sessionStatus === "loading" ? (
        <div className="rounded-2xl border border-ink-100 bg-white p-10 text-center text-sm text-ink-500">
          Loading…
        </div>
      ) : activeTab === "report" ? (
        <QrSettlementReportTab />
      ) : (
      <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Under review" value={formatINR(pendingAmount)} icon={Clock} accent="accent" />
        <StatCard label="Ready to settle" value={formatINR(settleableTotal)} icon={Banknote} accent="brand" />
        <StatCard label="Settled this month" value={formatINR(creditedThisMonth)} icon={CheckCircle2} accent="emerald" />
        <StatCard
          label={qr?.headroom?.remainingAmount != null ? "This QR remaining" : "Active QR"}
          value={
            qr?.headroom?.remainingAmount != null
              ? formatINR(qr.headroom.remainingAmount)
              : qr
                ? "Live"
                : qrReason === "LIMIT_REACHED"
                  ? "Paused"
                  : "—"
          }
          icon={QrCode}
          accent="violet"
        />
      </div>

      {/* Ready to settle — instant or auto T+1 */}
      {settleable.length > 0 && (
        <div className="space-y-3 rounded-2xl border border-brand-100 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-semibold text-ink-900">Ready to settle</h3>
              <p className="text-xs text-ink-500">
                {instantEnabled ? (
                  <>
                    Approved payments awaiting settlement. Instant-settle the ones you need now (at your scheme&apos;s
                    instant rate); the rest settle automatically on the next day (T+1). Each is settled only once.
                  </>
                ) : (
                  <>
                    Approved payments awaiting settlement. These settle automatically on the next day (T+1) at your
                    standard rate — no action needed.
                  </>
                )}
              </p>
            </div>
            {instantEnabled && (
              <div className="flex items-center gap-3">
                {readySettleable.length > 0 && (
                  <button type="button" onClick={toggleAllSel} className="text-xs font-semibold text-brand-700">
                    {allSelected ? "Clear" : "Select all"}
                  </button>
                )}
                {selectedClaims.length > 0 && (
                  <span className="text-xs text-ink-600">
                    fee {formatINR(instantFee)} · you get{" "}
                    <span className="font-semibold text-emerald-700">{formatINR(instantNet)}</span>
                  </span>
                )}
                <Button size="sm" disabled={selectedClaims.length === 0 || settling} onClick={() => setConfirmOpen(true)}>
                  <Zap className="h-4 w-4" /> Instant settle
                </Button>
              </div>
            )}
          </div>
          <DataTable
            columns={settleCols}
            data={settleable}
            loading={loading}
            empty="Nothing awaiting settlement."
          />
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        busy={settling}
        title={`Instant settle ${selectedClaims.length} claim${selectedClaims.length === 1 ? "" : "s"}?`}
        description={
          <>
            <span className="font-semibold text-ink-900">{formatINR(instantNet)}</span> will be credited to your
            wallet now (instant fee {formatINR(instantFee)}). This cannot be undone, and these claims will not
            settle again on T+1.
          </>
        }
        confirmLabel="Settle now"
        onConfirm={runInstantSettle}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Live QR + overflow QR for the rest of a split payment */}
        <div className="space-y-4">
          {qr ? (
            <>
              <QrCollectCard
                qr={qr}
                title="Collect on this QR first"
                selected={claimQrId === qr.id}
                selectable={Boolean(overflowQr)}
                onSelect={() => setClaimQrId(qr.id)}
                onRefresh={refresh}
                refreshing={loading}
              />
              {overflowQr && (
                <>
                  <p className="px-1 text-center text-xs text-ink-600">
                    {qr.headroom?.remainingAmount != null
                      ? `This QR has ${formatINR(qr.headroom.remainingAmount)} left today. Take that much here, then collect any extra on the next QR.`
                      : "When this QR fills up, collect the rest on the next QR below."}
                  </p>
                  <QrCollectCard
                    qr={overflowQr}
                    title="Next QR — rest of the payment"
                    selected={claimQrId === overflowQr.id}
                    selectable
                    onSelect={() => setClaimQrId(overflowQr.id)}
                  />
                </>
              )}
              <p className="px-1 text-center text-[11px] text-ink-500">
                Works with PhonePe, Google Pay, Paytm &amp; every UPI app. After the customer pays, claim the payment
                on the right — it is settled to your wallet after verification.
              </p>
            </>
          ) : (
            <div className="rounded-2xl border border-ink-100 bg-gradient-to-br from-brand-50 to-accent-50 p-6 text-center">
              <h3 className="font-display text-base font-semibold text-ink-900">Shop collection QR</h3>
              <p className="mt-6 text-sm text-ink-600">
                {loading
                  ? "Loading…"
                  : qrReason === "LIMIT_REACHED"
                    ? "Collections are paused right now — today's limit was reached across all QRs. Please try again shortly."
                    : "No collection QR is configured yet — contact your admin."}
              </p>
            </div>
          )}
        </div>

        {/* Claim form */}
        <form onSubmit={submitClaim} className="space-y-4 rounded-2xl border border-ink-100 bg-white p-6">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white">
              <IndianRupee className="h-4 w-4" />
            </span>
            <div>
              <h3 className="font-display text-base font-semibold text-ink-900">Claim a payment</h3>
              <p className="text-xs text-ink-500">
                {collectQr
                  ? `Claim against ${collectQr.label}${collectQr.upiVpa ? ` (${collectQr.upiVpa})` : ""}.`
                  : "One claim per UPI payment — the UTR can never be claimed twice."}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="claim-amount">Amount (₹)</Label>
              <Input
                id="claim-amount"
                type="number"
                required
                min={1}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Exact amount received"
              />
              {remainingOnCollect != null && Number.isFinite(claimAmt) && claimAmt > 0 && (
                <p className={`mt-1 text-xs ${splitExtra > 0 ? "font-medium text-amber-800" : "text-ink-500"}`}>
                  {splitExtra > 0
                    ? remainingOnCollect <= 0
                      ? "This QR has no remaining capacity — collect this payment on the next QR."
                      : overflowQr
                        ? `Only ${formatINR(remainingOnCollect)} fits on this QR. Collect ${formatINR(remainingOnCollect)} here, then ${formatINR(splitExtra)} on ${overflowQr.label}.`
                        : `Only ${formatINR(remainingOnCollect)} remaining on this QR today.`
                    : `Fits on this QR (${formatINR(remainingOnCollect)} remaining).`}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="claim-card">Card last 4 digits</Label>
              <Input
                id="claim-card"
                required
                inputMode="numeric"
                minLength={4}
                maxLength={4}
                value={cardLast4}
                onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="e.g. 4321"
              />
              <p className="mt-1 text-xs text-ink-500">For RuPay Credit Card payment — required.</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="claim-utr">UPI UTR / reference number (12 digits)</Label>
              <Input
                id="claim-utr"
                inputMode="numeric"
                minLength={12}
                maxLength={14}
                value={utr}
                onChange={(e) => setUtr(e.target.value)}
                placeholder="e.g. 415023987654"
              />
              <p className="mt-1 text-xs text-ink-500">
                Optional — shown in the customer&apos;s UPI app under &quot;UTR&quot; or &quot;UPI Ref No&quot;.
              </p>
            </div>
            <div>
              <Label htmlFor="claim-paidat">Paid on</Label>
              <Input
                id="claim-paidat"
                type="datetime-local"
                value={paidAt}
                max={localDateTimeMax()}
                onChange={(e) => setPaidAt(e.target.value)}
              />
              <p className="mt-1 text-xs text-ink-500">Optional — when the customer paid.</p>
            </div>
          </div>

          <div>
            <Label htmlFor="claim-shot">Payment screenshot</Label>
            <input
              id="claim-shot"
              ref={fileRef}
              type="file"
              required
              accept="image/png,image/jpeg,image/webp"
              onChange={pickFile}
              className="block w-full rounded-xl border border-ink-200 bg-white px-4 py-2.5 text-sm text-ink-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-700"
            />
            {screenshot && <p className="mt-1 text-xs text-emerald-600">Attached: {screenshot.name}</p>}
          </div>

          {dailyUsage && (() => {
            const amtPct = dailyUsage.amountLimit > 0 ? (dailyUsage.amount / dailyUsage.amountLimit) * 100 : 0;
            const remainingAmount = Math.max(0, dailyUsage.amountLimit - dailyUsage.amount);
            const remainingCount = Math.max(0, dailyUsage.countLimit - dailyUsage.count);
            const maxed = remainingAmount <= 0 || remainingCount <= 0;
            return (
              <div className="rounded-xl border border-ink-100 bg-ink-50/60 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink-700">Your daily claim usage</span>
                  <span className="text-ink-500">
                    {formatINR(dailyUsage.amount)} / {formatINR(dailyUsage.amountLimit)} · {dailyUsage.count}/
                    {dailyUsage.countLimit} claims
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full rounded-full bg-ink-100">
                  <div
                    className={`h-1.5 rounded-full ${amtPct >= 100 ? "bg-rose-500" : amtPct >= 80 ? "bg-amber-500" : "bg-brand-500"}`}
                    style={{ width: `${Math.min(100, amtPct)}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-ink-500">
                  {maxed
                    ? "You've reached today's claim limit — it resets tomorrow, or contact support."
                    : `You can still claim ${formatINR(remainingAmount)} across ${remainingCount} more claim${remainingCount === 1 ? "" : "s"} today.`}
                </p>
              </div>
            );
          })()}

          <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
            Claims are verified against the payment provider&apos;s settlement data. Fraudulent or
            edited screenshots lead to permanent account termination and recovery action.
          </div>

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={busy || !collectQr || !screenshot || cardLast4.trim().length !== 4}
            isLoading={busy}
          >
            Submit claim{amount ? ` for ${formatINR(Number(amount) || 0)}` : ""}
          </Button>
        </form>
      </div>

      <DataTable
        title="My claims"
        description="Every payment you've claimed on the collection QR and its verification status."
        columns={cols}
        data={claims}
        loading={loading}
        empty="No claims yet — collect a payment on the QR and claim it here."
      />
      </>
      )}
    </div>
  );
}
