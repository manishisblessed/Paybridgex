"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatINR } from "@/lib/utils";
import {
  CARD_INSTRUMENTS,
  CARD_NETWORKS,
  CARD_CLASSIFICATIONS,
  instrumentToDims,
  dimsToInstrument,
  instrumentIsCard,
} from "@/lib/mdr/cardOptions";
import {
  Plus,
  RefreshCw,
  Trash2,
  X,
  Zap,
  Clock,
  Pencil,
  Check,
  Power,
  Layers,
  Sparkles,
  CreditCard,
  QrCode,
  ChevronRight,
} from "lucide-react";

type RailKind = "PG" | "QR";

type RailRate = {
  id: string;
  provider: string;
  paymentMode: string;
  cardType: string | null;
  brandType: string | null;
  classification: string | null;
  minAmount: number;
  maxAmount: number;
  mdrType: string;
  mdrValue: number;
  mdrValueT0: number;
  active: boolean;
};

type Provider = {
  scopeKey: string;
  name: string;
  rateCount: number;
  rates: RailRate[];
};

const inputCls =
  "rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

function fmtRate(type: string, value: number) {
  return type === "PERCENT" ? `${(value * 100).toFixed(2)}%` : formatINR(value);
}

function fromStored(v: number, type: string): string {
  const human = type === "PERCENT" ? v * 100 : v;
  return String(Number(human.toFixed(4)));
}

const INSTRUMENT_LABEL = (paymentMode: string, cardType: string | null) =>
  CARD_INSTRUMENTS.find((i) => i.value === dimsToInstrument(paymentMode, cardType))?.label ??
  (paymentMode === "*" ? "Any" : paymentMode);

/**
 * PG / QR acquiring rate-card manager — the direct analogue of the POS Brands
 * tab. Lists the rail's providers (pipelines) and lets an admin manage each
 * provider's MDR rate card. Every scheme MDR for the rail locks its vendor cost
 * to these rates, so no scheme can be priced below the acquirer cost.
 */
