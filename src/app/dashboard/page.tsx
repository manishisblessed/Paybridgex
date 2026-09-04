"use client";

import { useSession } from "next-auth/react";
import { toDisplayRole } from "@/lib/auth";
import { RetailerOverview } from "@/components/dashboard/overview/RetailerOverview";
import { DistributorOverview } from "@/components/dashboard/overview/DistributorOverview";
import { MasterOverview } from "@/components/dashboard/overview/MasterOverview";
import { AdminOverview } from "@/components/dashboard/overview/AdminOverview";
import { TodaysBusinessOverview } from "@/components/dashboard/overview/TodaysBusinessOverview";
import { NetworkOverview } from "@/components/dashboard/overview/NetworkOverview";
import { RetailerBusinessOverview } from "@/components/dashboard/overview/RetailerBusinessOverview";
import { BUSINESS_OVERVIEW_TAB } from "@/lib/roles";

export default function DashboardHomePage() {
  const { data: session } = useSession();

  if (!session?.user) return null;

  const displayRole = toDisplayRole(session.user.role as any);

  const legacySession = {
    name: session.user.name,
    email: session.user.email,
    phone: session.user.phone,
    role: displayRole,
    walletBalance: session.user.walletBalance ?? 0,
    loggedInAt: Date.now(),
  };

  // "Today's Business Overview" — master-admin always; ADMIN/SUPPORT only when
  // explicitly granted the business-overview tab (User.allowedTabs). Kept as an
  // additive section above the existing role overview, which is left untouched.
  const dbRole = session.user.role;
  const allowedTabs = (session.user as { allowedTabs?: string[] }).allowedTabs ?? [];
  const canSeeBusinessOverview =
    dbRole === "MASTER_ADMIN" ||
    ((dbRole === "ADMIN" || dbRole === "SUPPORT") &&
      allowedTabs.includes(BUSINESS_OVERVIEW_TAB));

  const overview = (() => {
    switch (displayRole) {
      case "master-admin":
      case "admin":
      case "sub-admin":
      case "finance":
        return <AdminOverview session={legacySession as any} />;
      case "super-distributor":
      case "master-distributor":
        return <MasterOverview session={legacySession as any} />;
      case "distributor":
        return <DistributorOverview session={legacySession as any} />;
      case "retailer":
      default:
        return <RetailerOverview session={legacySession as any} />;
    }
  })();

  // Distributor tiers (SD / MD / DT) get the hierarchical Network Business
  // Overview — activity of the entities directly under them, each row rolling up
  // that member's whole subtree. Rendered above their existing role overview.
  const isNetworkTier =
    displayRole === "super-distributor" ||
    displayRole === "master-distributor" ||
    displayRole === "distributor";

  // Retailers are the transacting leaf — they get a self-scoped "Today's
  // Business" summary of their own activity across all rails.
  const isRetailer = displayRole === "retailer";

  if (!canSeeBusinessOverview && !isNetworkTier && !isRetailer) return overview;

  return (
    <div className="space-y-8">
      {canSeeBusinessOverview && <TodaysBusinessOverview />}
      {isNetworkTier && <NetworkOverview />}
      {isRetailer && <RetailerBusinessOverview />}
      {overview}
    </div>
  );
}
