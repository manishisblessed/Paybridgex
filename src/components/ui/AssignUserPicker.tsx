"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Search, Loader2, Check, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ROLE_TABS,
  ROLE_SHORT_LABEL,
  type RoleTabValue,
} from "@/lib/hierarchy";

/**
 * Canonical user shape returned by `GET /api/admin/users` (the fields the
 * picker relies on). Consumers can accept this directly or map from it.
 */
export type PickerUser = {
  id: string;
  userCode: string;
  name: string;
  shop: string;
  role: string; // kebab-case display role (retailer, distributor, …)
  city: string;
  state: string;
  status: string;
  walletBalance: number;
  monthlyTurnover: number;
  retailers: number;
};

async function pickerFetcher(url: string): Promise<{ users: PickerUser[] }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Failed to load users");
  return r.json();
}

export type AssignUserPickerProps = {
  /** Called when the admin picks a user from the list. */
  onSelect: (user: PickerUser) => void;
  /** User id that is already the current assignee — shown with a "Current" tag and not selectable. */
  currentUserId?: string | null;
  /** User ids to hide from the list entirely (e.g. already-assigned users). */
  excludeUserIds?: string[];
  /** Which role tabs to show. Defaults to All / SD / MD / DT / RT. */
  roles?: readonly { value: RoleTabValue; label: string }[];
  /** Role tab selected on mount. Defaults to "all". */
  defaultRole?: RoleTabValue;
  /** Autofocus the search box on mount. */
  autoFocus?: boolean;
  /** Page size for each fetch. Defaults to 25. */
  pageSize?: number;
  /** Tailwind class controlling the list height. Defaults to "max-h-72". */
  listMaxHeightClass?: string;
  /** Message shown when no users match. */
  emptyLabel?: string;
  /** Fires whenever the visible (selectable) list changes — enables bulk "assign all". */
  onVisibleUsersChange?: (users: PickerUser[]) => void;
  className?: string;
};

/**
 * Role-first user picker. The primary way to choose a user is by selecting a
 * role tab (SD / MD / DT / RT) and picking from the list — no typing required.
 * An optional search box narrows within the active role. Backed by
 * `GET /api/admin/users`, shared across every "assign to a user" flow.
 */
export function AssignUserPicker({
  onSelect,
  currentUserId,
  excludeUserIds,
  roles = ROLE_TABS,
  defaultRole = "all",
  autoFocus = false,
  pageSize = 25,
  listMaxHeightClass = "max-h-72",
  emptyLabel = "No users found.",
  onVisibleUsersChange,
  className,
}: AssignUserPickerProps) {
  const [role, setRole] = useState<RoleTabValue>(defaultRole);
  const [rawQuery, setRawQuery] = useState("");
  const [q, setQ] = useState("");

  // Debounce the search box so we don't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQ(rawQuery.trim()), 250);
    return () => clearTimeout(t);
  }, [rawQuery]);

  const { data, isLoading } = useSWR<{ users: PickerUser[] }>(
    `/api/admin/users?role=${role}&q=${encodeURIComponent(q)}&pageSize=${pageSize}`,
    pickerFetcher,
    { revalidateOnFocus: false, keepPreviousData: true }
  );

  const excluded = useMemo(
    () => new Set(excludeUserIds ?? []),
    [excludeUserIds]
  );

  const users = useMemo(
    () => (data?.users ?? []).filter((u) => !excluded.has(u.id)),
    [data, excluded]
  );

  useEffect(() => {
    onVisibleUsersChange?.(users);
  }, [users, onVisibleUsersChange]);

  return (
    <div className={cn("space-y-3", className)}>
      {/* Role tabs — the primary selector */}
      <div className="flex flex-wrap gap-1.5">
        {roles.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setRole(t.value)}
            className={cn(
              "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
              role === t.value
                ? "bg-brand-600 text-white"
                : "bg-ink-100 text-ink-600 hover:bg-ink-200"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Optional search — narrows within the selected role */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input
          autoFocus={autoFocus}
          type="text"
          placeholder={
            role === "all"
              ? "Search by name, shop, city, code… (optional)"
              : "Search within this role… (optional)"
          }
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
          className="w-full rounded-lg border border-ink-200 py-2 pl-9 pr-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
        />
      </div>

      {/* Options list */}
      <div
        className={cn(
          "divide-y divide-ink-100 overflow-y-auto rounded-lg border border-ink-100",
          listMaxHeightClass
        )}
      >
        {isLoading && users.length === 0 ? (
          <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-ink-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading users…
          </div>
        ) : users.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-ink-500">{emptyLabel}</div>
        ) : (
          users.map((u) => {
            const isCurrent = currentUserId != null && u.id === currentUserId;
            return (
              <button
                key={u.id}
                type="button"
                disabled={isCurrent}
                onClick={() => onSelect(u)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-brand-50/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-ink-900">{u.name}</span>
                    {u.userCode && u.userCode !== "—" && (
                      <span className="shrink-0 text-xs font-medium text-brand-600">{u.userCode}</span>
                    )}
                    <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ink-600">
                      {ROLE_SHORT_LABEL[u.role] ?? u.role}
                    </span>
                  </div>
                  <div className="truncate text-xs text-ink-500">
                    {u.shop && u.shop !== "—" ? u.shop : u.city}
                  </div>
                </div>
                {isCurrent ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    <Check className="h-3 w-3" /> Current
                  </span>
                ) : (
                  <UserPlus className="h-4 w-4 shrink-0 text-brand-600" />
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
