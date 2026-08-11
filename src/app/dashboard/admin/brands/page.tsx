"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RailRatesManager } from "@/components/admin/RailRatesManager";
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
  Tag,
  Plus,
  RefreshCw,
  Trash2,
  X,
  Zap,
  Clock,
  ArrowLeftRight,
  Pencil,
  Check,
  Power,
  CreditCard,
  Layers,
  Sparkles,
  Store,
  QrCode,
  Receipt,
  Banknote,
} from "lucide-react";

type Brand = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  active: boolean;
  settlementMode: string;
  t1CutoffHour: number | null;
  rates: number;
  machines: number;
  createdAt: string;
};

type Rate = {
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
  minMdrValue: number;
  minMdrValueT0: number;
  active: boolean;
};

type BrandDetail = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  active: boolean;
  settlementMode: string;
  t1CutoffHour: number | null;
  machines: number;
  rates: Rate[];
};

/** IST hours 0-23 offered as per-company T+1 cutoff options. */
const CUTOFF_HOURS = Array.from({ length: 24 }, (_, h) => h);

/** 22 → "10:00 PM", 0 → "12:00 AM (midnight)", 12 → "12:00 PM (noon)". */
function fmtCutoffHour(h: number): string {
  const ampm = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const suffix = h === 0 ? " (midnight)" : h === 12 ? " (noon)" : "";
  return `${hour12}:00 ${ampm}${suffix}`;
}

const inputCls =
  "rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

function fmtRate(type: string, value: number) {
  return type === "PERCENT" ? `${(value * 100).toFixed(2)}%` : formatINR(value);
}

/**
 * Best-effort guess of the acquiring provider from a brand's name so the rate
 * form can pre-fill it. "Sameday-AXIS" → "AXIS", "Sameday-Lagoon (Paytm)" →
 * "PAYTM". Falls back to "*" (any) when nothing sensible can be derived.
 */
function deriveProvider(name: string): string {
  const paren = name.match(/\(([^)]+)\)/);
  const base = paren ? paren[1] : name.split(/[-–—]/).pop() ?? name;
  return base.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "") || "*";
}

/** Stored fraction (0.01) → human percent (1) for editing existing rates. */
function fromStored(v: number, type: string): string {
  const human = type === "PERCENT" ? v * 100 : v;
  return String(Number(human.toFixed(4)));
}

const INSTRUMENT_LABEL = (paymentMode: string, cardType: string | null) =>
  CARD_INSTRUMENTS.find((i) => i.value === dimsToInstrument(paymentMode, cardType))?.label ??
  (paymentMode === "*" ? "Any" : paymentMode);

