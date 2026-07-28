/**
 * Role hierarchy — the single source of truth for role ordering, onboarding
 * permissions, and default child roles in the network tree.
 *
 * Network roles: RETAILER < DISTRIBUTOR < MASTER_DISTRIBUTOR < SUPER_DISTRIBUTOR
 * Staff roles:   SUPPORT < ADMIN < MASTER_ADMIN
 *
 * Network roles onboard their immediate subordinate by default.
 * MASTER_ADMIN can create any network role.
 * ADMIN can only create SUPER_DISTRIBUTOR.
 */

export type DbRole =
  | "RETAILER"
  | "DISTRIBUTOR"
  | "MASTER_DISTRIBUTOR"
  | "SUPER_DISTRIBUTOR"
  | "ADMIN"
  | "SUPPORT"
  | "MASTER_ADMIN";

/** Numeric rank — higher number = more authority. */
export const ROLE_RANK: Record<DbRole, number> = {
  RETAILER: 10,
  DISTRIBUTOR: 20,
  MASTER_DISTRIBUTOR: 30,
  SUPER_DISTRIBUTOR: 40,
  SUPPORT: 50,
  ADMIN: 60,
  MASTER_ADMIN: 70,
};

/** Ordered network tiers from lowest to highest. */
export const NETWORK_TIERS: DbRole[] = [
  "RETAILER",
  "DISTRIBUTOR",
  "MASTER_DISTRIBUTOR",
  "SUPER_DISTRIBUTOR",
];

/**
 * Kebab-case display slugs for the four network roles. These match the `role`
 * query param accepted by `GET /api/admin/users` and the display role returned
 * by that endpoint.
 */
export type NetworkRoleSlug =
  | "retailer"
  | "distributor"
  | "master-distributor"
  | "super-distributor";

/** Role filter value used by the shared user picker (`all` = every tier). */
export type RoleTabValue = "all" | NetworkRoleSlug;

/**
 * Role filter tabs for user pickers — the single source of truth for the
 * "select a role, then pick a user" UX used across the app (POS terminal
 * assignment, scheme assignment, POS rental, etc.). `value` maps directly to
 * the `/api/admin/users` `role` param.
 */
export const ROLE_TABS: readonly { value: RoleTabValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: "super-distributor", label: "SD" },
  { value: "master-distributor", label: "MD" },
  { value: "distributor", label: "DT" },
  { value: "retailer", label: "RT" },
] as const;

/** Short badge label (RT/DT/MD/SD) for a kebab-case display role. */
export const ROLE_SHORT_LABEL: Record<string, string> = {
  retailer: "RT",
  distributor: "DT",
  "master-distributor": "MD",
  "super-distributor": "SD",
};

/** Staff/admin roles (not part of the onboarding chain). */
export const STAFF_ROLES: DbRole[] = ["SUPPORT", "ADMIN", "MASTER_ADMIN"];

/** Roles that can perform onboarding (network + staff-creators). */
export const ONBOARD_CAPABLE_ROLES: DbRole[] = [
  "DISTRIBUTOR",
  "MASTER_DISTRIBUTOR",
  "SUPER_DISTRIBUTOR",
  "ADMIN",
  "MASTER_ADMIN",
];

/**
 * Can `creatorRole` onboard a user with `targetRole`?
 *
 * - MASTER_ADMIN can create ANY network role.
 * - ADMIN can ONLY create SUPER_DISTRIBUTOR.
 * - SUPER_DISTRIBUTOR can ONLY create MASTER_DISTRIBUTOR.
 * - MASTER_DISTRIBUTOR can ONLY create DISTRIBUTOR.
 * - DISTRIBUTOR can ONLY create RETAILER.
 */
export function canOnboard(creatorRole: string, targetRole: string): boolean {
  const cRank = ROLE_RANK[creatorRole as DbRole];
  const tRank = ROLE_RANK[targetRole as DbRole];
  if (cRank === undefined || tRank === undefined) return false;

  if (creatorRole === "MASTER_ADMIN") {
    return NETWORK_TIERS.includes(targetRole as DbRole);
  }

  if (creatorRole === "ADMIN") {
    return targetRole === "SUPER_DISTRIBUTOR";
  }

  const cIdx = NETWORK_TIERS.indexOf(creatorRole as DbRole);
  const tIdx = NETWORK_TIERS.indexOf(targetRole as DbRole);
  return cIdx > 0 && tIdx >= 0 && cIdx === tIdx + 1;
}

