"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CompanyMdrFloors } from "@/components/admin/CompanyMdrFloors";
import { formatINR } from "@/lib/utils";
import {
  CARD_INSTRUMENTS,
  CARD_NETWORKS,
  CARD_CLASSIFICATIONS,
  instrumentToDims,
  dimsToInstrument,
  instrumentIsCard,
} from "@/lib/mdr/cardOptions";
import { Tag, Plus, RefreshCw, Trash2, X, Zap, Clock, ArrowLeftRight, ShieldCheck } from "lucide-react";

type Brand = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  active: boolean;
  settlementMode: string;
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
  active: boolean;
};

type BrandDetail = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  active: boolean;
  settlementMode: string;
  machines: number;
  rates: Rate[];
};

const inputCls =
  "rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

function fmtRate(type: string, value: number) {
  return type === "PERCENT" ? `${(value * 100).toFixed(2)}%` : formatINR(value);
}

export default function BrandsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const notify = useCallback((text: string, ok: boolean) => {
    if (ok) toast.success(text);
    else toast.error(text);
  }, []);

  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<BrandDetail | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [tab, setTab] = useState<"brands" | "floors">("brands");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/brands");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to load brands");
      setBrands(data.brands);
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
        title="Brands & MDR"
        description="Per-brand acquiring identities (teachway, lagoon, avika, …). Each brand carries its own MDR rate card (by provider &amp; payment mode) and a default settlement mode. Every POS settlement deducts MDR against the brand's current rate."
        actions={
          tab === "brands" ? (
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
          onClick={() => setTab("brands")}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            tab === "brands" ? "bg-white text-brand-700 shadow-sm" : "text-ink-500 hover:text-ink-700"
          }`}
        >
          <Tag className="h-4 w-4" /> Brands &amp; rates
        </button>
        <button
          onClick={() => setTab("floors")}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            tab === "floors" ? "bg-white text-brand-700 shadow-sm" : "text-ink-500 hover:text-ink-700"
          }`}
        >
          <ShieldCheck className="h-4 w-4" /> Company charges
        </button>
      </div>

      {tab === "brands" && (
        <>
          <DataTable columns={columns} data={brands} loading={loading} />

          {selected && (
            <RateEditor
              brandId={selected}
              detail={detail}
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

      {tab === "floors" && <CompanyMdrFloors />}
    </div>
  );
}

/* ------------------------------------------------------------- rate editor */

function RateEditor({
  brandId,
  detail,
  onClose,
  onChanged,
  onNotice,
}: {
  brandId: string;
  detail: BrandDetail | null;
  onClose: () => void;
  onChanged: () => void;
  onNotice: (text: string, ok: boolean) => void;
}) {
  const [form, setForm] = useState({
    provider: "*",
    instrument: "",
    brandType: "",
    classification: "",
    minAmount: "1",
    maxAmount: "100000",
    mdrType: "PERCENT",
    mdrValue: "1",
    mdrValueT0: "0",
  });
  const isCard = instrumentIsCard(form.instrument);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Rate | null>(null);
  const [deleting, setDeleting] = useState(false);

  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  // Percent fields are entered as human percentages (1 = 1%) and stored as
  // fractions (0.01).
  const toFraction = (v: string, type: string) => (type === "PERCENT" ? Number(v) / 100 : Number(v));

  const addRate = async () => {
    setBusy(true);
    try {
      const { paymentMode, cardType } = instrumentToDims(form.instrument);
      const res = await fetch(`/api/admin/brands/${brandId}/rates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: form.provider.trim() || "*",
          paymentMode,
          cardType,
          brandType: isCard ? form.brandType || null : null,
          classification: isCard ? form.classification || null : null,
          minAmount: Number(form.minAmount),
          maxAmount: Number(form.maxAmount),
          mdrType: form.mdrType,
          mdrValue: toFraction(form.mdrValue, form.mdrType),
          mdrValueT0: toFraction(form.mdrValueT0, form.mdrType),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Failed to add rate");
      onNotice("Rate added.", true);
      onChanged();
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Failed to add rate", false);
    } finally {
      setBusy(false);
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
      onNotice("Rate deleted.", true);
      onChanged();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-brand-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold text-ink-900">
          <Tag className="h-4 w-4 text-brand-600" />
          {detail ? `MDR rates — ${detail.name}` : "Loading brand…"}
        </h3>
        <button onClick={onClose} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100">
          <X className="h-4 w-4" />
        </button>
      </div>

      {detail && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-[11px] uppercase tracking-wider text-ink-400">
                  <th className="py-2 pr-3">Provider</th>
                  <th className="py-2 pr-3">Instrument</th>
                  <th className="py-2 pr-3">Network</th>
                  <th className="py-2 pr-3">Classification</th>
                  <th className="py-2 pr-3">Band</th>
                  <th className="py-2 pr-3">MDR (T+1)</th>
                  <th className="py-2 pr-3">MDR (instant)</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {detail.rates.map((r) => (
                  <tr key={r.id} className="border-b border-ink-50">
                    <td className="py-2.5 pr-3 font-semibold">{r.provider}</td>
                    <td className="py-2.5 pr-3">
                      {CARD_INSTRUMENTS.find((i) => i.value === dimsToInstrument(r.paymentMode, r.cardType))?.label ??
                        (r.paymentMode === "*" ? "Any" : r.paymentMode)}
                    </td>
                    <td className="py-2.5 pr-3">{r.brandType ?? <span className="text-ink-300">Any</span>}</td>
                    <td className="py-2.5 pr-3">{r.classification ?? <span className="text-ink-300">Any</span>}</td>
                    <td className="py-2.5 pr-3">
                      {formatINR(r.minAmount)} – {formatINR(r.maxAmount)}
                    </td>
                    <td className="py-2.5 pr-3 font-semibold text-brand-700">
                      {fmtRate(r.mdrType, r.mdrValue)}
                    </td>
                    <td className="py-2.5 pr-3 text-ink-600">
                      {r.mdrValueT0 > 0 ? fmtRate(r.mdrType, r.mdrValueT0) : "—"}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge variant={r.active ? "success" : "danger"}>
                        {r.active ? "active" : "inactive"}
                      </Badge>
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        onClick={() => setDeleteTarget(r)}
                        className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50"
                        title="Delete rate"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {detail.rates.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-sm text-ink-400">
                      No rates — add the first one below. Captures can&apos;t settle without a matching rate.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-5 rounded-xl bg-ink-50/60 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-500">
              Add rate {form.mdrType === "PERCENT" && "(rates in %, e.g. 1 = 1%)"}
            </p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
              <label className="text-xs text-ink-500">
                Provider (* = any)
                <input className={`${inputCls} mt-1 w-full`} value={form.provider} onChange={set("provider")} placeholder="RAZORPAY" />
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
                MDR (T+1)
                <input type="number" step="0.01" className={`${inputCls} mt-1 w-full`} value={form.mdrValue} onChange={set("mdrValue")} />
              </label>
              <label className="text-xs text-ink-500">
                MDR (instant)
                <input type="number" step="0.01" className={`${inputCls} mt-1 w-full`} value={form.mdrValueT0} onChange={set("mdrValueT0")} />
              </label>
              <div className="flex items-end lg:col-span-8">
                <Button size="sm" onClick={addRate} disabled={busy} isLoading={busy}>
                  Add rate
                </Button>
              </div>
            </div>
            <p className="mt-3 text-[11px] text-ink-400">
              Pick the instrument (Debit / Credit / UPI); Network &amp; Classification apply to card instruments — e.g.
              Credit · Visa · Platinum. Instant MDR is optional — leave 0 to reuse the T+1 rate.
            </p>
          </div>
        </>
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
