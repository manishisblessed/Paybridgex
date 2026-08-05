"use client";

import { useSession, signOut } from "next-auth/react";
import { toDisplayRole, type RoleDisplay } from "./auth";

/**
 * Legacy session shape that existing dashboard components expect.
 * This bridges NextAuth's session format to what the UI already uses.
 */
export type LegacySession = {
  name: string;
  email: string;
  phone: string;
  role: RoleDisplay;
  walletBalance: number;
  monthlyTurnover?: number;
  loggedInAt: number;
  mustChangePassword?: boolean;
  userCode?: string;
  allowedTabs: string[];
};

/**
 * Drop-in replacement for the old getSession() pattern.
 * Components can use:
 *   const { session, loading } = useAuth();
 * instead of:
 *   const [session, setSession] = useState(null);
 *   useEffect(() => setSession(getSession()), []);
 */
export function useAuth() {
  const { data, status } = useSession();

  if (status === "loading" || !data?.user) {
    return { session: null, loading: status === "loading", signOut };
  }

  const user = data.user;
  const legacySession: LegacySession = {
    name: user.name ?? "",
    email: user.email ?? "",
    phone: (user as any).phone ?? "",
    role: toDisplayRole((user as any).role ?? "RETAILER"),
    walletBalance: (user as any).walletBalance ?? 0,
    loggedInAt: Date.now(),
    userCode: (user as any).userCode ?? undefined,
    allowedTabs: (user as any).allowedTabs ?? [],
  };

  return { session: legacySession, loading: false, signOut };
}