export function RailRatesManager({ serviceKind }: { serviceKind: RailKind }) {
  const kindPath = serviceKind.toLowerCase();
  const railLabel = serviceKind === "PG" ? "Payment Gateway" : "QR";
  const targetNoun = serviceKind === "PG" ? "pipeline" : "provider";
  const RailIcon = serviceKind === "PG" ? CreditCard : QrCode;

  const [providers, setProviders] = useState<Provider[]>([]);
  const [cardClassificationEnabled, setCardClassificationEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const notify = useCallback((text: string, ok: boolean) => {
    if (ok) toast.success(text);
    else toast.error(text);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/rails/${kindPath}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to load providers");
      setProviders(data.providers ?? []);
      setCardClassificationEnabled(Boolean(data.cardClassificationEnabled));
    } catch (e) {
      notify(e instanceof Error ? e.message : "Load failed", false);
    } finally {
      setLoading(false);
    }
  }, [kindPath, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const detail = providers.find((p) => p.scopeKey === selected) ?? null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-brand-100 bg-gradient-to-r from-brand-50 via-white to-white px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-400 text-white shadow-sm">
            <RailIcon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-ink-900">{railLabel} rate cards</h3>
            <p className="mt-1 max-w-2xl text-xs text-ink-500">
              Per-{targetNoun} acquiring rate cards for {serviceKind}. Every scheme&apos;s {serviceKind} MDR locks its
              vendor cost to the matching rate here — <span className="font-medium text-ink-700">no scheme can be
              priced below it</span>.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      {loading && (
        <div className="rounded-2xl border border-ink-100 bg-white p-8 text-center text-sm text-ink-400">
          Loading {serviceKind} providers…
        </div>
      )}

      {!loading && providers.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-200 bg-ink-50/40 py-12 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-600">
            <Sparkles className="h-6 w-6" />
          </div>
          <p className="text-sm font-semibold text-ink-700">No {serviceKind} {targetNoun}s configured</p>
          <p className="mt-1 max-w-xs text-xs text-ink-400">
            Enable a {serviceKind} route in On/Off Services to add a {targetNoun} here, then define its rate card.
          </p>
        </div>
      )}

      {/* Provider list */}
      {!loading && providers.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {providers.map((p) => {
            const isActive = selected === p.scopeKey;
            return (
              <button
                key={p.scopeKey}
                onClick={() => setSelected(isActive ? null : p.scopeKey)}
                className={`group flex items-center justify-between rounded-2xl border p-4 text-left transition ${
                  isActive
                    ? "border-brand-400 bg-brand-50/50 ring-2 ring-brand-100"
                    : "border-ink-100 bg-white hover:border-brand-200 hover:shadow-soft"
                }`}
              >
                <div>
                  <p className="font-semibold text-ink-900">{p.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-ink-400">{p.scopeKey}</p>
                  <span
                    className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      p.rateCount > 0 ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
                    }`}
                  >
                    <Layers className="h-3 w-3" /> {p.rateCount} rate{p.rateCount === 1 ? "" : "s"}
                  </span>
                </div>
                <ChevronRight
                  className={`h-5 w-5 shrink-0 text-ink-300 transition ${isActive ? "rotate-90 text-brand-500" : ""}`}
                />
              </button>
            );
          })}
        </div>
      )}

      {detail && (
        <RailRateEditor
          serviceKind={serviceKind}
          scopeKey={detail.scopeKey}
          providerName={detail.name}
          rates={detail.rates}
          showClassification={cardClassificationEnabled}
          onClose={() => setSelected(null)}
          onChanged={load}
          onNotice={notify}
        />
      )}
    </div>
  );
}

function RailRateEditor({
  serviceKind,
  scopeKey,
  providerName,
  rates,
  showClassification,
  onClose,
  onChanged,
  onNotice,
}: {
  serviceKind: RailKind;
  scopeKey: string;
  providerName: string;
  rates: RailRate[];
  showClassification: boolean;
  onClose: () => void;
  onChanged: () => void;
  onNotice: (text: string, ok: boolean) => void;
}) {
  const kindPath = serviceKind.toLowerCase();
  const defaultInstrument = serviceKind === "QR" ? "UPI" : "";

  const emptyForm = {
    provider: "*",
    instrument: defaultInstrument,
    brandType: "",
    classification: "",
    minAmount: "1",
    maxAmount: "100000",
    mdrType: "PERCENT",
    mdrValue: "0.5",
    mdrValueT0: "0",
  };
  const [form, setForm] = useState(emptyForm);
  const isCard = instrumentIsCard(form.instrument);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RailRate | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Reset the form when switching providers.
  useEffect(() => {
    setForm(emptyForm);
    setEditingId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const toFraction = (v: string, type: string) => (type === "PERCENT" ? Number(v) / 100 : Number(v));

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const startEdit = (r: RailRate) => {
    setEditingId(r.id);
    setForm({
      provider: r.provider,
      instrument: dimsToInstrument(r.paymentMode, r.cardType),
      brandType: r.brandType ?? "",
      classification: r.classification ?? "",
      minAmount: String(r.minAmount),
      maxAmount: String(r.maxAmount),
      mdrType: r.mdrType,
      mdrValue: fromStored(r.mdrValue, r.mdrType),
      mdrValueT0: fromStored(r.mdrValueT0, r.mdrType),
    });
    if (typeof document !== "undefined") {
      document.getElementById("rail-rate-form")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  };

  const saveRate = async () => {
    setBusy(true);
    try {
      const { paymentMode, cardType } = instrumentToDims(form.instrument);
      const payload = {
        scopeKey,
        scopeLabel: providerName,
        provider: form.provider.trim() || "*",
        paymentMode,
        cardType,
        brandType: isCard ? form.brandType || null : null,
        classification: isCard && showClassification ? form.classification || null : null,
        minAmount: Number(form.minAmount),
        maxAmount: Number(form.maxAmount),
        mdrType: form.mdrType,
        mdrValue: toFraction(form.mdrValue, form.mdrType),
        mdrValueT0: toFraction(form.mdrValueT0, form.mdrType),
      };
      const res = await fetch(`/api/admin/rails/${kindPath}/rates`, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { rateId: editingId, ...payload } : payload),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(typeof data?.error === "string" ? data.error : `Failed to ${editingId ? "update" : "add"} rate`);
      onNotice(editingId ? "Rate updated." : "Rate added.", true);
      resetForm();
      onChanged();
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Failed to save rate", false);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (r: RailRate) => {
    try {
      const res = await fetch(`/api/admin/rails/${kindPath}/rates`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rateId: r.id, active: !r.active }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotice(typeof data?.error === "string" ? data.error : "Update failed", false);
        return;
      }
      onNotice(r.active ? "Rate deactivated." : "Rate activated.", true);
      onChanged();
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Update failed", false);
    }
  };

  const removeRate = async (rateId: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/rails/${kindPath}/rates`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rateId }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotice(typeof data?.error === "string" ? data.error : "Delete failed", false);
        return;
      }
      if (editingId === rateId) resetForm();
      onNotice("Rate deleted.", true);
      onChanged();
    } finally {
      setDeleting(false);
    }
  };

  const editing = editingId !== null;

  return (
    <div className="overflow-hidden rounded-2xl border border-brand-200 bg-white shadow-soft">
      <div className="flex items-start justify-between gap-4 border-b border-brand-100 bg-gradient-to-r from-brand-50 via-white to-white px-5 py-4">
        <div>
          <h3 className="text-sm font-bold text-ink-900">
            {serviceKind} rates — {providerName}
          </h3>
          <p className="mt-1 font-mono text-[11px] text-ink-400">{scopeKey}</p>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-ink-400 transition hover:bg-white hover:text-ink-700">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-5 p-5">
        {rates.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-200 bg-ink-50/40 py-10 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-600">
              <Sparkles className="h-6 w-6" />
            </div>
            <p className="text-sm font-semibold text-ink-700">No rates yet</p>
            <p className="mt-1 max-w-xs text-xs text-ink-400">
              Add the first rate below. Schemes can&apos;t price {serviceKind} without a matching rate.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rates.map((r) => {
              const isEditing = editingId === r.id;
              return (
                <div
                  key={r.id}
                  className={`rounded-2xl border p-4 transition ${
                    isEditing
                      ? "border-brand-400 bg-brand-50/50 ring-2 ring-brand-100"
                      : r.active
                      ? "border-ink-100 bg-white hover:border-brand-200 hover:shadow-soft"
                      : "border-ink-100 bg-ink-50/50 opacity-80"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-md bg-ink-100 px-2 py-0.5 text-[11px] font-medium text-ink-600">
                        {INSTRUMENT_LABEL(r.paymentMode, r.cardType)}
                      </span>
                      {r.provider !== "*" && (
                        <span className="rounded-md bg-brand-600 px-2 py-0.5 text-[11px] font-bold uppercase text-white">
                          {r.provider}
                        </span>
                      )}
                      {r.brandType && (
                        <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600">
                          {r.brandType}
                        </span>
                      )}
                      {showClassification && r.classification && (
                        <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-600">
                          {r.classification}
                        </span>
                      )}
                    </div>
                    <span
                      className={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ${
                        r.active ? "bg-emerald-500" : "bg-rose-400"
                      }`}
                      title={r.active ? "active" : "inactive"}
                    />
                  </div>

                  <p className="mt-3 text-[11px] uppercase tracking-wider text-ink-400">Band</p>
                  <p className="text-sm font-medium text-ink-800">
                    {formatINR(r.minAmount)} – {formatINR(r.maxAmount)}
                  </p>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-brand-50 px-3 py-2">
                      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-brand-500">
                        <Clock className="h-3 w-3" /> T+1
                      </p>
                      <p className="text-base font-bold text-brand-700">{fmtRate(r.mdrType, r.mdrValue)}</p>
                    </div>
                    <div className="rounded-xl bg-ink-50 px-3 py-2">
                      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-ink-400">
                        <Zap className="h-3 w-3" /> Instant
                      </p>
                      <p className="text-base font-bold text-ink-700">
                        {r.mdrValueT0 > 0 ? fmtRate(r.mdrType, r.mdrValueT0) : "—"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-ink-50 pt-3">
                    <Badge variant={r.active ? "success" : "danger"}>{r.active ? "active" : "inactive"}</Badge>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => startEdit(r)}
                        className={`rounded-lg p-1.5 transition ${
                          isEditing ? "bg-brand-100 text-brand-700" : "text-ink-400 hover:bg-brand-50 hover:text-brand-600"
                        }`}
                        title="Edit rate"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => toggleActive(r)}
                        className={`rounded-lg p-1.5 transition ${
                          r.active ? "text-emerald-500 hover:bg-emerald-50" : "text-ink-400 hover:bg-ink-100 hover:text-ink-600"
                        }`}
                        title={r.active ? "Deactivate" : "Activate"}
                      >
                        <Power className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(r)}
                        className="rounded-lg p-1.5 text-rose-400 transition hover:bg-rose-50 hover:text-rose-600"
                        title="Delete rate"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Add / edit form */}
        <div
          id="rail-rate-form"
          className={`rounded-2xl border p-4 transition ${
            editing ? "border-brand-300 bg-brand-50/40" : "border-ink-100 bg-ink-50/60"
          }`}
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-600">
              {editing ? (
                <>
                  <Pencil className="h-3.5 w-3.5 text-brand-600" /> Edit rate
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5 text-brand-600" /> Add rate
                </>
              )}
              {form.mdrType === "PERCENT" && (
                <span className="font-normal normal-case text-ink-400">(rates in %, e.g. 1 = 1%)</span>
              )}
            </p>
            {editing && (
              <button
                onClick={resetForm}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-ink-500 transition hover:bg-white hover:text-ink-700"
              >
                <X className="h-3 w-3" /> Cancel
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
            <label className="text-xs text-ink-500">
              Sub-provider (* = any)
              <input className={`${inputCls} mt-1 w-full`} value={form.provider} onChange={set("provider")} placeholder="*" />
            </label>
            <label className="text-xs text-ink-500">
              Instrument
              <select className={`${inputCls} mt-1 w-full`} value={form.instrument} onChange={set("instrument")}>
                {CARD_INSTRUMENTS.map((i) => (
                  <option key={i.value} value={i.value}>
                    {i.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-ink-500">
              Network
              <select
                className={`${inputCls} mt-1 w-full disabled:opacity-50`}
                value={form.brandType}
                onChange={set("brandType")}
                disabled={!isCard}
              >
                <option value="">Any</option>
                {CARD_NETWORKS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {showClassification && (
              <label className="text-xs text-ink-500">
                Classification
                <select
                  className={`${inputCls} mt-1 w-full disabled:opacity-50`}
                  value={form.classification}
                  onChange={set("classification")}
                  disabled={!isCard}
                >
                  <option value="">Any</option>
                  {CARD_CLASSIFICATIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="text-xs text-ink-500">
              Min ₹
              <input type="number" className={`${inputCls} mt-1 w-full`} value={form.minAmount} onChange={set("minAmount")} />
            </label>
            <label className="text-xs text-ink-500">
              Max ₹
              <input type="number" className={`${inputCls} mt-1 w-full`} value={form.maxAmount} onChange={set("maxAmount")} />
            </label>
            <label className="text-xs text-ink-500">
              MDR type
              <select className={`${inputCls} mt-1 w-full`} value={form.mdrType} onChange={set("mdrType")}>
                <option>PERCENT</option>
                <option>FLAT</option>
              </select>
            </label>
            <label className="text-xs text-ink-500">
              Vendor (T+1)
              <input type="number" step="0.01" className={`${inputCls} mt-1 w-full`} value={form.mdrValue} onChange={set("mdrValue")} />
            </label>
            <label className="text-xs text-ink-500">
              Vendor (instant)
              <input type="number" step="0.01" className={`${inputCls} mt-1 w-full`} value={form.mdrValueT0} onChange={set("mdrValueT0")} />
            </label>
            <div className="flex items-end gap-2 lg:col-span-8">
              <Button size="sm" onClick={saveRate} disabled={busy} isLoading={busy}>
                {editing ? (
                  <>
                    <Check className="mr-1.5 h-4 w-4" /> Update rate
                  </>
                ) : (
                  <>
                    <Plus className="mr-1.5 h-4 w-4" /> Add rate
                  </>
                )}
              </Button>
              {editing && (
                <Button size="sm" variant="outline" onClick={resetForm} disabled={busy}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
          <p className="mt-3 text-[11px] text-ink-400">
            These are the acquirer (vendor) costs for {serviceKind}. A scheme&apos;s {serviceKind} MDR is locked to the
            matching rate and can never be set below it. Instant is optional — leave 0 to reuse the T+1 rate.
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        busy={deleting}
        title="Delete this rate?"
        description={
          deleteTarget && (
            <>
              The <span className="font-semibold text-ink-900">{INSTRUMENT_LABEL(deleteTarget.paymentMode, deleteTarget.cardType)}</span> rate
              covering{" "}
              <span className="font-semibold text-ink-900">
                {formatINR(deleteTarget.minAmount)} – {formatINR(deleteTarget.maxAmount)}
              </span>{" "}
              will be removed from {providerName}.
            </>
          )
        }
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!deleteTarget) return;
          await removeRate(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
