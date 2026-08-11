/**
 * Single source of truth for how long onboarding links stay valid.
 *
 * The number of days is an admin-configurable platform setting
 * (`onboarding.invite_expiry`), so create / reshare / resubmission flows all
 * read it here instead of hardcoding a constant. Changing the setting only
 * affects links generated afterwards — existing invites keep their stored
 * `expiresAt` (expiry is snapshotted at creation time).
 */

import { getSetting } from "@/lib/settings";

/** Configured invite validity in days (defaults to 30 when unset). */
export async function getInviteExpiryDays(): Promise<number> {
  return (await getSetting("onboarding.invite_expiry")).days;
}

/** Compute an `expiresAt` timestamp `days` from `from` (default: now). */
export async function computeInviteExpiry(from: Date = new Date()): Promise<Date> {
  const days = await getInviteExpiryDays();
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
