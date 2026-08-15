import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { getPartner } from "@/lib/partners";
import { isTwilioOtpEnabled, sendVerification } from "@/lib/partners/twilio";

const Body = z.object({
  channel: z.enum(["SMS", "EMAIL"]),
});

function generate6() {
  return String(100000 + crypto.randomInt(0, 900000));
}

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

  if (new Date() > invite.expiresAt) {
    return NextResponse.json({ error: "Invite has expired" }, { status: 400 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { channel } = parsed.data;
  const target = channel === "SMS" ? invite.phone : invite.email;

  if (channel === "SMS" && invite.phoneVerifiedAt) {
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }
  if (channel === "EMAIL" && invite.emailVerifiedAt) {
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }

  // Twilio Verify handles SMS OTPs end-to-end
  if (channel === "SMS" && isTwilioOtpEnabled()) {
    const phone = target.startsWith("+")
      ? target
      : `+91${target.replace(/\D/g, "").slice(-10)}`;

    const r = await sendVerification({ to: phone, channel: "sms" });
    if (!r.ok) {
      return NextResponse.json({ error: r.message }, { status: 502 });
    }
    return NextResponse.json({ ok: true, provider: "twilio" });
  }

  // Fallback: self-managed OTP (MSG91 for SMS, Resend for email)
  const otp = generate6();
  const codeHash = sha256(otp);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await prisma.otp.create({
    data: { channel, target, codeHash, purpose: "ONBOARD", expiresAt },
  });

  if (channel === "SMS") {
    const sms = getPartner("sms");
    const r = await sms.sendOtp({ phone: target, otp });
    if (!r.ok) {
      return NextResponse.json({ error: r.message }, { status: 502 });
    }
  } else {
    const email = getPartner("email");
    const r = await email.send({
      to: target,
      // Code in the subject: visible in the inbox preview and prevents Gmail
      // from collapsing repeated OTP mails into one stale-looking thread.
      subject: `${otp} is your Paybridgex verification code`,
      text: `Your Paybridgex verification code is ${otp}. It expires in 5 minutes. Do not share it with anyone.`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
          <h2 style="color:#1e293b;">Verify Your Email</h2>
          <p>Your verification code for Paybridgex onboarding is:</p>
          <div style="background:#f1f5f9;border-radius:8px;padding:16px;text-align:center;margin:16px 0;">
            <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#1b45ea;">${otp}</span>
          </div>
          <p style="color:#64748b;font-size:14px;">This code expires in 5 minutes. Do not share it with anyone.</p>
        </div>
      `,
    });
    if (!r.ok) {
      return NextResponse.json({ error: r.message }, { status: 502 });
    }
  }

  return NextResponse.json({ ok: true, expiresAt });
}
