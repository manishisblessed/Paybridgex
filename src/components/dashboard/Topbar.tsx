"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import {
  Bell,
  Menu,
  Search,
  Wallet,
  LogOut,
  Activity,
  Landmark,
  PanelLeftClose,
  PanelLeftOpen,
  User,
  Settings,
  ChevronDown,
} from "lucide-react";
import { Input } from "@/components/ui/Input";
import { formatINR } from "@/lib/utils";
import { toDisplayRole } from "@/lib/auth";

export function Topbar({ onOpenSidebar, collapsed, onToggleCollapse }: { onOpenSidebar: () => void; collapsed?: boolean; onToggleCollapse?: () => void }) {
  const router = useRouter();
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [liveBalance, setLiveBalance] = useState<number | null>(null);
  const [payinToday, setPayinToday] = useState<number | null>(null);
  const [revenueBalance, setRevenueBalance] = useState<number | null>(null);

  const lastFetchedAt = useRef(0);

  const fetchBalance = useCallback(async (force = false) => {
    // Background tabs skip polling entirely; focus refetches are throttled so
    // rapid alt-tabbing doesn't hammer the API.
    if (!force && document.hidden) return;
    if (Date.now() - lastFetchedAt.current < 15_000) return;
    lastFetchedAt.current = Date.now();
    try {
      const res = await fetch("/api/wallet?balanceOnly=1");
      if (res.ok) {
        const data = await res.json();
        setLiveBalance(data.balance ?? null);
      }
    } catch {}
  }, []);

  useEffect(() => {
    // Only poll the personal wallet for users who actually see the Wallet pill.
    // Master admin + admin staff (ADMIN/SUPPORT/FINANCE) don't display it.
    const role = (session?.user as { role?: string } | undefined)?.role;
    if (role === "MASTER_ADMIN" || role === "ADMIN" || role === "SUPPORT" || role === "FINANCE") return;
    fetchBalance(true);
    const interval = setInterval(() => fetchBalance(), 60_000);
    const onFocus = () => fetchBalance();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [fetchBalance, session]);

  // Live company PAYIN (today) — master-admin only. Read straight from the rail
  // sources so it mirrors the operational feeds and resets to ₹0 at IST midnight.
  const sessionRole = (session?.user as { role?: string } | undefined)?.role;
  const isMaster = sessionRole === "MASTER_ADMIN";
  // Admin staff (non-master) don't hold a personal/operational wallet, so hide the
  // generic Wallet pill for them. Payin + Revenue wallets stay master-admin only.
  const isAdminStaff = sessionRole === "ADMIN" || sessionRole === "SUPPORT" || sessionRole === "FINANCE";
  useEffect(() => {
    if (!isMaster) return;
    let active = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const [payinRes, revenueRes] = await Promise.all([
          fetch("/api/admin/wallet/aggregates?view=payin-today"),
          fetch("/api/admin/wallet/aggregates?view=revenue"),
        ]);
        if (!active) return;
        if (payinRes.ok) {
          const data = await payinRes.json();
          setPayinToday(typeof data.totalAmount === "number" ? data.totalAmount : null);
        }
        if (revenueRes.ok) {
          const data = await revenueRes.json();
          setRevenueBalance(typeof data.balance === "number" ? data.balance : null);
        }
      } catch {}
    };
    load();
    const id = setInterval(load, 30_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [isMaster]);

  async function logout() {
    await signOut({ redirect: false });
    router.push("/login");
  }

  const user = session?.user;
  const userCode = (user as { userCode?: string | null } | undefined)?.userCode ?? null;
  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
    : "??";

  const displayRole = user?.role ? toDisplayRole(user.role as any) : "agent";

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-ink-100 bg-white/85 px-4 backdrop-blur-xl md:h-20 md:px-8">
      <div className="flex items-center gap-3 lg:hidden">
        <button
          type="button"
          onClick={onOpenSidebar}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-ink-200 text-ink-700 transition-colors hover:border-brand-300 hover:text-brand-700"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {onToggleCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          className="hidden lg:inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-700 transition-colors"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen className="h-4.5 w-4.5" /> : <PanelLeftClose className="h-4.5 w-4.5" />}
        </button>
      )}

      <div className="hidden flex-1 max-w-md md:block">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input
            placeholder="Search services, customers, transactions..."
            className="rounded-full border-ink-100 bg-ink-50/70 pl-10 focus:bg-white"
          />
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        {isMaster && (
          <Link
            href="/dashboard/admin/wallet-ops?tab=payin"
            className="hidden items-center gap-2.5 rounded-full border border-accent-200/70 bg-gradient-to-r from-accent-50 to-white py-1.5 pl-2 pr-4 transition-all hover:border-accent-400 hover:shadow-soft md:flex"
            title="Live company payin today (all rails) — resets to ₹0 at midnight. Opens Wallet Operations → Live payin."
          >
            <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-accent-500 to-accent-700 text-white">
              <Activity className="h-4 w-4" />
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-accent-700/80">
                Payin · Today
              </span>
              <span className="font-display text-sm font-bold text-ink-900">
                {formatINR(payinToday ?? 0)}
              </span>
            </div>
          </Link>
        )}

        {isMaster ? (
          <Link
            href="/dashboard/admin/revenue"
            className="hidden items-center gap-2.5 rounded-full border border-brand-100 bg-gradient-to-r from-brand-50 to-white py-1.5 pl-2 pr-4 transition-all hover:border-brand-300 hover:shadow-soft md:flex"
            title="Revenue Wallet — company earnings (MDR margin in − commission out). Opens Company Earnings."
          >
            <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white">
              <Landmark className="h-4 w-4" />
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-brand-700/80">
                Revenue Wallet
              </span>
              <span className="font-display text-sm font-bold text-ink-900">
                {formatINR(revenueBalance ?? 0)}
              </span>
            </div>
          </Link>
        ) : isAdminStaff ? null : (
          <div className="hidden items-center gap-2.5 rounded-full border border-brand-100 bg-gradient-to-r from-brand-50 via-white to-accent-50 py-1.5 pl-2 pr-4 md:flex">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-accent-500 text-white">
              <Wallet className="h-4 w-4" />
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-500">
                Wallet Balance
              </span>
              <span className="font-display text-sm font-bold text-ink-900">
                {formatINR(liveBalance ?? user?.walletBalance ?? 0)}
              </span>
            </div>
          </div>
        )}

        <button
          type="button"
          aria-label="Notifications"
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-ink-100 text-ink-600 transition-colors hover:border-brand-200 hover:bg-brand-50/60 hover:text-brand-700"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-2.5 rounded-full border border-ink-100 bg-white py-1.5 pl-1.5 pr-3 transition-all hover:border-brand-200 hover:shadow-soft"
          >
            <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-brand-600 to-accent-500 font-display text-xs font-bold text-white">
              {initials}
            </span>
            <span className="hidden flex-col text-left leading-tight md:flex">
              <span className="text-sm font-semibold text-ink-900">
                {user?.name ?? "Guest"}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-400">
                {displayRole}{userCode ? ` · ${userCode}` : ""}
              </span>
            </span>
            <ChevronDown className="hidden h-3.5 w-3.5 text-ink-400 md:block" />
          </button>
          {open && (
            <div className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-soft">
              <div className="border-b border-ink-100 bg-gradient-to-br from-brand-50/60 to-accent-50/40 p-4 text-sm">
                <p className="font-display font-semibold text-ink-900">{user?.name}</p>
                <p className="mt-0.5 text-xs text-ink-500">{user?.email}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                    {displayRole}
                  </span>
                  {userCode && (
                    <span className="rounded-full bg-accent-100 px-2 py-0.5 text-[10px] font-bold text-accent-700">
                      {userCode}
                    </span>
                  )}
                </div>
              </div>
              <div className="p-1.5">
                <Link
                  href="/dashboard/profile"
                  onClick={() => setOpen(false)}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-50 hover:text-ink-900"
                >
                  <User className="h-4 w-4 text-ink-400" />
                  My Profile
                </Link>
                <Link
                  href="/dashboard/settings"
                  onClick={() => setOpen(false)}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-50 hover:text-ink-900"
                >
                  <Settings className="h-4 w-4 text-ink-400" />
                  Security & Settings
                </Link>
                <button
                  type="button"
                  onClick={logout}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-rose-600 transition-colors hover:bg-rose-50"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