/**
 * Returns the list of network roles that `creatorRole` is allowed to invite.
 * Used by the frontend to populate the role dropdown dynamically.
 */
export function allowedInviteRoles(creatorRole: string): DbRole[] {
  if (creatorRole === "MASTER_ADMIN") {
    return [...NETWORK_TIERS].reverse();
  }
  if (creatorRole === "ADMIN") {
    return ["SUPER_DISTRIBUTOR"];
  }
  const child = defaultChildRole(creatorRole);
  return child ? [child] : [];
}

/**
 * Default child role when a creator doesn't specify one explicitly.
 * Each role defaults to their immediate subordinate.
 */
export function defaultChildRole(creatorRole: string): DbRole {
  switch (creatorRole) {
    case "MASTER_ADMIN":
    case "ADMIN":
      return "SUPER_DISTRIBUTOR";
    case "SUPER_DISTRIBUTOR":
      return "MASTER_DISTRIBUTOR";
    case "MASTER_DISTRIBUTOR":
      return "DISTRIBUTOR";
    case "DISTRIBUTOR":
      return "RETAILER";
    default:
      return "RETAILER";
  }
}

/** Whether a role is a staff/admin role (not a network role). */
export function isStaffRole(role: string): boolean {
  return STAFF_ROLES.includes(role as DbRole);
}

/**
 * Returns the role that must serve as the parent for a given network role.
 * e.g. RETAILER → DISTRIBUTOR, DISTRIBUTOR → MASTER_DISTRIBUTOR, etc.
 * Returns null for SUPER_DISTRIBUTOR (top of network tree, no required parent).
 */
export function getParentRole(role: string): DbRole | null {
  const idx = NETWORK_TIERS.indexOf(role as DbRole);
  if (idx < 0 || idx >= NETWORK_TIERS.length - 1) return null;
  return NETWORK_TIERS[idx + 1];
}

/* ---------- Upline chain resolution (RT → DT → MD → SD) ---------- */

/** A single ancestor node in a user's upline chain. */
export type UplineNode = {
  id: string;
  name: string;
  role: DbRole;
  userCode: string | null;
  shopName: string | null;
};

/** Fields selected for each node when resolving an upline chain. */
const uplineSelect = {
  id: true,
  name: true,
  role: true,
  userCode: true,
  shopName: true,
} as const;

/**
 * Nested self-relation include covering the full network depth
 * (RETAILER → DISTRIBUTOR → MASTER_DISTRIBUTOR → SUPER_DISTRIBUTOR).
 * The tree is at most 4 tiers deep, so a fixed nesting avoids recursion.
 * Spread this into a Prisma `select` on the User model.
 */
export const uplineInclude = {
  parent: {
    select: {
      ...uplineSelect,
      parent: {
        select: {
          ...uplineSelect,
          parent: {
            select: {
              ...uplineSelect,
              parent: { select: uplineSelect },
            },
          },
        },
      },
    },
  },
} as const;

type LoadedParent = {
  id: string;
  name: string;
  role: string;
  userCode?: string | null;
  shopName?: string | null;
  parent?: LoadedParent | null;
} | null;

/**
 * Flatten a loaded user's ancestors into an ordered upline chain, nearest
 * parent first. e.g. a retailer resolves to [DT, MD, SD].
 */
export function flattenUpline(user: { parent?: LoadedParent } | null): UplineNode[] {
  const out: UplineNode[] = [];
  let cur = user?.parent ?? null;
  while (cur) {
    out.push({
      id: cur.id,
      name: cur.name,
      role: cur.role as DbRole,
      userCode: cur.userCode ?? null,
      shopName: cur.shopName ?? null,
    });
    cur = cur.parent ?? null;
  }
  return out;
}
