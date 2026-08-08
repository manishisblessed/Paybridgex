"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

type ActiveQr = {
  id: string;
  label: string;
  upiVpa: string | null;
  imageUrl: string;
  activatedAt: string;
};

type Claim = {
  id: string;
  qrLabel: string;
  amount: number;
  utr: string;
  paidAt: string;
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
  utr: string;
  paidAt: string;
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
  const [qr, setQr] = useState<ActiveQr | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [settleable, setSettleable] = useState<SettleableClaim[]>([]);
  const [instantEnabled, setInstantEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  // "Collect & Claim" (all roles) vs "Settlement Report" (self + downline).
  const [tab, setTab] = useState<"collect" | "report">("collect");

  // Claim form
  const [amount, setAmount] = useState("");
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
    setLoading(true);
    try {
      const [qrRes, clRes, stRes] = await Promise.all([
        fetch("/api/qr/active"),
        fetch("/api/qr/claims"),
        fetch("/api/qr/settlement/pending"),
      ]);
      if (qrRes.ok) setQr((await qrRes.json()).qr);
      if (clRes.ok) setClaims((await clRes.json()).claims ?? []);
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
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
    if (!qr || !screenshot) return;
    setBusy(true);
    try {
      const res = await fetch("/api/qr/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qrId: qr.id,
          amount: Number(amount),
          utr: utr.trim(),
          paidAt: new Date(paidAt).toISOString(),
          screenshotDataUrl: screenshot.dataUrl,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        toast.error(typeof d.error === "string" ? d.error : "Claim submission failed — check the details");
        return;
      }
      toast.success(
        `Claim submitted for ${formatINR(d.claim.amount)} (UTR ${d.claim.utr}). It will be credited to your wallet after verification.`
      );
      setAmount("");
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
    { key: "utr", header: "UTR", render: (r) => <span className="font-mono text-xs">{r.utr}</span> },
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
    { key: "utr", header: "UTR", render: (r) => <span className="font-mono text-xs">{r.utr}</span> },
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
      render: (r) => new Date(r.paidAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
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
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="QR Collections"
        title="Collect on the shop QR"
        description="Take customer payments on the platform QR, then claim each payment with its UTR and screenshot — verified claims are credited to your wallet."
      />

      {/* Collect & Claim (your own QR) vs Settlement Report (self + downline) */}
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

      {tab === "report" ? (
        <QrSettlementReportTab />
      ) : (
      <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Under review" value={formatINR(pendingAmount)} icon={Clock} accent="accent" />
        <StatCard label="Ready to settle" value={formatINR(settleableTotal)} icon={Banknote} accent="brand" />
        <StatCard label="Settled this month" value={formatINR(creditedThisMonth)} icon={CheckCircle2} accent="emerald" />
        <StatCard label="Active QR" value={qr ? "Live" : "—"} icon={QrCode} accent="violet" />
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
        {/* The QR to collect on */}
        <div className="rounded-2xl border border-ink-100 bg-gradient-to-br from-brand-50 to-accent-50 p-6 text-center">
          <div className="flex items-center justify-center gap-2">
            <h3 className="font-display text-base font-semibold text-ink-900">Shop collection QR</h3>
            <button
              type="button"
              onClick={refresh}
              className="grid h-7 w-7 place-items-center rounded-lg text-ink-400 hover:bg-white hover:text-ink-700"
              title="Refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
          {qr ? (
            <>
              <p className="mt-1 text-xs text-ink-600">
                {qr.label}
                {qr.upiVpa ? (
                  <>
                    {" · "}
                    <span className="font-mono font-semibold">{qr.upiVpa}</span>
                  </>
                ) : null}
              </p>
              <div className="mx-auto mt-6 grid max-w-xs place-items-center rounded-2xl bg-white p-4 shadow-soft">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr.imageUrl} alt="Shop collection QR" className="w-full rounded-xl" />
              </div>
              <a
                href={qr.imageUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-semibold text-brand-700 shadow-sm"
              >
                <UploadCloud className="h-3.5 w-3.5 rotate-180" />
                Open full size / download
              </a>
              <p className="mt-3 text-[11px] text-ink-500">
                Works with PhonePe, Google Pay, Paytm &amp; every UPI app. After the customer pays,
                claim the payment on the right — it is settled to your wallet after verification.
              </p>
            </>
          ) : (
            <p className="mt-6 text-sm text-ink-600">
              {loading ? "Loading…" : "No collection QR is configured yet — contact your admin."}
            </p>
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
              <p className="text-xs text-ink-500">One claim per UPI payment — the UTR can never be claimed twice.</p>
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
            </div>
            <div>
              <Label htmlFor="claim-paidat">Paid on</Label>
              <Input
                id="claim-paidat"
                type="datetime-local"
                required
                value={paidAt}
                max={localDateTimeMax()}
                onChange={(e) => setPaidAt(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="claim-utr">UPI UTR / reference number (12 digits)</Label>
            <Input
              id="claim-utr"
              required
              inputMode="numeric"
              minLength={12}
              maxLength={14}
              value={utr}
              onChange={(e) => setUtr(e.target.value)}
              placeholder="e.g. 415023987654"
            />
            <p className="mt-1 text-xs text-ink-500">
              Shown in the customer&apos;s UPI app under &quot;UTR&quot; or &quot;UPI Ref No&quot;.
            </p>
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

          <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
            Claims are verified against the payment provider&apos;s settlement data. Fraudulent or
            edited screenshots lead to permanent account termination and recovery action.
          </div>

          <Button type="submit" size="lg" className="w-full" disabled={busy || !qr || !screenshot} isLoading={busy}>
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
