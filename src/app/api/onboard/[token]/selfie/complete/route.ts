import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { headKycSelfieObject, KYC_SELFIE_MAX_BYTES } from "@/lib/storage/s3Kyc";
import { isResubmitTypeAllowed } from "@/lib/onboarding/resubmission";
import crypto from "crypto";

const Body = z.object({
  key: z.string(),
  uploadToken: z.string(),
  contentType: z.string(),
}).strict();

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

function verifySelfieToken(token: string, inviteId: string, key: string): boolean {
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return false;
  const secret = process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET;
  if (!secret) return false;
  let payload: string;
  try { payload = Buffer.from(b64, "base64").toString(); } catch { return false; }
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const parts = payload.split(":");
  const exp = parseInt(parts[3], 10);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  return parts[0] === "selfie" && parts[1] === inviteId && parts[2] === key;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite) {
    return NextResponse.json({ error: "Invalid invite" }, { status: 404 });
  }

  if (!["PENDING", "REGISTERED", "RESUBMIT"].includes(invite.status)) {
    return NextResponse.json({ error: "Invite is no longer active" }, { status: 400 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!verifySelfieToken(parsed.data.uploadToken, invite.id, parsed.data.key)) {
    return NextResponse.json({ error: "Invalid or expired upload token" }, { status: 403 });
  }

  if (invite.status === "RESUBMIT" && !(await isResubmitTypeAllowed(invite.id, "SELFIE"))) {
    return NextResponse.json(
      { error: "Selfie was not requested for re-upload" },
      { status: 403 }
    );
  }

  const head = await headKycSelfieObject(parsed.data.key);
  if (!head) {
    return NextResponse.json({ error: "Selfie not found in storage" }, { status: 404 });
  }

  if (head.contentLength > KYC_SELFIE_MAX_BYTES) {
    return NextResponse.json({ error: "Selfie file is too large" }, { status: 413 });
  }

  await prisma.verificationResult.create({
    data: {
      inviteId: invite.id,
      userId: invite.userId,
      type: "DOCUMENT_SELFIE",
      orderid: `SELFIE_S3_${Date.now()}_${invite.id.slice(-6)}`,
      status: "Uploaded",
      requestPayload: {
        key: parsed.data.key,
        contentType: parsed.data.contentType,
        sizeBytes: head.contentLength,
        storage: "s3",
      },
    },
  });

  return NextResponse.json({ ok: true });
}
