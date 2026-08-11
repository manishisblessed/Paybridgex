import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getPartner } from "@/lib/partners";
import { env } from "@/lib/env";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertCaptcha } from "@/lib/security/captcha";
import { logSecurityEvent, clientIp } from "@/lib/security/audit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { renderJoinRequestEmail } from "@/lib/email/templates";

/**
 * Public "Join Form" submission. This REPLACES self-serve account creation on
 * the marketing site — it does NOT create a User or any credentials. It records
 * a lead the support team reviews and converts into an onboarding Invite.
 */
const Body = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s]{10,15}$/, "Enter a valid mobile number"),
  email: z.string().trim().email().max(160),
  shopName: z.string().trim().max(160).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  role: z
    .enum(["RETAILER", "DISTRIBUTOR", "MASTER_DISTRIBUTOR", "SUPER_DISTRIBUTOR"])
    .default("RETAILER"),
  message: z.string().trim().max(1000).optional(),
  captchaToken: z.string().max(4000).optional(),
});

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ip = clientIp(req);
  const userAgent = req.headers.get("user-agent") || "unknown";

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    // Throttle submissions per IP and gate bots — same posture as /register was.
    await enforceRateLimit(`join:ip:${ip}`, RATE_LIMITS.join);
    await assertCaptcha(parsed.data.captchaToken, ip);
  } catch (e) {
    return toErrorResponse(e);
  }

  const { name, phone, email, shopName, city, state, role, message } = parsed.data;
  const normalizedEmail = email.toLowerCase();
  const normalizedPhone = phone.replace(/[\s-]/g, "");

  // De-dupe: if the same person already has an OPEN request (NEW/CONTACTED),
  // refresh that lead instead of stacking duplicates. Closed/rejected/invited
  // leads are left intact and a fresh request is created.
  const existingOpen = await prisma.joinRequest.findFirst({
    where: {
      status: { in: ["NEW", "CONTACTED"] },
      OR: [{ email: normalizedEmail }, { phone: normalizedPhone }],
    },
    orderBy: { createdAt: "desc" },
  });

  const joinRequest = existingOpen
    ? await prisma.joinRequest.update({
        where: { id: existingOpen.id },
        data: {
          name,
          phone: normalizedPhone,
          email: normalizedEmail,
          shopName: shopName || null,
          city: city || null,
          state: state || null,
          role,
          message: message || null,
          ip,
          userAgent,
        },
      })
    : await prisma.joinRequest.create({
        data: {
          name,
          phone: normalizedPhone,
          email: normalizedEmail,
          shopName: shopName || null,
          city: city || null,
          state: state || null,
          role,
          message: message || null,
          ip,
          userAgent,
        },
      });

  await logSecurityEvent({
    action: "join.request",
    severity: "info",
    entity: "JoinRequest",
    entityId: joinRequest.id,
    ip,
    userAgent,
    meta: { role, reused: Boolean(existingOpen) },
  });

  // Notify the platform's support/ops team (in-app + email). Best-effort:
  // notification failures must never block a prospect's submission.
  try {
    const staff = await prisma.user.findMany({
      where: {
        role: { in: ["MASTER_ADMIN", "ADMIN", "SUPPORT"] },
        status: "ACTIVE",
        deletedAt: null,
      },
      select: { id: true },
    });

    if (staff.length) {
      await prisma.notification.createMany({
        data: staff.map((s) => ({
          userId: s.id,
          title: "New join request",
          body: `${name} (${role.replace(/_/g, " ")}) submitted the Join Form. Phone: ${normalizedPhone}, Email: ${normalizedEmail}${shopName ? `, Shop: ${shopName}` : ""}.`,
          channel: "INAPP",
        })),
      });
    }
  } catch {
    // Non-blocking — the lead is still recorded.
  }

  try {
    const supportInbox =
      process.env.SUPPORT_INBOX_EMAIL ||
      process.env.EMAIL_FROM_INFO ||
      process.env.EMAIL_FROM;
    if (supportInbox) {
      const reviewLink = `${env.NEXT_PUBLIC_APP_URL}/dashboard/admin/join-requests`;
      const { subject, html } = renderJoinRequestEmail({
        name,
        phone: normalizedPhone,
        email: normalizedEmail,
        role,
        shopName,
        city,
        state,
        message,
        reviewLink,
      });
      const emailProvider = getPartner("email");
      await emailProvider.send({
        from: process.env.EMAIL_FROM_INFO || process.env.EMAIL_FROM,
        to: supportInbox,
        subject,
        html,
      });
    }
  } catch {
    // Email failure shouldn't block the submission.
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
