"use client";

import { useEffect, useState } from "react";
import {
  User,
  MapPin,
  Phone,
  Mail,
  Store,
  Shield,
  Activity,
  TrendingUp,
  Clock,
  Users,
  CheckCircle2,
  XCircle,
  Globe,
  CalendarDays,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { Panel, StatTile, TablePro, TableEmptyRow } from "@/components/dashboard/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { formatINR } from "@/lib/utils";

type PerformanceData = {
  user: {
    id: string;
    name: string;
    email: string;
    phone: string;
    role: string;
    status: string;
    shopName: string | null;
    shopAddress: string | null;
    pincode: string | null;
    state: string | null;
    city: string | null;
    walletBalance: number;
    lastLoginLat: number | null;
    lastLoginLng: number | null;
    lastLoginAt: string | null;
    twoFactorEnabled: boolean;
    createdAt: string;
    _count: { transactions: number; wallet: number; children: number };
  };
  parentInfo: { name: string; email: string; phone: string; role: string } | null;
  loginHistory: {
    id: string;
    meta: { lat?: number; lng?: number; accuracy?: number } | null;
    ip: string | null;
    userAgent: string | null;
    createdAt: string;
  }[];
  stats: {
    totalTransactions30d: number;
    totalAmount30d: number;
    successfulTxns: number;
    failedTxns: number;
    successRate: number;
    networkSize: number;
    walletTransactions: number;
  };
};

function roleBadgeColor(role: string) {
  switch (role) {
    case "MASTER_ADMIN": return "bg-violet-100 text-violet-800";
    case "ADMIN": return "bg-ink-100 text-ink-800";
    case "SUPPORT": return "bg-slate-100 text-slate-800";
    case "SUPER_DISTRIBUTOR": return "bg-rose-100 text-rose-800";
    case "MASTER_DISTRIBUTOR": return "bg-emerald-100 text-emerald-800";
    case "DISTRIBUTOR": return "bg-blue-100 text-blue-800";
    default: return "bg-brand-100 text-brand-800";
  }
}

function statusBadgeColor(status: string) {
  switch (status) {
    case "ACTIVE": return "bg-green-100 text-green-800";
    case "SUSPENDED": return "bg-red-100 text-red-800";
    case "PENDING_KYC": return "bg-amber-100 text-amber-800";
    default: return "bg-ink-100 text-ink-800";
  }
}

function formatRole(role: string) {
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function PerformancePage() {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/dashboard/performance")
      .then((res) => res.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => setError("Failed to load performance data"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="page" label="Loading performance data…" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-red-700">
        {error || "Something went wrong"}
      </div>
    );
  }

  const { user, parentInfo, loginHistory, stats } = data;

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          eyebrow="Performance"
          title="User Details & Activity"
          description="Your account information, login history, and transaction performance at a glance."
        />
      </Reveal>

      {/* User Identity Card */}
      <Reveal distance={16} duration={0.45}>
      <Panel flush className="p-6 shadow-soft">
        <div className="flex flex-wrap items-start gap-6">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-600 to-accent-500 text-white">
            <User className="h-8 w-8" />
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-bold text-ink-900">{user.name}</h2>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${roleBadgeColor(user.role)}`}>
                {formatRole(user.role)}
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadgeColor(user.status)}`}>
                {user.status.replace(/_/g, " ")}
              </span>
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-ink-600">
              <span className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" /> {user.email}
              </span>
              <span className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" /> {user.phone}
              </span>
              {user.city && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" /> {user.city}, {user.state}
                </span>
              )}
            </div>
            {user.shopName && (
              <div className="flex items-center gap-1.5 text-sm text-ink-500">
                <Store className="h-3.5 w-3.5" />
                {user.shopName} {user.shopAddress && `· ${user.shopAddress}`} {user.pincode && `· ${user.pincode}`}
              </div>
            )}
            <div className="flex items-center gap-1.5 text-xs text-ink-400">
              <CalendarDays className="h-3.5 w-3.5" />
              Member since {new Date(user.createdAt).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-widest text-ink-500">Wallet Balance</p>
            <p className="font-display text-2xl font-bold text-ink-900">{formatINR(user.walletBalance)}</p>
          </div>
        </div>
      </Panel>
      </Reveal>

      {/* Quick Stats */}
      <Stagger stagger={0.05} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StaggerItem distance={14} duration={0.35}>
          <StatTile
            icon={Activity}
            label="Transactions (30d)"
            countTo={stats.totalTransactions30d}
            tone="brand"
          />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile
            icon={TrendingUp}
            label="Turnover (30d)"
            countTo={stats.totalAmount30d}
            prefix="₹"
            decimals={2}
            tone="emerald"
          />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile
            icon={CheckCircle2}
            label="Success Rate"
            countTo={stats.successRate}
            suffix="%"
            hint={`${stats.successfulTxns} passed · ${stats.failedTxns} failed`}
            tone="sky"
          />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile
            icon={Users}
            label="Network Size"
            countTo={stats.networkSize}
            hint={`${stats.walletTransactions} wallet txns`}
            tone="violet"
          />
        </StaggerItem>
      </Stagger>

      {/* Security & 2FA Status */}
      <Reveal distance={16} duration={0.45} className="grid gap-4 md:grid-cols-2">
        <Panel>
          <h3 className="flex items-center gap-2 font-display text-base font-semibold text-ink-900">
            <Shield className="h-4 w-4 text-brand-600" />
            Security Status
          </h3>
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-ink-50 px-4 py-2.5">
              <span className="text-sm text-ink-700">Two-Factor Auth</span>
              <span className={`flex items-center gap-1 text-xs font-semibold ${user.twoFactorEnabled ? "text-green-700" : "text-red-600"}`}>
                {user.twoFactorEnabled ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                {user.twoFactorEnabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-ink-50 px-4 py-2.5">
              <span className="text-sm text-ink-700">Last Login Location</span>
              <span className="flex items-center gap-1 text-xs font-medium text-ink-600">
                <Globe className="h-3.5 w-3.5" />
                {user.lastLoginLat && user.lastLoginLng
                  ? `${user.lastLoginLat.toFixed(4)}, ${user.lastLoginLng.toFixed(4)}`
                  : "Not available"}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-ink-50 px-4 py-2.5">
              <span className="text-sm text-ink-700">Last Login Time</span>
              <span className="flex items-center gap-1 text-xs font-medium text-ink-600">
                <Clock className="h-3.5 w-3.5" />
                {user.lastLoginAt
                  ? new Date(user.lastLoginAt).toLocaleString("en-IN")
                  : "N/A"}
              </span>
            </div>
          </div>
        </Panel>

        {/* Parent/Upline Info */}
        <Panel>
          <h3 className="flex items-center gap-2 font-display text-base font-semibold text-ink-900">
            <Users className="h-4 w-4 text-brand-600" />
            {parentInfo ? "Upline / Parent" : "Account Hierarchy"}
          </h3>
          <div className="mt-4 space-y-3">
            {parentInfo ? (
              <>
                <div className="flex items-center justify-between rounded-lg bg-ink-50 px-4 py-2.5">
                  <span className="text-sm text-ink-700">Name</span>
                  <span className="text-xs font-medium text-ink-800">{parentInfo.name}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-ink-50 px-4 py-2.5">
                  <span className="text-sm text-ink-700">Role</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${roleBadgeColor(parentInfo.role)}`}>
                    {formatRole(parentInfo.role)}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-ink-50 px-4 py-2.5">
                  <span className="text-sm text-ink-700">Contact</span>
                  <span className="text-xs font-medium text-ink-600">{parentInfo.phone}</span>
                </div>
              </>
            ) : (
              <div className="flex h-24 items-center justify-center rounded-lg bg-ink-50 text-sm text-ink-500">
                You are a top-level account — no upline assigned.
              </div>
            )}
          </div>
        </Panel>
      </Reveal>

      {/* Login History */}
      <Reveal distance={16} duration={0.45}>
        <TablePro title="Recent Login Activity" dense>
          <table>
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>IP Address</th>
                <th>Location (Lat, Lng)</th>
                <th>Device</th>
              </tr>
            </thead>
            <tbody>
              {loginHistory.length === 0 ? (
                <TableEmptyRow
                  colSpan={4}
                  icon={Clock}
                  message="No login history available yet."
                />
              ) : (
                loginHistory.map((entry) => {
                  const meta = entry.meta as { lat?: number; lng?: number } | null;
                  const ua = entry.userAgent || "Unknown";
                  const shortDevice = ua.length > 50 ? ua.slice(0, 50) + "..." : ua;
                  return (
                    <tr key={entry.id}>
                      <td className="whitespace-nowrap text-ink-800">
                        {new Date(entry.createdAt).toLocaleString("en-IN")}
                      </td>
                      <td className="font-mono text-xs text-ink-600">
                        {entry.ip || "—"}
                      </td>
                      <td className="text-ink-600">
                        {meta?.lat && meta?.lng
                          ? `${meta.lat.toFixed(4)}, ${meta.lng.toFixed(4)}`
                          : "—"}
                      </td>
                      <td className="max-w-[200px] truncate text-xs text-ink-500">
                        {shortDevice}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </TablePro>
      </Reveal>
    </div>
  );
}