export default function BrandsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [cardClassificationEnabled, setCardClassificationEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const notify = useCallback((text: string, ok: boolean) => {
    if (ok) toast.success(text);
    else toast.error(text);
  }, []);

  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<BrandDetail | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [tab, setTab] = useState<"pos" | "pg" | "qr" | "services">("pos");
  // Inner toggle for the combined Services tab (BBPS + Payout rate cards).
  const [serviceTab, setServiceTab] = useState<"BBPS" | "PAYOUT">("BBPS");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/brands");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to load brands");
      setBrands(data.brands);
      setCardClassificationEnabled(Boolean(data.cardClassificationEnabled));
    } catch (e) {
      notify(e instanceof Error ? e.message : "Load failed", false);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  const loadDetail = useCallback(
    async (id: string) => {
      setSelected(id);
      setDetail(null);
      try {
        const res = await fetch(`/api/admin/brands/${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Failed to load brand");
        setDetail(data.brand);
      } catch (e) {
        notify(e instanceof Error ? e.message : "Load failed", false);
        setSelected(null);
      }
    },
    [notify]
  );

  useEffect(() => {
    load();
  }, [load]);

  const patchBrand = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/brands/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      notify(typeof data?.error === "string" ? data.error : "Update failed", false);
      return;
    }
    notify("Brand updated.", true);
    load();
    if (selected === id) loadDetail(id);
  };

  const columns: Column<Brand>[] = [
    {
      key: "name",
      header: "Brand",
      render: (b) => (
        <button className="text-left" onClick={() => loadDetail(b.id)}>
          <span className="font-semibold text-brand-700 hover:underline">{b.name}</span>
          <p className="text-xs text-ink-400">
            {b.key}
            {b.description ? ` · ${b.description}` : ""}
          </p>
        </button>
      ),
    },
    {
      key: "mode",
      header: "Settlement",
      render: (b) => (
        <Badge variant={b.settlementMode === "INSTANT" ? "brand" : b.settlementMode === "BOTH" ? "warning" : "default"}>
          {b.settlementMode === "INSTANT" ? (
            <span className="inline-flex items-center gap-1">
              <Zap className="h-3 w-3" /> Instant
            </span>
          ) : b.settlementMode === "BOTH" ? (
            <span className="inline-flex items-center gap-1">
              <ArrowLeftRight className="h-3 w-3" /> Both
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> T+1
            </span>
          )}
        </Badge>
      ),
    },
    {
      key: "cutoff",
      header: "T+1 cutoff",
      render: (b) => (
        <select
          className="rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-700 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          value={b.t1CutoffHour ?? ""}
          onChange={(e) =>
            patchBrand(b.id, { t1CutoffHour: e.target.value === "" ? null : Number(e.target.value) })
          }
          title="Captures taken at/after this IST hour roll to the next business day and settle on T+2 instead of T+1"
        >
          <option value="">All day → T+1</option>
          {CUTOFF_HOURS.map((h) => (
            <option key={h} value={h}>
              {fmtCutoffHour(h)} → T+2 after
            </option>
          ))}
        </select>
      ),
    },
    {
      key: "flags",
      header: "Status",
      render: (b) => (
        <Badge variant={b.active ? "success" : "danger"}>{b.active ? "active" : "inactive"}</Badge>
      ),
    },
    { key: "rates", header: "Rates", render: (b) => <span>{b.rates}</span> },
    { key: "machines", header: "Machines", render: (b) => <span>{b.machines}</span> },
    {
      key: "actions",
      header: "",
      render: (b) => (
        <div className="flex items-center justify-end gap-2">
          <select
            className="rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-700 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            value={b.settlementMode}
            onChange={(e) => patchBrand(b.id, { settlementMode: e.target.value })}
            title="Settlement mode"
          >
            <option value="T1">T+1</option>
            <option value="INSTANT">Instant</option>
            <option value="BOTH">Both</option>
          </select>
          <Button size="sm" variant="outline" onClick={() => patchBrand(b.id, { active: !b.active })}>
            {b.active ? "Deactivate" : "Activate"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="MDR & minimum charges"
        description="Define the cost floor for each rail — POS, PG, QR (acquiring rate cards) and Services (BBPS & Payout: per-provider vendor cost + minimum charge). These are the company minimums: every scheme charge is validated against them, so nothing can ever be priced below the rail's floor."
        actions={
          tab === "pos" ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={load}>
                <RefreshCw className="mr-2 h-4 w-4" /> Refresh
              </Button>
              <Button onClick={() => setShowCreate(true)}>
                <Plus className="mr-2 h-4 w-4" /> New brand
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="flex gap-1 rounded-xl border border-ink-100 bg-ink-50/60 p-1">
        <button
          onClick={() => setTab("pos")}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            tab === "pos" ? "bg-white text-brand-700 shadow-sm" : "text-ink-500 hover:text-ink-700"
          }`}
        >
          <Store className="h-4 w-4" /> POS
        </button>
        <button
          onClick={() => setTab("pg")}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            tab === "pg" ? "bg-white text-brand-700 shadow-sm" : "text-ink-500 hover:text-ink-700"
          }`}
        >
          <CreditCard className="h-4 w-4" /> PG
        </button>
        <button
          onClick={() => setTab("qr")}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            tab === "qr" ? "bg-white text-brand-700 shadow-sm" : "text-ink-500 hover:text-ink-700"
          }`}
        >
          <QrCode className="h-4 w-4" /> QR
        </button>
        <button
          onClick={() => setTab("services")}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            tab === "services" ? "bg-white text-brand-700 shadow-sm" : "text-ink-500 hover:text-ink-700"
          }`}
        >
          <Receipt className="h-4 w-4" /> Services
        </button>
      </div>

      {tab === "pos" && (
        <>
          <div className="flex items-start gap-2 rounded-xl border border-ink-100 bg-ink-50/60 px-4 py-3 text-xs text-ink-500">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
            <p>
              <span className="font-semibold text-ink-700">T+1 cutoff (per company):</span> set the IST hour after which a
              day&apos;s captures roll to the next business day. A swipe taken at/after the cutoff settles on{" "}
              <span className="font-semibold">T+2</span>; everything before settles <span className="font-semibold">T+1</span>.
              Leave as <span className="font-semibold">&quot;All day → T+1&quot;</span> for no early cutoff. Instant settlement is unaffected.
            </p>
          </div>

          <DataTable columns={columns} data={brands} loading={loading} />

          {selected && (
            <RateEditor
              brandId={selected}
              detail={detail}
              showClassification={cardClassificationEnabled}
              onClose={() => {
                setSelected(null);
                setDetail(null);
              }}
              onChanged={() => {
                loadDetail(selected);
                load();
              }}
              onNotice={notify}
            />
          )}

          {showCreate && (
            <CreateBrandModal
              onClose={() => setShowCreate(false)}
              onCreated={(brandId) => {
                setShowCreate(false);
                notify("Brand created. Add its MDR rates below.", true);
                load();
                loadDetail(brandId);
              }}
              onError={(text) => notify(text, false)}
            />
          )}
        </>
      )}

      {tab === "pg" && <RailRatesManager serviceKind="PG" />}

      {tab === "qr" && <RailRatesManager serviceKind="QR" />}

      {tab === "services" && (
        <div className="space-y-4">
          <div className="flex w-fit gap-1 rounded-xl border border-ink-100 bg-ink-50/60 p-1">
            <button
              onClick={() => setServiceTab("BBPS")}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                serviceTab === "BBPS" ? "bg-white text-brand-700 shadow-sm" : "text-ink-500 hover:text-ink-700"
              }`}
            >
              <Receipt className="h-4 w-4" /> BBPS
            </button>
            <button
              onClick={() => setServiceTab("PAYOUT")}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                serviceTab === "PAYOUT" ? "bg-white text-brand-700 shadow-sm" : "text-ink-500 hover:text-ink-700"
              }`}
            >
              <Banknote className="h-4 w-4" /> Payout
            </button>
          </div>
          <RailRatesManager serviceKind={serviceTab} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- rate editor */

function RateEditor({
  brandId,
  detail,
  showClassification,
  onClose,
  onChanged,
  onNotice,
}: {
  brandId: string;
  detail: BrandDetail | null;
  showClassification: boolean;
  onClose: () => void;
  onChanged: () => void;
  onNotice: (text: string, ok: boolean) => void;
}) {
  const emptyForm = {
    provider: "*",
    instrument: "",
    brandType: "",
    classification: "",
    minAmount: "1",
    maxAmount: "100000",
    mdrType: "PERCENT",
    mdrValue: "1",
    mdrValueT0: "0",
    minMdrValue: "0",
    minMdrValueT0: "0",
  };
  const [form, setForm] = useState(emptyForm);
  const isCard = instrumentIsCard(form.instrument);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Rate | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Pre-fill the provider from the brand name and reset the form whenever a
  // different brand is opened (keeps the editor in sync with the selection).
  const defaultProvider = detail ? deriveProvider(detail.name) : "*";
  useEffect(() => {
    setForm({ ...emptyForm, provider: detail ? deriveProvider(detail.name) : "*" });
    setEditingId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id]);

  // Provider suggestions: derived default + any providers already on this brand.
  const providerOptions = Array.from(
    new Set([defaultProvider, ...(detail?.rates.map((r) => r.provider) ?? [])].filter((p) => p && p !== "*"))
  );

  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  // Percent fields are entered as human percentages (1 = 1%) and stored as
  // fractions (0.01).
  const toFraction = (v: string, type: string) => (type === "PERCENT" ? Number(v) / 100 : Number(v));

  const resetForm = () => {
    setForm({ ...emptyForm, provider: defaultProvider });
    setEditingId(null);
  };

  const startEdit = (r: Rate) => {
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
      minMdrValue: fromStored(r.minMdrValue, r.mdrType),
      minMdrValueT0: fromStored(r.minMdrValueT0, r.mdrType),
    });
    if (typeof document !== "undefined") {
      document.getElementById("brand-rate-form")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  };

  const saveRate = async () => {
    setBusy(true);
    try {
      const { paymentMode, cardType } = instrumentToDims(form.instrument);
      const payload = {
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
        minMdrValue: toFraction(form.minMdrValue, form.mdrType),
        minMdrValueT0: toFraction(form.minMdrValueT0, form.mdrType),
      };
      const res = await fetch(`/api/admin/brands/${brandId}/rates`, {
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

  const toggleActive = async (r: Rate) => {
    try {
      const res = await fetch(`/api/admin/brands/${brandId}/rates`, {
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
      const res = await fetch(`/api/admin/brands/${brandId}/rates`, {
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
      {/* Header band */}
      <div className="flex items-start justify-between gap-4 border-b border-brand-100 bg-gradient-to-r from-brand-50 via-white to-white px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-400 text-white shadow-sm">
            <Tag className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-ink-900">
              {detail ? detail.name : "Loading brand…"}
            </h3>
            {detail && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-500">
                <span className="font-mono">{detail.key}</span>
                <span className="text-ink-300">·</span>
                <span className="inline-flex items-center gap-1">
                  <Layers className="h-3 w-3" /> {detail.rates.length} rate{detail.rates.length === 1 ? "" : "s"}
                </span>
                <span className="text-ink-300">·</span>
                <span className="inline-flex items-center gap-1">
                  <CreditCard className="h-3 w-3" /> {detail.machines} machine{detail.machines === 1 ? "" : "s"}
                </span>
              </div>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-ink-400 transition hover:bg-white hover:text-ink-700"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {detail && (
        <div className="space-y-5 p-5">
          {/* Rate cards */}
          {detail.rates.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-200 bg-ink-50/40 py-10 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-600">
                <Sparkles className="h-6 w-6" />
              </div>
              <p className="text-sm font-semibold text-ink-700">No rates yet</p>
              <p className="mt-1 max-w-xs text-xs text-ink-400">
                Add the first rate below. Captures can&apos;t settle without a matching rate.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {detail.rates.map((r) => {
                const isEditing = editingId === r.id;
                return (
                  <div
                    key={r.id}
                    className={`group relative rounded-2xl border p-4 transition ${
                      isEditing
                        ? "border-brand-400 bg-brand-50/50 ring-2 ring-brand-100"
                        : r.active
                        ? "border-ink-100 bg-white hover:border-brand-200 hover:shadow-soft"
                        : "border-ink-100 bg-ink-50/50 opacity-80"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center rounded-md bg-brand-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                          {r.provider === "*" ? "ANY" : r.provider}
                        </span>
                        <span className="rounded-md bg-ink-100 px-2 py-0.5 text-[11px] font-medium text-ink-600">
                          {INSTRUMENT_LABEL(r.paymentMode, r.cardType)}
                        </span>
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

                    <p className="mt-3 text-[11px] uppercase tracking-wider text-ink-400">Vendor cost</p>
                    <div className="mt-1 grid grid-cols-2 gap-2">
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

                    <p className="mt-3 text-[11px] uppercase tracking-wider text-ink-400">
                      Min MDR <span className="normal-case text-ink-300">(floor offered downstream)</span>
                    </p>
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-emerald-50 px-3 py-2">
                        <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-500">
                          <Clock className="h-3 w-3" /> T+1
                        </p>
                        <p className="text-base font-bold text-emerald-700">
                          {r.minMdrValue > 0 ? fmtRate(r.mdrType, r.minMdrValue) : "—"}
                        </p>
                      </div>
                      <div className="rounded-xl bg-emerald-50/60 px-3 py-2">
                        <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-500">
                          <Zap className="h-3 w-3" /> Instant
                        </p>
                        <p className="text-base font-bold text-emerald-700">
                          {(r.minMdrValueT0 > 0 ? r.minMdrValueT0 : r.minMdrValue) > 0
                            ? fmtRate(r.mdrType, r.minMdrValueT0 > 0 ? r.minMdrValueT0 : r.minMdrValue)
                            : "—"}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-end gap-1 border-t border-ink-50 pt-3">
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
                          r.active
                            ? "text-emerald-500 hover:bg-emerald-50"
                            : "text-ink-400 hover:bg-ink-100 hover:text-ink-600"
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
                );
              })}
            </div>
          )}

          {/* Add / edit form */}
          <div
            id="brand-rate-form"
            className={`rounded-2xl border p-4 transition ${
              editing ? "border-brand-300 bg-brand-50/40" : "border-ink-100 bg-ink-50/60"
            }`}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-600">
                {editing ? (
                  <>
                    <Pencil className="h-3.5 w-3.5 text-brand-600" /> Edit rate
                    <span className="rounded bg-brand-600 px-1.5 py-0.5 text-[10px] text-white">
                      {form.provider || "ANY"}
                    </span>
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
                Provider (* = any)
                <input
                  className={`${inputCls} mt-1 w-full`}
                  value={form.provider}
                  onChange={set("provider")}
                  placeholder="RAZORPAY"
                  list="brand-provider-options"
                />
                <datalist id="brand-provider-options">
                  {providerOptions.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </label>
              <label className="text-xs text-ink-500">
                Card / Instrument
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
                </select>
              </label>
              <label className="text-xs text-ink-500">
                Vendor (T+1) %
                <input type="number" step="0.01" className={`${inputCls} mt-1 w-full`} value={form.mdrValue} onChange={set("mdrValue")} />
              </label>
              <label className="text-xs text-ink-500">
                Vendor (instant) %
                <input type="number" step="0.01" className={`${inputCls} mt-1 w-full`} value={form.mdrValueT0} onChange={set("mdrValueT0")} />
              </label>
              <label className="text-xs text-ink-500">
                Min MDR (T+1) %
                <input type="number" step="0.01" className={`${inputCls} mt-1 w-full`} value={form.minMdrValue} onChange={set("minMdrValue")} />
              </label>
              <label className="text-xs text-ink-500">
                Min MDR (instant) %
                <input type="number" step="0.01" className={`${inputCls} mt-1 w-full`} value={form.minMdrValueT0} onChange={set("minMdrValueT0")} />
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
              Pick the instrument (Debit / Credit / UPI); {showClassification ? "Network & Classification apply" : "Network applies"} to card
              instruments — e.g. Credit · Visa{showClassification ? " · Platinum" : ""}. Vendor cost is the acquirer charge the company pays
              upstream; Min MDR is the lowest MDR offered downstream (vendor + company margin) — a scheme can never price a POS service charge
              below it. Instant fields are optional — leave 0 to reuse the T+1 value.
            </p>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        busy={deleting}
        title="Delete this rate?"
        description={
          deleteTarget && (
            <>
              The <span className="font-semibold text-ink-900">{deleteTarget.provider}</span> /{" "}
              <span className="font-semibold text-ink-900">{deleteTarget.paymentMode}</span> rate covering{" "}
              <span className="font-semibold text-ink-900">
                {formatINR(deleteTarget.minAmount)} – {formatINR(deleteTarget.maxAmount)}
              </span>{" "}
              will be removed from this brand.
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

/* --------------------------------------------------------- create modal */

/** Turn a company label into a stable lowercase slug for the brand key. */
function slugify(v: string) {
  return v
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type FleetCompany = { company: string; machineCount: number };

function CreateBrandModal({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: (brandId: string) => void;
  onError: (text: string) => void;
}) {
  const [companies, setCompanies] = useState<FleetCompany[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [company, setCompany] = useState("");
  const [description, setDescription] = useState("");
  const [settlementMode, setSettlementMode] = useState("T1");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/pos/companies");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Failed to load companies");
        if (active) setCompanies(data.companies ?? []);
      } catch (e) {
        if (active) onError(e instanceof Error ? e.message : "Failed to load companies");
      } finally {
        if (active) setLoadingCompanies(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [onError]);

  const key = slugify(company);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          name: company.trim(),
          description: description.trim() || undefined,
          settlementMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg =
          typeof data?.error === "string"
            ? data.error
            : data?.error?.fieldErrors
            ? Object.values(data.error.fieldErrors).flat().join(", ")
            : "Create failed";
        throw new Error(msg);
      }
      onCreated(data.brand.id);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-base font-bold text-ink-900">New brand</h3>
        <div className="space-y-3">
          <label className="block text-xs text-ink-500">
            Company (from POS fleet)
            <select
              className={`${inputCls} mt-1 w-full`}
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              disabled={loadingCompanies}
            >
              <option value="">
                {loadingCompanies
                  ? "Loading companies…"
                  : companies.length === 0
                  ? "No companies found on POS machines"
                  : "Select a company…"}
              </option>
              {companies.map((c) => (
                <option key={c.company} value={c.company}>
                  {c.company} ({c.machineCount})
                </option>
              ))}
            </select>
          </label>
          {company && (
            <p className="text-[11px] text-ink-400">
              Brand key: <span className="font-mono text-ink-600">{key}</span>
            </p>
          )}
          <label className="block text-xs text-ink-500">
            Description (optional)
            <input className={`${inputCls} mt-1 w-full`} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="block text-xs text-ink-500">
            Default settlement mode
            <select className={`${inputCls} mt-1 w-full`} value={settlementMode} onChange={(e) => setSettlementMode(e.target.value)}>
              <option value="T1">T+1 (next-day cron)</option>
              <option value="INSTANT">Instant (per-transaction)</option>
              <option value="BOTH">Both (follow per-user / platform default)</option>
            </select>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || key.length < 2} isLoading={busy}>
            Create brand
          </Button>
        </div>
      </div>
    </div>
  );
}
