"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import { X } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { cn } from "@/lib/utils";
import { toDisplayRole, type Role } from "@/lib/auth";
import { navByRole, type NavGroup } from "@/lib/roles";
import { hrefToServiceKey } from "@/lib/services/catalog";
import { useEffectiveServices } from "@/hooks/useEffectiveServices";

export function Sidebar({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
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
          className="fixed inset-0 z-40 bg-ink-900/50 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-ink-100 bg-white transition-transform lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-ink-100 px-5 md:h-20">
          <Logo />
          <button
            type="button"
            onClick={onClose}
            className="lg:hidden inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-700 hover:bg-ink-100"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5">
          {groups.map((group) => (
            <div key={group.heading} className="mb-5 last:mb-0">
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-ink-400">
                {group.heading}
              </p>
              <ul className="space-y-1">
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
                        className={cn(
                          "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                          active
                            ? "bg-brand-600 text-white shadow-soft"
                            : "text-ink-700 hover:translate-x-0.5 hover:bg-ink-100 hover:text-ink-900"
                        )}
                      >
                        <Icon
                          className={cn(
                            "h-4 w-4 shrink-0",
                            active ? "text-white" : "text-ink-500 group-hover:text-ink-700"
                          )}
                        />
                        <span className="truncate">{item.label}</span>
                        {item.badge && (
                          <span
                            className={cn(
                              "ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold",
                              active
                                ? "bg-white/20 text-white"
                                : "bg-accent-100 text-accent-700"
                            )}
                          >
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

        <div className="m-3 rounded-2xl bg-gradient-to-br from-brand-600 via-brand-700 to-accent-500 p-4 text-white">
          <p className="text-xs font-semibold uppercase tracking-widest opacity-80">
            NextGenPay Pro
          </p>
          <p className="mt-1 text-sm font-medium">
            {role === "retailer"
              ? "Become a distributor and earn commission overrides on every retailer."
              : role === "distributor"
              ? "Unlock white-label & API access — upgrade to Master Distributor."
              : role === "master-distributor"
              ? "Need help scaling? Talk to our enterprise team."
              : "All systems nominal · 99.97% uptime this month."}
          </p>
          <button className="mt-3 rounded-full bg-white/20 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white hover:text-brand-700">
            {role === "master-admin" || role === "admin" || role === "sub-admin" ? "View status page" : "Upgrade plan"}
          </button>
        </div>
      </aside>
    </>
  );
}
