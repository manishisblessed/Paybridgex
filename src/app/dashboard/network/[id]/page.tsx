"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  Wallet,
  TrendingUp,
  CalendarDays,
  CircleDollarSign,
  Users,
  History,
  Activity as ActivityIcon,
  Layers,
  Info,
  AlertCircle,
  Store,
  CreditCard,
  Send,
  ClipboardCheck,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatINR } from "@/lib/utils";
import { SERVICE_FAMILIES, familyOf, type ServiceFamily } from "@/lib/scheme/constants";
import {
  OnboardingProgressView,
  type OnboardingProgress,
} from "@/components/network/OnboardingProgressView";

type Detail = {
  user: {
    id: string;
    userCode: string | null;
    name: string;
    email: string | null;
    phone: string | null;
    role: string;
    status: string;
    shop: string;
    city: string;
    state: string;
    joined: string;
    walletBalance: number;
    schemeId: string | null;
    schemeName: string | null;
    parent: { id: string; name: string; role: string } | null;
    downline: number;
  };
  stats: {
    turnoverToday: number;
    turnoverMtd: number;
    turnoverLifetime: number;
    commissionMtd: number;
    commissionLifetime: number;
    txnCount: number;
  };
};

type Txn = {
  id: string;
  service: string;
  amount: number;
  status: "Success" | "Pending" | "Failed";
  date: string;
  customer: string;
  commission: number;
};

type ActivityRow = {
  id: string;
  action: string;
  label: string;
  entity: string | null;
  bySelf: boolean;
  meta: unknown;
  ip: string | null;
  date: string;
};

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
};
type Scheme = {
  id: string;
  name: string;
  description: string | null;
  slabCount: number;
  mdrSlabCount: number;
  slabs?: Slab[];
  mdrSlabs?: MdrSlab[];
};

type Tab = "onboarding" | "transactions" | "activity" | "scheme";

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

const FAMILY_ICONS: Record<string, typeof CreditCard> = { BBPS: CreditCard, PAYOUT: Send };

