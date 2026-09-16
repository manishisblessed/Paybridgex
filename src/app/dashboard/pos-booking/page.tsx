"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  Monitor, IndianRupee, Loader2, CheckCircle2, Truck, PackageCheck,
  Clock, ShoppingCart, XCircle, MapPin, ShieldCheck, Wallet, ArrowRight, RefreshCw,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { StatCard } from "@/components/dashboard/StatCard";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatINR } from "@/lib/utils";

type Plan = {
  id: string;
  name: string;
  description: string | null;
  monthlyRent: number;
  setupFee: number;
  deposit: number;
  includeGst: boolean;
};

type BookingStatus = "APPLIED" | "ASSIGNED" | "DISPATCHED" | "DELIVERED" | "CANCELLED";

type Booking = {
  id: string;
  status: BookingStatus;
  statusLabel: string;
  stepIndex: number;
  deliveryAddress: string;
  contactName: string | null;
  contactPhone: string | null;
  monthlyRent: number;
  includeGst: boolean;
  gstAmount: number;
  setupFee: number;
  deposit: number;
  amountPaid: number;
  billingDay: number;
  courier: string | null;
  trackingRef: string | null;
  assignedAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  plan: { id: string; name: string; description: string | null };
  machine: { id: string; tid: string | null; serial: string | null; model: string | null; status: string } | null;
  events: { id: string; status: BookingStatus; note: string | null; createdAt: string }[];
};

type BookingData = { plans: Plan[]; bookings: Booking[]; walletBalance: number };

async function fetcher(url: string): Promise<BookingData> {
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof d?.error === "string" ? d.error : "Failed to load");
  return d as BookingData;
}

const STEPS: { status: BookingStatus; label: string; icon: typeof Clock }[] = [
  { status: "APPLIED", label: "Applied & Paid", icon: ShoppingCart },
  { status: "ASSIGNED", label: "Assigned", icon: CheckCircle2 },
  { status: "DISPATCHED", label: "Dispatched", icon: Truck },
  { status: "DELIVERED", label: "Delivered", icon: PackageCheck },
];

