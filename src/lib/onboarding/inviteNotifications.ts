/**
 * Shared helper to (re)send an onboarding link over email + SMS. Used by the
 * network (parent-facing) invite actions so the delivery logic isn't
 * re-implemented per route. Email failure is surfaced; SMS is best-effort.
 */

import { env } from "@/lib/env";
import { getPartner } from "@/lib/partners";
import { renderInviteEmail } from "@/lib/email/templates";

export function onboardingLinkFor(token: string): string {
  return `${env.NEXT_PUBLIC_APP_URL}/onboard?token=${token}`;
}

export async function sendInviteLink(
  invite: {
    token: string;
    email: string;
    phone: string;
    role: string;
    name: string | null;
    expiresAt: Date;
  },
  opts: { isReminder?: boolean } = {}
): Promise<{ onboardingLink: string; emailSent: boolean; emailError?: string }> {
  const onboardingLink = onboardingLinkFor(invite.token);
  let emailSent = false;
  let emailError: string | undefined;

  try {
    const emailProvider = getPartner("email");
    const { subject, html } = renderInviteEmail({
      name: invite.name ?? undefined,
      role: invite.role,
      onboardingLink,
      expiresAt: invite.expiresAt,
      isReminder: opts.isReminder,
    });
    const result = await emailProvider.send({
      from: process.env.EMAIL_FROM_INFO || process.env.EMAIL_FROM,
      to: invite.email,
      subject,
      html,
    });
    emailSent = result.ok;
    if (!result.ok) emailError = `${result.code}: ${result.message}`;
  } catch (e) {
    emailError = (e as Error).message;
  }

  try {
    const smsProvider = getPartner("sms");
    await smsProvider.sendTransactional({
      phone: invite.phone,
      templateId: "onboard_invite",
      variables: { link: onboardingLink, role: invite.role.replace(/_/g, " ") },
    });
  } catch {
    // SMS failure shouldn't block the caller.
  }

  return { onboardingLink, emailSent, emailError };
}