function StatCard({
  icon: Icon,
  label,
  value,
  tint,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  tint: string;
}) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-4">
      <div className={`mb-2 inline-flex h-9 w-9 items-center justify-center rounded-xl ${tint}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{label}</p>
      <p className="mt-0.5 font-display text-lg font-bold text-ink-900">{value}</p>
    </div>
  );
}

export default function NetworkMemberDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("transactions");

  const [txns, setTxns] = useState<Txn[]>([]);
  const [txnLoading, setTxnLoading] = useState(false);
  const [acts, setActs] = useState<ActivityRow[]>([]);
  const [actLoading, setActLoading] = useState(false);
  const [scheme, setScheme] = useState<Scheme | null>(null);
  const [schemeLoading, setSchemeLoading] = useState(false);
  const [schemeError, setSchemeError] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingProgress | null>(null);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/network/${id}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not load this account.");
        setDetail(null);
      } else {
        setDetail(data);
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadTxns = useCallback(async () => {
    setTxnLoading(true);
    try {
      const res = await fetch(`/api/network/${id}/transactions?limit=100`);
      const data = await res.json();
      setTxns(data.data ?? []);
    } catch {
      // silent
    } finally {
      setTxnLoading(false);
    }
  }, [id]);

  const loadActs = useCallback(async () => {
    setActLoading(true);
    try {
      const res = await fetch(`/api/network/${id}/activity?limit=100`);
      const data = await res.json();
      setActs(data.data ?? []);
    } catch {
      // silent
    } finally {
      setActLoading(false);
    }
  }, [id]);

  const loadScheme = useCallback(async () => {
    setSchemeLoading(true);
    setSchemeError(null);
    try {
      const res = await fetch(`/api/me/scheme?userId=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) {
        setSchemeError(data.error ?? "Could not load the scheme.");
        setScheme(null);
      } else {
        setScheme(data.scheme ?? null);
      }
    } catch {
      setSchemeError("Network error — please try again.");
    } finally {
      setSchemeLoading(false);
    }
  }, [id]);

  const loadOnboarding = useCallback(async () => {
    setOnboardingLoading(true);
    setOnboardingError(null);
    try {
      const res = await fetch(`/api/network/${id}/onboarding`);
      const data = await res.json();
      if (!res.ok) {
        setOnboardingError(data.error ?? "Could not load onboarding status.");
        setOnboarding(null);
      } else {
        setOnboarding(data);
      }
    } catch {
      setOnboardingError("Network error — please try again.");
    } finally {
      setOnboardingLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  // Land on the Onboarding tab first when the member isn't active yet — that's
  // the reason a parent is most likely opening this page.
  useEffect(() => {
    if (detail?.user && detail.user.status !== "Active") setTab("onboarding");
  }, [detail?.user?.status]);

  useEffect(() => {
    if (tab === "transactions") loadTxns();
    else if (tab === "activity") loadActs();
    else if (tab === "scheme") loadScheme();
    else if (tab === "onboarding") loadOnboarding();
  }, [tab, loadTxns, loadActs, loadScheme, loadOnboarding]);

  const cols: Column<Txn>[] = [
    { key: "id", header: "Ref ID", render: (r) => <span className="font-medium text-brand-600">{r.id}</span> },
    { key: "service", header: "Service" },
    { key: "customer", header: "Customer" },
    { key: "amount", header: "Amount", align: "right", render: (r) => formatINR(r.amount) },
    { key: "commission", header: "Commission", align: "right", render: (r) => formatINR(r.commission) },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge variant={r.status === "Success" ? "success" : r.status === "Pending" ? "warning" : "danger"}>
          {r.status}
        </Badge>
      ),
    },
    { key: "date", header: "Date" },
  ];

  const grouped = useMemo(() => groupByFamily(scheme?.slabs ?? []), [scheme]);
  const mdrSlabs = scheme?.mdrSlabs ?? [];

  const u = detail?.user;
  const s = detail?.stats;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Network member"
        title={u?.name ?? "Member"}
        description={
          u
            ? `${u.role.replace(/-/g, " ")} · ${u.userCode ?? u.id.slice(0, 8)} · ${u.shop}`
            : "Loading member…"
        }
        actions={
          <div className="flex items-center gap-2">
            <Link href="/dashboard/network">
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </Link>
            <Button variant="outline" onClick={loadDetail} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        }
      />

      {error ? (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Can’t open this account</p>
            <p className="mt-1">{error}</p>
          </div>
        </div>
      ) : loading || !u || !s ? (
        <div className="flex items-center justify-center rounded-2xl border border-ink-100 bg-white py-16 text-ink-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading member…
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={u.status === "Active" ? "success" : u.status === "Pending KYC" ? "warning" : "danger"}>
              {u.status}
            </Badge>
            {u.schemeName ? (
              <Badge variant="brand">
                <Layers className="h-3.5 w-3.5" /> {u.schemeName}
              </Badge>
            ) : (
              <Badge variant="warning">No scheme</Badge>
            )}
            <span className="text-xs text-ink-500">
              {u.city}, {u.state} · Joined {u.joined}
            </span>
            {u.parent && (
              <span className="text-xs text-ink-400">
                Parent: <span className="font-medium text-ink-600">{u.parent.name}</span> ({u.parent.role.replace(/-/g, " ")})
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <StatCard icon={Wallet} label="Wallet" value={formatINR(u.walletBalance)} tint="bg-brand-100 text-brand-700" />
            <StatCard icon={CalendarDays} label="Today" value={formatINR(s.turnoverToday)} tint="bg-blue-100 text-blue-700" />
            <StatCard icon={TrendingUp} label="MTD Turnover" value={formatINR(s.turnoverMtd)} tint="bg-emerald-100 text-emerald-700" />
            <StatCard icon={TrendingUp} label="Lifetime" value={formatINR(s.turnoverLifetime)} tint="bg-emerald-100 text-emerald-700" />
            <StatCard icon={CircleDollarSign} label="Commission MTD" value={formatINR(s.commissionMtd)} tint="bg-amber-100 text-amber-700" />
            <StatCard icon={Users} label="Downline" value={String(u.downline)} tint="bg-violet-100 text-violet-700" />
          </div>

          <div className="flex flex-wrap gap-1 border-b border-ink-100">
            {([
              { key: "onboarding", label: "Onboarding", icon: ClipboardCheck },
              { key: "transactions", label: "Transactions", icon: History },
              { key: "activity", label: "Activity", icon: ActivityIcon },
              { key: "scheme", label: "Scheme", icon: Layers },
            ] as const).map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? "border-brand-600 text-brand-700"
                      : "border-transparent text-ink-500 hover:text-ink-800"
                  }`}
                >
                  <t.icon className="h-4 w-4" />
                  {t.label}
                </button>
              );
            })}
          </div>

          {tab === "onboarding" && (
            <OnboardingProgressView
              loading={onboardingLoading}
              error={onboardingError}
              data={onboarding}
              memberName={u.name}
              memberStatus={u.status}
            />
          )}

          {tab === "transactions" && (
            <DataTable
              title={`Transactions (${txns.length})`}
              columns={cols}
              data={txns}
              loading={txnLoading}
              empty="No transactions yet for this member."
            />
          )}

          {tab === "activity" && (
            <div className="rounded-2xl border border-ink-100 bg-white">
              {actLoading ? (
                <div className="flex items-center justify-center py-14 text-ink-500">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading activity…
                </div>
              ) : acts.length === 0 ? (
                <p className="py-14 text-center text-sm text-ink-500">No recorded activity yet.</p>
              ) : (
                <ul className="divide-y divide-ink-50">
                  {acts.map((a) => (
                    <li key={a.id} className="flex items-start gap-3 px-5 py-3">
                      <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-100 text-ink-500">
                        <ActivityIcon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-ink-900">{a.label}</span>
                          {!a.bySelf && (
                            <Badge variant="default">by parent/admin</Badge>
                          )}
                        </div>
                        <p className="text-xs text-ink-500">
                          {a.date}
                          {a.ip ? ` · ${a.ip}` : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === "scheme" && (
            <div className="rounded-2xl border border-ink-100 bg-white p-5">
              {schemeLoading ? (
                <div className="flex items-center justify-center py-10 text-ink-500">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading scheme…
                </div>
              ) : schemeError ? (
                <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <Info className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>{schemeError}</div>
                </div>
              ) : !scheme ? (
                <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-semibold">No scheme assigned to this member</p>
                    <p className="mt-1">They cannot process transactions until a scheme is assigned.</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <Layers className="h-4 w-4 text-ink-400" />
                    <h3 className="font-display text-sm font-semibold text-ink-900">{scheme.name}</h3>
                    <Badge variant="brand">{scheme.slabCount} slabs</Badge>
                    {scheme.mdrSlabCount > 0 && <Badge variant="warning">{scheme.mdrSlabCount} MDR</Badge>}
                  </div>

                  <div className="space-y-4">
                    {grouped.map(([family, list]) => {
                      const Icon = FAMILY_ICONS[family.key] ?? CreditCard;
                      return (
                        <div key={family.key}>
                          <div className="mb-1.5 flex items-center gap-1.5">
                            <Icon className="h-4 w-4 text-ink-600" />
                            <h4 className="text-sm font-semibold text-ink-700">
                              {family.label} ({list.length})
                            </h4>
                          </div>
                          <div className="overflow-x-auto rounded-xl border border-ink-100">
                            <table className="w-full min-w-max text-left text-sm">
                              <thead className="bg-ink-50/60 text-[11px] uppercase tracking-wide text-ink-400">
                                <tr>
                                  <th className="px-3 py-2">Service</th>
                                  <th className="px-3 py-2">Provider</th>
                                  <th className="px-3 py-2">Band</th>
                                  <th className="px-3 py-2 text-right">Charge</th>
                                  <th className="px-3 py-2 text-right">Commission</th>
                                </tr>
                              </thead>
                              <tbody>
                                {list.map((sl) => (
                                  <tr key={sl.id} className="border-t border-ink-50">
                                    <td className="px-3 py-2 font-medium text-ink-900">{sl.service.replace(/_/g, " ")}</td>
                                    <td className="px-3 py-2 text-xs text-ink-600">{sl.provider ?? "All"}</td>
                                    <td className="px-3 py-2 text-ink-600">{fmtBand(sl.minAmount, sl.maxAmount)}</td>
                                    <td className="px-3 py-2 text-right text-ink-900">{fmtServiceRate(sl.chargeType, sl.chargeValue)}</td>
                                    <td className="px-3 py-2 text-right font-semibold text-emerald-700">{fmtServiceRate(sl.commissionType, sl.commissionValue)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })}

                    {mdrSlabs.length > 0 && (
                      <div>
                        <div className="mb-1.5 flex items-center gap-1.5">
                          <Store className="h-4 w-4 text-orange-600" />
                          <h4 className="text-sm font-semibold text-orange-600">POS MDR ({mdrSlabs.length})</h4>
                        </div>
                        <div className="overflow-x-auto rounded-xl border border-ink-100">
                          <table className="w-full min-w-max text-left text-sm">
                            <thead className="bg-ink-50/60 text-[11px] uppercase tracking-wide text-ink-400">
                              <tr>
                                <th className="px-3 py-2">Rail</th>
                                <th className="px-3 py-2">Company</th>
                                <th className="px-3 py-2">Mode</th>
                                <th className="px-3 py-2">Card / Brand</th>
                                <th className="px-3 py-2 text-right">MDR T+1</th>
                                <th className="px-3 py-2 text-right">MDR T+0</th>
                                <th className="px-3 py-2 text-right">Commission</th>
                              </tr>
                            </thead>
                            <tbody>
                              {mdrSlabs.map((sl) => (
                                <tr key={sl.id} className="border-t border-ink-50">
                                  <td className="px-3 py-2 font-medium text-ink-900">{sl.serviceKind}</td>
                                  <td className="px-3 py-2 text-ink-600">{sl.company ?? "All"}</td>
                                  <td className="px-3 py-2 text-ink-600">{sl.paymentMode === "*" ? "Any" : sl.paymentMode}</td>
                                  <td className="px-3 py-2 text-xs text-ink-600">
                                    {[sl.cardType, sl.brandType, sl.classification].filter(Boolean).join(" / ") || "Any"}
                                  </td>
                                  <td className="px-3 py-2 text-right text-ink-900">{fmtRate(sl.mdrType, sl.mdrValue)}</td>
                                  <td className="px-3 py-2 text-right text-ink-900">
                                    {sl.mdrValueT0 > 0 ? fmtRate(sl.mdrType, sl.mdrValueT0) : "= T+1"}
                                  </td>
                                  <td className="px-3 py-2 text-right font-semibold text-emerald-700">
                                    {sl.commission > 0 ? fmtRate(sl.commissionType, sl.commission) : "—"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {grouped.length === 0 && mdrSlabs.length === 0 && (
                      <p className="py-4 text-center text-sm text-ink-500">No slabs configured in this scheme yet.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

