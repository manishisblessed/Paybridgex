import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { isTwilioOtpEnabled, checkVerification } from "@/lib/partners/twilio";

const Body = z.object({
  channel: z.enum(["SMS", "EMAIL"]),
  code: z.string().length(6),
});

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite) {
    return NextResponse.json({ error: "Invalid invite" }, { status: 404 });
  }

  if (!["PENDING", "REGISTERED"].includes(invite.status)) {
    return NextResponse.json(
      { error: "Invite is no longer active" },
      { status: 400 }
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { channel, code } = parsed.data;
  const target = channel === "SMS" ? invite.phone : invite.email;

  if (channel === "SMS" && invite.phoneVerifiedAt) {
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }
  if (channel === "EMAIL" && invite.emailVerifiedAt) {
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }

  // Re-check uniqueness: another user/invite may have registered this
  // phone or email between invite creation and OTP verification.
  const contactField = channel === "SMS" ? "phone" : "email";
  const normalizedTarget = channel === "EMAIL" ? target.toLowerCase() : target;

  const dupUser = await prisma.user.findFirst({
    where: {
      [contactField]: normalizedTarget,
      ...(invite.userId ? { id: { not: invite.userId } } : {}),
    },
    select: { id: true },
  });
  if (dupUser) {
    return NextResponse.json(
      { error: `This ${channel === "SMS" ? "mobile number" : "email"} is already registered with another account` },
      { status: 409 }
    );
  }

  const dupInvite = await prisma.invite.findFirst({
    where: {
      [contactField]: normalizedTarget,
      id: { not: invite.id },
      status: { in: ["PENDING", "REGISTERED", "VERIFIED", "RESUBMIT", "APPROVED"] },
    },
    select: { id: true },
  });
  if (dupInvite) {
    return NextResponse.json(
      { error: `This ${channel === "SMS" ? "mobile number" : "email"} is already used in another onboarding` },
      { status: 409 }
    );
  }

  // Twilio Verify handles SMS verification end-to-end
  if (channel === "SMS" && isTwilioOtpEnabled()) {
    const phone = target.startsWith("+")
      ? target
      : `+91${target.replace(/\D/g, "").slice(-10)}`;

    const r = await checkVerification({ to: phone, code });

    if (!r.ok) {
      return NextResponse.json({ error: r.message ?? "Invalid code" }, { status: 400 });
    }

    await prisma.invite.update({
      where: { id: invite.id },
      data: { phoneVerifiedAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  }

  // Fallback: self-managed OTP verification
  const otp = await prisma.otp.findFirst({
    where: {
      target,
      purpose: "ONBOARD",
      consumed: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!otp) {
    return NextResponse.json(
      { error: "OTP expired or not found. Please request a new one." },
      { status: 400 }
    );
  }

  if (otp.attempts >= 5) {
    return NextResponse.json(
      { error: "Too many attempts. Please request a new OTP." },
      { status: 429 }
    );
  }

  if (otp.codeHash !== sha256(code)) {
    await prisma.otp.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  await prisma.otp.update({
    where: { id: otp.id },
    data: { consumed: true },
  });

  const updateField =
    channel === "SMS"
      ? { phoneVerifiedAt: new Date() }
      : { emailVerifiedAt: new Date() };

  await prisma.invite.update({
    where: { id: invite.id },
    data: updateField,
  });

  return NextResponse.json({ ok: true });
}
