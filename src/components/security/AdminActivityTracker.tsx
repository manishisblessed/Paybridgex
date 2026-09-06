"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Logs sensitive admin page views (read access) as the operator navigates the
 * admin area. Self-restricting: only fires for /dashboard/admin,
 * /dashboard/master-admin and /dashboard/sub-admin. Client-side dedupe (only on
 * a real path change) plus server-side throttling keeps the audit table clean.
 *
 * Mounted once in the dashboard layout — cheaper than per-route-group layouts
 * and it gets the pathname directly.
 */
const ADMIN_PREFIXES = [
  "/dashboard/admin",
  "/dashboard/master-admin",
  "/dashboard/sub-admin",
];

export function AdminActivityTracker() {
  const pathname = usePathname();
  const lastLogged = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    if (!ADMIN_PREFIXES.some((p) => pathname.startsWith(p))) return;
    if (lastLogged.current === pathname) return;
    lastLogged.current = pathname;

    // Best-effort; keepalive lets it complete across a fast navigation.
    fetch("/api/admin/activity/page-view", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: pathname }),
      keepalive: true,
    }).catch(() => {});
  }, [pathname]);

  return null;
}
