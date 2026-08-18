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
  FileText,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Panel, StatTile, TabNav, TablePro } from "@/components/dashboard/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatINR } from "@/lib/utils";
import { SERVICE_FAMILIES, familyOf, type ServiceFamily } from "@/lib/scheme/constants";
import {
  OnboardingProgressView,
  type OnboardingProgress,
} from "@/components/network/OnboardingProgressView";
import { KycDetailView, type KycDetailData } from "@/components/kyc/KycDetailView";

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

type Tab = "onboarding" | "kyc" | "transactions" | "activity" | "scheme";

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
  const [kyc, setKyc] = useState<KycDetailData | null>(null);
  const [kycLoading, setKycLoading] = useState(false);
  const [kycError, setKycError] = useState<string | null>(null);

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

  const loadKyc = useCallback(async () => {
    setKycLoading(true);
    setKycError(null);
    try {
      const res = await fetch(`/api/network/${id}/kyc`);
      const data = await res.json();
      if (!res.ok) {
        setKycError(data.error ?? "Could not load documents & KYC.");
        setKyc(null);
      } else {
        setKyc(data.kyc);
      }
    } catch {
      setKycError("Network error — please try again.");
    } finally {
      setKycLoading(false);
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
    else if (tab === "kyc") loadKyc();
  }, [tab, loadTxns, loadActs, loadScheme, loadOnboarding, loadKyc]);

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
      <Reveal distance={14} duration={0.4}>
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
      </Reveal>

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

          <Stagger stagger={0.05} className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <StaggerItem distance={14} duration={0.35}>
              <StatTile icon={Wallet} label="Wallet" tone="dark" countTo={u.walletBalance} prefix="₹" decimals={2} className="h-full" />
            </StaggerItem>
            <StaggerItem distance={14} duration={0.35}>
              <StatTile icon={CalendarDays} label="Today" tone="sky" countTo={s.turnoverToday} prefix="₹" decimals={2} className="h-full" />
            </StaggerItem>
            <StaggerItem distance={14} duration={0.35}>
              <StatTile icon={TrendingUp} label="MTD Turnover" tone="emerald" countTo={s.turnoverMtd} prefix="₹" decimals={2} className="h-full" />
            </StaggerItem>
            <StaggerItem distance={14} duration={0.35}>
              <StatTile icon={TrendingUp} label="Lifetime" tone="brand" countTo={s.turnoverLifetime} prefix="₹" decimals={2} className="h-full" />
            </StaggerItem>
            <StaggerItem distance={14} duration={0.35}>
              <StatTile icon={CircleDollarSign} label="Commission MTD" tone="amber" countTo={s.commissionMtd} prefix="₹" decimals={2} className="h-full" />
            </StaggerItem>
            <StaggerItem distance={14} duration={0.35}>
              <StatTile icon={Users} label="Downline" tone="violet" countTo={u.downline} className="h-full" />
            </StaggerItem>
          </Stagger>

          <Reveal distance={16} duration={0.45} className="space-y-6">
          <TabNav
            tabs={[
              { key: "onboarding", label: "Onboarding", icon: ClipboardCheck },
              { key: "kyc", label: "Documents & KYC", icon: FileText },
              { key: "transactions", label: "Transactions", icon: History },
              { key: "activity", label: "Activity", icon: ActivityIcon },
              { key: "scheme", label: "Scheme", icon: Layers },
            ]}
            active={tab}
            onChange={(k) => setTab(k as Tab)}
          />

          {tab === "onboarding" && (
            <OnboardingProgressView
              loading={onboardingLoading}
              error={onboardingError}
              data={onboarding}
              memberName={u.name}
              memberStatus={u.status}
            />
          )}

          {tab === "kyc" && (
            <Panel flush>
              {kycLoading ? (
                <div className="flex items-center justify-center py-16 text-ink-500">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading documents & KYC…
                </div>
              ) : kycError ? (
                <div className="m-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <Info className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>{kycError}</div>
                </div>
              ) : !kyc ? (
                <p className="py-16 text-center text-sm text-ink-500">
                  No KYC record found for this member.
                </p>
              ) : (
                <KycDetailView
                  kyc={kyc}
                  getDocHref={(docId) => `/api/network/${id}/documents/${docId}`}
                />
              )}
            </Panel>
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
            <Panel flush>
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
            </Panel>
          )}

          {tab === "scheme" && (
            <Panel>
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
                          <TablePro dense>
                            <table>
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
                                {list.map((sl) => (
                                  <tr key={sl.id}>
                                    <td className="font-medium text-ink-900">{sl.service.replace(/_/g, " ")}</td>
                                    <td className="text-xs text-ink-600">{sl.provider ?? "All"}</td>
                                    <td className="text-ink-600">{fmtBand(sl.minAmount, sl.maxAmount)}</td>
                                    <td className="text-right text-ink-900">{fmtServiceRate(sl.chargeType, sl.chargeValue)}</td>
                                    <td className="text-right font-semibold text-emerald-700">{fmtServiceRate(sl.commissionType, sl.commissionValue)}</td>
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
                        <div className="mb-1.5 flex items-center gap-1.5">
                          <Store className="h-4 w-4 text-orange-600" />
                          <h4 className="text-sm font-semibold text-orange-600">POS MDR ({mdrSlabs.length})</h4>
                        </div>
                        <TablePro dense>
                          <table>
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
                              {mdrSlabs.map((sl) => (
                                <tr key={sl.id}>
                                  <td className="font-medium text-ink-900">{sl.serviceKind}</td>
                                  <td className="text-ink-600">{sl.company ?? "All"}</td>
                                  <td className="text-ink-600">{sl.paymentMode === "*" ? "Any" : sl.paymentMode}</td>
                                  <td className="text-xs text-ink-600">
                                    {[sl.cardType, sl.brandType, sl.classification].filter(Boolean).join(" / ") || "Any"}
                                  </td>
                                  <td className="text-right text-ink-900">{fmtRate(sl.mdrType, sl.mdrValue)}</td>
                                  <td className="text-right text-ink-900">
                                    {sl.mdrValueT0 > 0 ? fmtRate(sl.mdrType, sl.mdrValueT0) : "= T+1"}
                                  </td>
                                  <td className="text-right font-semibold text-emerald-700">
                                    {sl.commission > 0 ? fmtRate(sl.commissionType, sl.commission) : "—"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </TablePro>
                      </div>
                    )}

                    {grouped.length === 0 && mdrSlabs.length === 0 && (
                      <p className="py-4 text-center text-sm text-ink-500">No slabs configured in this scheme yet.</p>
                    )}
                  </div>
                </>
              )}
            </Panel>
          )}
          </Reveal>
        </>
      )}
    </div>
  );
}

