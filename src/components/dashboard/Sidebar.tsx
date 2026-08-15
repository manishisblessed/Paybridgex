"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { X, ChevronsLeft, ChevronsRight, Sparkles } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { cn } from "@/lib/utils";
import { toDisplayRole, type Role } from "@/lib/auth";
import { navByRole, type NavGroup } from "@/lib/roles";
import { hrefToServiceKey } from "@/lib/services/catalog";
import { useEffectiveServices } from "@/hooks/useEffectiveServices";

export function Sidebar({
  open,
  onClose,
  collapsed = false,
  onToggleCollapse,
}: {
  open: boolean;
  onClose: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  const { data: session } = useSession();

  const role: Role = useMemo(() => {
    if (!session?.user?.role) return "retailer";
    return toDisplayRole(session.user.role as any);
  }, [session]);

  const allowedTabs: string[] = useMemo(
    () => (session?.user as any)?.allowedTabs ?? [],
    [session]
  );

  const isStaff =
    role === "master-admin" || role === "admin" || role === "sub-admin" || role === "finance";

  // Effective services (globally enabled AND enabled per-user). Null while
  // loading — service links stay hidden until the allowlist is known.
  const effectiveServices = useEffectiveServices();

  const groups: NavGroup[] = useMemo(() => {
    let base = navByRole[role];

    // Admin/sub-admin: filter workspace tabs by allowedTabs. Tab links may sit
    // under /dashboard/admin/, /dashboard/master-admin/ or /dashboard/sub-admin/
    // depending on the nav — match by slug regardless of prefix.
    // Master-admins always have full access and are never scoped.
    if ((role === "admin" || role === "sub-admin") && allowedTabs.length > 0) {
      const prefixes = [
        "/dashboard/admin/",
        "/dashboard/master-admin/",
        "/dashboard/sub-admin/",
      ];
      base = base
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => {
            const prefix = prefixes.find((p) => item.href.startsWith(p));
            if (!prefix) return true;
            const slug = item.href.slice(prefix.length).split("/")[0];
            return allowedTabs.includes(slug);
          }),
        }))
        .filter((group) => group.items.length > 0);
    }

    // Network roles (RT/DT/MD/SD): show only services that are enabled both
    // globally and for this user (default-disabled allowlist).
    if (!isStaff) {
      const allowed = effectiveServices ?? new Set<string>();
      base = base
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => {
            const key = hrefToServiceKey(item.href);
            if (!key) return true;
            return allowed.has(key);
          }),
        }))
        .filter((group) => group.items.length > 0);
    }

    return base;
  }, [role, allowedTabs, isStaff, effectiveServices]);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-ink-950/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col bg-[#0b1030] text-white transition-all duration-300 lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
          collapsed ? "lg:w-[72px]" : "lg:w-72",
          "w-72"
        )}
      >
        {/* Subtle brand glow at the top of the rail */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(80%_100%_at_50%_0%,rgba(49,100,246,0.22)_0%,rgba(16,185,129,0.06)_55%,transparent_100%)]" />

        <div
          className={cn(
            "relative flex h-16 items-center border-b border-white/10 md:h-20",
            collapsed ? "justify-center px-2" : "justify-between px-5"
          )}
        >
          {!collapsed && <Logo variant="light" />}
          {collapsed && (
            <div className="hidden lg:flex h-9 w-9 items-center justify-center">
              <Logo iconOnly variant="light" />
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="lg:hidden inline-flex h-9 w-9 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav
          className={cn(
            "relative flex-1 overflow-y-auto py-5 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.18)_transparent]",
            collapsed ? "px-2" : "px-3"
          )}
        >
          {groups.map((group) => (
            <div key={group.heading} className="mb-6 last:mb-0">
              {!collapsed && (
                <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
                  {group.heading}
                </p>
              )}
              {collapsed && <div className="mb-2 mx-auto h-px w-8 bg-white/10" />}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active =
                    pathname === item.href ||
                    (item.href !== "/dashboard" && pathname.startsWith(item.href));
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          "group relative flex items-center rounded-xl text-sm font-medium transition-colors duration-200",
                          collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
                          active
                            ? "text-white"
                            : "text-white/60 hover:bg-white/5 hover:text-white"
                        )}
                      >
                        {active && (
                          <motion.span
                            layoutId="sidebar-active-pill"
                            transition={{ type: "spring", stiffness: 420, damping: 36 }}
                            className="absolute inset-0 rounded-xl bg-gradient-to-r from-accent-500/25 via-white/[0.07] to-white/[0.04] ring-1 ring-inset ring-accent-400/30"
                            aria-hidden
                          />
                        )}
                        {active && !collapsed && (
                          <motion.span
                            layoutId="sidebar-active-dot"
                            transition={{ type: "spring", stiffness: 420, damping: 36 }}
                            className="absolute left-0 h-5 w-1 rounded-r-full bg-accent-400 shadow-[0_0_12px_rgba(52,211,153,0.65)]"
                            aria-hidden
                          />
                        )}
                        <Icon
                          className={cn(
                            "relative h-4 w-4 shrink-0 transition-colors",
                            active
                              ? "text-accent-300"
                              : "text-white/45 group-hover:text-white/80"
                          )}
                        />
                        {!collapsed && (
                          <span className="relative truncate">{item.label}</span>
                        )}
                        {!collapsed && item.badge && (
                          <span className="relative ml-auto rounded-full bg-accent-400/15 px-2 py-0.5 text-[10px] font-bold text-accent-300">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {!collapsed && (
          <div className="relative m-3 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] p-4">
            <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-accent-500/25 blur-2xl" />
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-accent-300">
              <Sparkles className="h-3 w-3" />
              Paybridgex Pro
            </p>
            <p className="mt-2 text-xs leading-relaxed text-white/70">
              {role === "retailer"
                ? "Become a distributor and earn commission overrides on every retailer."
                : role === "distributor"
                ? "Unlock white-label & API access — upgrade to Master Distributor."
                : role === "master-distributor"
                ? "Need help scaling? Talk to our enterprise team."
                : "All systems nominal · 99.97% uptime this month."}
            </p>
            <button className="mt-3 rounded-full bg-accent-500/90 px-3.5 py-1.5 text-xs font-semibold text-ink-950 transition-colors hover:bg-accent-400">
              {role === "master-admin" || role === "admin" || role === "sub-admin"
                ? "View status page"
                : "Upgrade plan"}
            </button>
          </div>
        )}

        {/* Collapse/Expand toggle — desktop only */}
        <div
          className={cn(
            "hidden lg:flex border-t border-white/10",
            collapsed ? "justify-center p-2" : "justify-end px-3 py-2"
          )}
        >
          <button
            type="button"
            onClick={onToggleCollapse}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/45 transition-colors hover:bg-white/10 hover:text-white"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </div>
      </aside>
    </>
  );
}
