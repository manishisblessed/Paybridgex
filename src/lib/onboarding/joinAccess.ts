/**
 * Authorization for the Join Requests inbox (public lead capture).
 *
 * Who may view/manage join requests: the platform owner (MASTER_ADMIN) always,
 * plus ADMIN/SUPPORT staff. Scoped admins are gated on the "join-requests" tab
 * (an empty allowedTabs list means full access, mirroring the sidebar).
 */
const STAFF_ROLES = ["MASTER_ADMIN", "ADMIN", "SUPPORT"];

export function canManageJoinRequests(user: {
  role: string;
  allowedTabs?: string[] | null;
}): boolean {
  if (user.role === "MASTER_ADMIN") return true;
  if (!STAFF_ROLES.includes(user.role)) return false;
  const tabs = user.allowedTabs ?? [];
  return tabs.length === 0 || tabs.includes("join-requests");
}
