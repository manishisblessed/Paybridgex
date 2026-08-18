"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Layers,
  RefreshCw,
  Loader2,
  AlertCircle,
  Info,
  CreditCard,
  Send,
  Store,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import {
  Panel,
  TablePro,
  StatusPill,
  SectionTitle,
  EmptyState,
} from "@/components/dashboard/ui";
import { Reveal } from "@/components/motion";
import { Button } from "@/components/ui/Button";
import { SERVICE_FAMILIES, familyOf, schemeAssignerLabel, type ServiceFamily } from "@/lib/scheme/constants";

type RateType = "FLAT" | "PERCENT";

type Slab = {
  id: string;
  service: string;
  provider: string | null;
  minAmount: number;
  maxAmount: number;
  chargeType: RateType;
  chargeValue: number;
  commissionType: RateType;
  commissionValue: number;
  parentSlabId: string | null;
  active: boolean;
};

type MdrSlab = {
  id: string;
  serviceKind: string;
  paymentMode: string;
  company: string | null;
  cardType: string | null;
  brandType: string | null;
  classification: string | null;
  minAmount: number;
  maxAmount: number;
  mdrType: RateType;
  mdrValue: number;
  mdrValueT0: number;
  commissionType: RateType;
  commission: number;
  active: boolean;
};

/** A direct child the caller may inspect the scheme of (SD→MDs, MD→DTs, DT→RTs). */
type DirectChild = { id: string; name: string; role: string; userCode: string | null };

type Scheme = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  slabCount: number;
  mdrSlabCount: number;
  slabs?: Slab[];
  mdrSlabs?: MdrSlab[];
};

const FAMILY_ICONS: Record<string, { icon: typeof CreditCard; className: string }> = {
  BBPS: { icon: CreditCard, className: "text-blue-600" },
  PAYOUT: { icon: Send, className: "text-cyan-600" },
};

const fmtRate = (type: RateType, value: number) =>
  type === "PERCENT" ? `${(value * 100).toFixed(2)}%` : `₹${value}`;

const fmtServiceRate = (_type: RateType, value: number) => `₹${value}`;

const fmtBand = (min: number, max: number) =>
  `₹${min.toLocaleString("en-IN")} – ₹${max.toLocaleString("en-IN")}`;

function groupByFamily(slabs: Slab[]): Array<readonly [ServiceFamily, Slab[]]> {
  const map = new Map<string, Slab[]>();
  for (const s of slabs) {
    const fam = familyOf(s.service).key;
    (map.get(fam) ?? map.set(fam, []).get(fam)!).push(s);
  }
  return SERVICE_FAMILIES.filter((f) => map.has(f.key)).map(
    (f) =>
      [
        f,
        (map.get(f.key) ?? []).sort(
          (a, b) => a.service.localeCompare(b.service) || a.minAmount - b.minAmount
        ),
      ] as const
  );
}

