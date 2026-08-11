import type { InviteStatus, Prisma, Role, UserStatus } from "@prisma/client";

/**
 * Helpers to synthesize a linked `Invite` row for a `User` that was created
 * outside the invite flow (legacy data, bulk import, or the admin
 * "create user" path). The Onboarding Invites page reads exclusively from the
 * `Invite` table, so a user with no invite row is invisible there even though
 * they exist in the Network. Creating a linked invite (Invite.userId = user.id)
 * makes them appear, and — because `Invite.userId` is unique — keeps the
 * mapping strictly one-invite-per-user.
 *
 * Shared by:
 *   - `scripts/backfillInvitesForUsers.ts` (one-time backfill for existing users)
 *   - `POST /api/admin/users` (so directly-created users never drift again)
 */

// Cosmetic/historical only: these invites are synthesized for users who ALREADY
// registered (Invite.userId is set), so the link is never shared or consumed and
// this expiry never gates anything. Live invite validity is the admin-configurable
// `onboarding.invite_expiry` setting (see src/lib/onboarding/inviteExpiry.ts).
export const INVITE_EXPIRY_DAYS = 15;

/**
 * Map a user's account status onto the onboarding invite lifecycle. The invite
 * status reflects the ONBOARDING decision, not the live account state — so an
 * account that finished onboarding (ACTIVE, later SUSPENDED, or CLOSED) is
 * APPROVED, while one still completing KYC is REGISTERED. Note: creating an
 * invite row never mutates the user; only the admin PATCH actions do that.
 */
export function inviteStatusForUser(status: UserStatus): InviteStatus {
  switch (status) {
    case "PENDING_KYC":
      return "REGISTERED";
    case "ACTIVE":
    case "SUSPENDED":
    case "CLOSED":
    default:
      return "APPROVED";
  }
}

export type UserForInvite = {
  id: string;
  email: string;
  phone: string;
  name: string;
  role: Role;
  status: UserStatus;
  parentId: string | null;
  phoneVerifiedAt: Date | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
};

/**
 * Build the `Invite.create` payload for a user. `invitedById` is required by
 * the schema — pass the account's parent (for backfill) or the acting admin
 * (for direct creation). The onboarding timeline is anchored to the user's
 * `createdAt` so the invite reads as historically consistent. The `token`
 * field is intentionally omitted so Prisma generates a fresh unique value.
 */
export function buildInviteDataForUser(
  user: UserForInvite,
  invitedById: string
): Prisma.InviteUncheckedCreateInput {
  const status = inviteStatusForUser(user.status);
  const finished = status === "APPROVED";
  return {
    phone: user.phone,
    email: user.email,
    name: user.name,
    role: user.role,
    parentId: user.parentId,
    invitedById,
    userId: user.id,
    status,
    expiresAt: new Date(user.createdAt.getTime() + INVITE_EXPIRY_DAYS * 86_400_000),
    registeredAt: user.createdAt,
    verifiedAt: finished ? user.createdAt : null,
    approvedAt: finished ? user.createdAt : null,
    phoneVerifiedAt: user.phoneVerifiedAt,
    emailVerifiedAt: user.emailVerifiedAt,
  };
}