function planTotal(p: Plan) {
  const gst = p.includeGst ? Math.round(p.monthlyRent * 0.18 * 100) / 100 : 0;
  return p.monthlyRent + gst + p.setupFee + p.deposit;
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export default function PosBookingPage() {
  const { data, error, isLoading, mutate } = useSWR<BookingData>(
    "/api/pos/booking",
    fetcher,
    { revalidateOnFocus: true, refreshInterval: 15000, keepPreviousData: true },
  );

  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  const plans = data?.plans ?? [];
  const bookings = data?.bookings ?? [];
  const walletBalance = data?.walletBalance ?? 0;

  const selfCancel = async (booking: Booking) => {
    setCancelBusy(true);
    try {
      const res = await fetch("/api/pos/booking", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: booking.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d?.error === "string" ? d.error : "Cancellation failed");
      toast.success(`Booking cancelled — ${formatINR(booking.amountPaid)} refunded to your wallet.`);
      setCancelTarget(null);
      mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancellation failed");
    } finally {
      setCancelBusy(false);
    }
  };

  const activeCount = bookings.filter((b) => b.status !== "CANCELLED" && b.status !== "DELIVERED").length;
  const liveCount = bookings.filter((b) => b.status === "DELIVERED").length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Point of Sale"
        title="Book a POS Machine"
        description="Apply for a POS machine, confirm your delivery address and pay the rental charges — then track your order in real time from assignment to delivery."
        actions={
          <Button variant="outline" size="sm" onClick={() => mutate()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Wallet Balance" value={formatINR(walletBalance)} icon={Wallet} accent="brand" />
        <StatCard label="Plans Available" value={String(plans.length)} icon={Monitor} accent="violet" />
        <StatCard label="Orders In Progress" value={String(activeCount)} icon={Truck} accent="accent" />
        <StatCard label="Machines Live" value={String(liveCount)} icon={PackageCheck} accent="emerald" />
      </div>

      {/* ── Available plans ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-4 w-4 text-brand-600" />
          <h2 className="text-sm font-semibold text-ink-900">Available Rental Plans</h2>
        </div>

        {error ? (
          <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <XCircle className="h-4 w-4 shrink-0" /> {error instanceof Error ? error.message : "Failed to load plans."}
          </div>
        ) : isLoading ? (
          <div className="flex items-center gap-2 rounded-2xl border border-ink-100 bg-white p-6 text-sm text-ink-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading plans…
          </div>
        ) : plans.length === 0 ? (
          <div className="rounded-2xl border border-ink-200 bg-ink-50 p-6 text-center text-sm text-ink-600">
            No rental plans are available for booking right now. Please check back soon.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {plans.map((p) => (
              <div key={p.id} className="flex flex-col rounded-2xl border border-ink-100 bg-white p-5 shadow-sm transition hover:border-brand-200 hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                    <Monitor className="h-5 w-5" />
                  </div>
                  {p.includeGst && <Badge variant="default">+18% GST</Badge>}
                </div>
                <h3 className="mt-3 font-display text-base font-bold text-ink-900">{p.name}</h3>
                {p.description && <p className="mt-0.5 text-xs text-ink-500">{p.description}</p>}

                <div className="mt-4 flex items-end gap-1">
                  <span className="text-2xl font-bold text-ink-900">{formatINR(p.monthlyRent)}</span>
                  <span className="mb-1 text-xs text-ink-400">/ month{p.includeGst ? " + GST" : ""}</span>
                </div>

                <ul className="mt-3 space-y-1.5 text-xs text-ink-600">
                  {p.deposit > 0 && (
                    <li className="flex items-center justify-between">
                      <span>Deposit (refundable via ops)</span>
                      <span className="font-semibold text-ink-800">{formatINR(p.deposit)}</span>
                    </li>
                  )}
                  {p.setupFee > 0 && (
                    <li className="flex items-center justify-between">
                      <span>One-time setup fee</span>
                      <span className="font-semibold text-ink-800">{formatINR(p.setupFee)}</span>
                    </li>
                  )}
                  <li className="flex items-center justify-between border-t border-ink-100 pt-1.5">
                    <span className="font-semibold text-ink-700">Payable now</span>
                    <span className="font-bold text-brand-700">{formatINR(planTotal(p))}</span>
                  </li>
                </ul>

                <Button className="mt-4 w-full" size="sm" onClick={() => setSelectedPlan(p)}>
                  Book Now <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── My bookings ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Truck className="h-4 w-4 text-brand-600" />
          <h2 className="text-sm font-semibold text-ink-900">My Bookings</h2>
        </div>

        {bookings.length === 0 ? (
          <div className="rounded-2xl border border-ink-200 bg-ink-50 p-6 text-center text-sm text-ink-600">
            You haven&apos;t booked any machines yet. Pick a plan above to get started.
          </div>
        ) : (
          <div className="space-y-4">
            {bookings.map((b) => (
              <BookingCard key={b.id} booking={b} onRequestCancel={() => setCancelTarget(b)} />
            ))}
          </div>
        )}
      </section>

      <BookingModal
        plan={selectedPlan}
        walletBalance={walletBalance}
        onClose={() => setSelectedPlan(null)}
        onBooked={() => { setSelectedPlan(null); mutate(); }}
      />

      <ConfirmDialog
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        busy={cancelBusy}
        tone="danger"
        title="Cancel this booking?"
        description={cancelTarget && (
          <>
            Your <span className="font-semibold text-ink-900">{cancelTarget.plan.name}</span> booking will be cancelled and{" "}
            <span className="font-semibold text-ink-900">{formatINR(cancelTarget.amountPaid)}</span> refunded to your wallet.
          </>
        )}
        confirmLabel="Cancel & refund"
        cancelLabel="Keep booking"
        onConfirm={async () => { if (cancelTarget) await selfCancel(cancelTarget); }}
      />
    </div>
  );
}

/* ───────────────────────────── Booking card + status stepper */

function BookingCard({ booking, onRequestCancel }: { booking: Booking; onRequestCancel: () => void }) {
  const cancelled = booking.status === "CANCELLED";
  const machineLabel = booking.machine?.tid ?? booking.machine?.serial ?? booking.machine?.model ?? null;

  return (
    <div className={`rounded-2xl border bg-white p-5 shadow-sm ${cancelled ? "border-rose-200" : "border-ink-100"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-base font-bold text-ink-900">{booking.plan.name}</h3>
            {cancelled ? (
              <Badge variant="danger">Cancelled</Badge>
            ) : booking.status === "DELIVERED" ? (
              <Badge variant="success">Delivered</Badge>
            ) : (
              <Badge variant="brand">{booking.statusLabel}</Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-ink-400">
            Booked {fmtDateTime(booking.createdAt)} · Order #{booking.id.slice(-8).toUpperCase()}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Paid</p>
          <p className="text-lg font-bold text-ink-900">{formatINR(booking.amountPaid)}</p>
        </div>
      </div>

      {cancelled ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">This booking was cancelled.</p>
            {booking.cancelReason && <p className="text-xs">Reason: {booking.cancelReason}</p>}
            <p className="text-xs">{formatINR(booking.amountPaid)} has been refunded to your wallet.</p>
          </div>
        </div>
      ) : (
        <Stepper stepIndex={booking.stepIndex} />
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-ink-50 px-4 py-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            <MapPin className="h-3.5 w-3.5" /> Delivery address
          </p>
          <p className="mt-1 text-sm text-ink-700">{booking.deliveryAddress}</p>
          {(booking.contactName || booking.contactPhone) && (
            <p className="mt-1 text-xs text-ink-500">{[booking.contactName, booking.contactPhone].filter(Boolean).join(" · ")}</p>
          )}
        </div>
        <div className="rounded-xl bg-ink-50 px-4 py-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            <Monitor className="h-3.5 w-3.5" /> Machine
          </p>
          {machineLabel ? (
            <>
              <p className="mt-1 font-mono text-sm font-semibold text-ink-800">{machineLabel}</p>
              <p className="text-xs text-ink-500">{booking.machine?.model ?? ""}</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-500">Awaiting allocation</p>
          )}
          {booking.trackingRef && (
            <p className="mt-1 text-xs text-ink-500">Tracking: <span className="font-medium text-ink-700">{booking.courier ? `${booking.courier} · ` : ""}{booking.trackingRef}</span></p>
          )}
        </div>
      </div>

      {/* Self-cancel while still awaiting a machine */}
      {booking.status === "APPLIED" && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-ink-100 bg-ink-50/60 px-4 py-3">
          <p className="text-xs text-ink-500">
            Awaiting a machine — you can cancel now for a full refund of {formatINR(booking.amountPaid)}.
          </p>
          <Button size="sm" variant="outline" onClick={onRequestCancel}>
            <XCircle className="h-4 w-4" /> Cancel & refund
          </Button>
        </div>
      )}

      {/* Event timeline */}
      {booking.events.length > 0 && (
        <details className="mt-4 group">
          <summary className="cursor-pointer text-xs font-semibold text-brand-600 hover:text-brand-800">
            Activity timeline ({booking.events.length})
          </summary>
          <ol className="relative mt-3 ml-2 space-y-3 border-l border-ink-200 pl-5">
            {booking.events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full bg-brand-500" />
                <p className="text-sm font-medium text-ink-800">{e.status.charAt(0) + e.status.slice(1).toLowerCase()}</p>
                {e.note && <p className="text-xs text-ink-500">{e.note}</p>}
                <p className="text-[11px] text-ink-400">{fmtDateTime(e.createdAt)}</p>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function Stepper({ stepIndex }: { stepIndex: number }) {
  return (
    <div className="mt-5 flex items-center">
      {STEPS.map((step, i) => {
        const done = i < stepIndex;
        const current = i === stepIndex;
        const Icon = step.icon;
        return (
          <div key={step.status} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center">
              <div className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition
                ${done || current
                  ? "border-brand-500 bg-brand-500 text-white"
                  : "border-ink-200 bg-white text-ink-300"}`}>
                {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <span className={`mt-1.5 whitespace-nowrap text-[10px] font-semibold ${done || current ? "text-brand-700" : "text-ink-400"}`}>
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`mx-1 h-0.5 flex-1 rounded-full ${i < stepIndex ? "bg-brand-500" : "bg-ink-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────────────── Booking modal (apply + address + pay) */

function BookingModal({
  plan, walletBalance, onClose, onBooked,
}: {
  plan: Plan | null;
  walletBalance: number;
  onClose: () => void;
  onBooked: () => void;
}) {
  const [address, setAddress] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const total = useMemo(() => (plan ? planTotal(plan) : 0), [plan]);
  const gst = plan?.includeGst ? Math.round((plan?.monthlyRent ?? 0) * 0.18 * 100) / 100 : 0;
  const insufficient = total > walletBalance;

  const reset = () => {
    setAddress(""); setContactName(""); setContactPhone(""); setConfirm(false); setBusy(false);
  };

  const submit = async () => {
    if (!plan) return;
    if (address.trim().length < 10) return toast.error("Enter a full delivery address (with state, city & pincode).");
    if (!confirm) return toast.error("Please tick the confirmation box to proceed.");
    setBusy(true);
    try {
      const res = await fetch("/api/pos/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: plan.id,
          deliveryAddress: address.trim(),
          contactName: contactName.trim() || undefined,
          contactPhone: contactPhone.trim() || undefined,
          confirm: true,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d?.error === "string" ? d.error : "Booking failed");
      toast.success(`Booked! ${formatINR(total)} charged — we'll assign & dispatch your machine soon.`);
      reset();
      onBooked();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Booking failed");
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100 placeholder:text-ink-400";

  return (
    <Modal
      open={plan !== null}
      onClose={() => { if (!busy) { reset(); onClose(); } }}
      eyebrow="Rental Charges"
      title={plan?.name ?? ""}
      size="lg"
      footer={
        <>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => { reset(); onClose(); }}>
            Close
          </Button>
          <Button size="sm" disabled={busy || insufficient || !confirm || address.trim().length < 10} onClick={submit}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <IndianRupee className="h-4 w-4" />}
            Pay {formatINR(total)}
          </Button>
        </>
      }
    >
      {plan && (
        <div className="space-y-5">
          {/* Plan summary */}
          <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-brand-500">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
              </span>
              <span className="text-sm font-semibold text-ink-900">Monthly</span>
            </div>
            <p className="mt-1 pl-6 text-sm text-ink-600">
              {formatINR(plan.monthlyRent)}{plan.includeGst ? " + GST" : ""}
              {plan.deposit > 0 && <> (<span className="font-medium">{formatINR(plan.deposit)}</span> Deposit)</>}
            </p>
          </div>

          {/* Delivery address */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-ink-700">
              <MapPin className="h-3.5 w-3.5 text-brand-600" /> Delivery Address
            </label>
            <p className="mb-1.5 text-[11px] text-ink-400">Add full delivery address with State, City and Pincode.</p>
            <textarea
              className={`${inputCls} h-24 resize-none`}
              placeholder="Delivery Address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-ink-700">Contact Name (optional)</label>
              <input className={inputCls} placeholder="Receiver name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-ink-700">Contact Phone (optional)</label>
              <input className={inputCls} placeholder="Mobile number" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </div>
          </div>

          {/* Charge breakdown */}
          <div className="rounded-xl border border-ink-100 bg-ink-50 p-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Charge summary</p>
            <div className="space-y-1.5 text-sm">
              <Row label="First month's rent" value={formatINR(plan.monthlyRent)} />
              {plan.includeGst && <Row label="GST (18%)" value={formatINR(gst)} />}
              {plan.setupFee > 0 && <Row label="One-time setup fee" value={formatINR(plan.setupFee)} />}
              {plan.deposit > 0 && <Row label="Deposit" value={formatINR(plan.deposit)} />}
              <div className="flex items-center justify-between border-t border-ink-200 pt-2">
                <span className="font-semibold text-ink-800">Total payable now</span>
                <span className="text-base font-bold text-ink-900">{formatINR(total)}</span>
              </div>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-400">
              <Wallet className="h-3.5 w-3.5" /> Wallet balance: {formatINR(walletBalance)}
            </p>
            {insufficient && (
              <p className="mt-1 text-xs font-medium text-rose-600">
                Insufficient balance — top up {formatINR(total - walletBalance)} more to book this machine.
              </p>
            )}
          </div>

          {/* Confirmation */}
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-ink-200 bg-white px-3 py-3">
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-400"
            />
            <span className="text-sm text-ink-700">
              <span className="flex items-center gap-1.5 font-semibold text-ink-900">
                <ShieldCheck className="h-4 w-4 text-emerald-600" /> Are you sure you want to purchase {plan.name}?
              </span>
              Amount debited from your wallet will be <span className="font-semibold">{formatINR(total)}</span>
              {plan.deposit > 0 && <> (incl. {formatINR(plan.deposit)} deposit)</>}.
            </span>
          </label>
        </div>
      )}
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-ink-600">
      <span>{label}</span>
      <span className="font-medium text-ink-800">{value}</span>
    </div>
  );
}