export default function MyAssignedSchemePage() {
  const [loading, setLoading] = useState(true);
  const [scheme, setScheme] = useState<Scheme | null>(null);
  const [role, setRole] = useState<string | null>(null);
  // Direct-child scheme viewer: null = the caller's own scheme.
  const [children, setChildren] = useState<DirectChild[]>([]);
  const [viewUserId, setViewUserId] = useState<string | null>(null);

  const load = useCallback(async (userId: string | null) => {
    setLoading(true);
    try {
      const url = userId ? `/api/me/scheme?userId=${encodeURIComponent(userId)}` : "/api/me/scheme";
      const data = await fetch(url).then((r) => r.json());
      setScheme(data.scheme ?? null);
      setRole(data.role ?? null);
    } catch {
      // network hiccup
    } finally {
      setLoading(false);
    }
  }, []);

  // Load the caller's direct children (if any) so a parent can inspect a
  // child's scheme. Retailers have none / get 403 — the selector stays hidden.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/network?pageSize=100")
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d) => {
        if (cancelled) return;
        const list: DirectChild[] = (d.users ?? []).map((u: { id: string; name: string; role: string; userCode: string | null }) => ({
          id: u.id,
          name: u.name,
          role: u.role,
          userCode: u.userCode,
        }));
        setChildren(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    load(viewUserId);
  }, [load, viewUserId]);

  const viewingChild = viewUserId ? children.find((c) => c.id === viewUserId) ?? null : null;

  const grouped = useMemo(() => groupByFamily(scheme?.slabs ?? []), [scheme]);
  const mdrSlabs = scheme?.mdrSlabs ?? [];

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
      <PageHeader
        eyebrow="Your pricing"
        title="My Scheme"
        description="This is the rate-card assigned to you. Charges, commissions and POS MDR are set by your parent and applied to every transaction you process."
        actions={
          <div className="flex items-center gap-2">
            {children.length > 0 && (
              <select
                value={viewUserId ?? ""}
                onChange={(e) => setViewUserId(e.target.value || null)}
                title="View a direct child's scheme"
                className="rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
              >
                <option value="">My scheme</option>
                {children.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.role})
                  </option>
                ))}
              </select>
            )}
            <Button variant="outline" onClick={() => load(viewUserId)} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        }
      />
      </Reveal>

      {viewingChild && (
        <div className="flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm text-brand-800 shadow-sm">
          <Info className="h-4 w-4 shrink-0" />
          Viewing the scheme of your direct child{" "}
          <span className="font-semibold">{viewingChild.name}</span>
          <StatusPill status={viewingChild.role} tone="brand" />
        </div>
      )}

      {loading ? (
        <Panel className="flex items-center justify-center py-16 text-ink-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading scheme…
        </Panel>
      ) : !scheme ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 shadow-sm">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">No scheme assigned to you yet</p>
            <p className="mt-1">
              Ask your {schemeAssignerLabel(role)} to assign one. Until then you cannot process
              transactions.
            </p>
          </div>
        </div>
      ) : (
        <Reveal distance={16} duration={0.45}>
        <Panel>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Layers className="h-4 w-4 text-ink-400" />
            <h3 className="font-display text-sm font-semibold text-ink-900">{scheme.name}</h3>
            <StatusPill status="Active" />
            <StatusPill status={`${scheme.slabCount} slabs`} tone="brand" />
            {scheme.mdrSlabCount > 0 && (
              <StatusPill status={`${scheme.mdrSlabCount} MDR`} tone="warning" />
            )}
          </div>
          {scheme.description && (
            <p className="mb-3 text-xs text-ink-500">{scheme.description}</p>
          )}
          <p className="mb-4 flex items-center gap-1.5 text-xs text-ink-500">
            <Info className="h-3.5 w-3.5" />
            These are the charges, commissions and MDR rates that apply to your transactions.
          </p>

          <div className="space-y-4">
            {grouped.map(([family, list]) => {
              const cfg = FAMILY_ICONS[family.key];
              const Icon = cfg?.icon ?? CreditCard;
              const cls = cfg?.className ?? "text-ink-600";
              return (
                <div key={family.key}>
                  <SectionTitle
                    className="mb-2"
                    title={
                      <span className={`inline-flex items-center gap-1.5 text-sm ${cls}`}>
                        <Icon className="h-4 w-4" />
                        {family.label} ({list.length})
                      </span>
                    }
                  />
                  <TablePro dense>
                    <table className="text-left">
                      <thead>
                        <tr>
                          <th>Service</th>
                          <th>Provider</th>
                          <th>Band</th>
                          <th className="text-right">Charge</th>
                          <th className="text-right">Commission</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((s) => (
                          <tr key={s.id}>
                            <td className="font-medium text-ink-900">{s.service.replace(/_/g, " ")}</td>
                            <td className="text-xs text-ink-600">{s.provider ?? "All"}</td>
                            <td className="text-ink-600">{fmtBand(s.minAmount, s.maxAmount)}</td>
                            <td className="text-right text-ink-900">{fmtServiceRate(s.chargeType, s.chargeValue)}</td>
                            <td className="text-right text-emerald-700 font-semibold">{fmtServiceRate(s.commissionType, s.commissionValue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TablePro>
                </div>
              );
            })}

            {mdrSlabs.length > 0 && (
              <div>
                <SectionTitle
                  className="mb-2"
                  title={
                    <span className="inline-flex items-center gap-1.5 text-sm text-orange-600">
                      <Store className="h-4 w-4" />
                      MDR rates ({mdrSlabs.length})
                    </span>
                  }
                />
                <TablePro dense>
                  <table className="text-left">
                    <thead>
                      <tr>
                        <th>Rail</th>
                        <th>Company</th>
                        <th>Mode</th>
                        <th>Card / Brand</th>
                        <th className="text-right">MDR T+1</th>
                        <th className="text-right">MDR T+0</th>
                        <th className="text-right">Commission</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mdrSlabs.map((s) => (
                        <tr key={s.id}>
                          <td className="font-medium text-ink-900">{s.serviceKind}</td>
                          <td className="text-ink-600">{s.company ?? "All"}</td>
                          <td className="text-ink-600">{s.paymentMode === "*" ? "Any" : s.paymentMode}</td>
                          <td className="text-xs text-ink-600">
                            {[s.cardType, s.brandType, s.classification].filter(Boolean).join(" / ") || "Any"}
                          </td>
                          <td className="text-right text-ink-900">{fmtRate(s.mdrType, s.mdrValue)}</td>
                          <td className="text-right text-ink-900">
                            {s.mdrValueT0 > 0 ? fmtRate(s.mdrType, s.mdrValueT0) : "= T+1"}
                          </td>
                          <td className="text-right font-semibold text-emerald-700">
                            {s.commission > 0 ? fmtRate(s.commissionType, s.commission) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TablePro>
              </div>
            )}

            {grouped.length === 0 && mdrSlabs.length === 0 && (
              <EmptyState
                compact
                message="No slabs configured in this scheme yet."
              />
            )}
          </div>
        </Panel>
        </Reveal>
      )}
    </div>
  );
}
