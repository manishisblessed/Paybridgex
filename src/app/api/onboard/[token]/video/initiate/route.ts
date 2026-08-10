import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  presignKycVideoPut,
  kycStorageConfigured,
  isAllowedVideoContentType,
  KYC_VIDEO_MAX_BYTES,
  KYC_VIDEO_MAX_DURATION_SEC,
  type KycVideoContentType,
} from "@/lib/storage/s3Kyc";
import crypto from "crypto";

const Body = z.object({
  consent: z.literal(true),
  contentType: z.enum(["video/mp4", "video/webm"]),
}).strict();

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

function signUploadToken(inviteId: string, key: string): string {
  const secret = process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("Missing signing secret");
  const exp = Math.floor(Date.now() / 1000) + 120;
  const payload = `onboard:${inviteId}:${key}:${exp}`;
  const b64 = Buffer.from(payload).toString("base64");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${b64}.${sig}`;
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

  if (new Date() > invite.expiresAt) {
    return NextResponse.json({ error: "Invite has expired" }, { status: 400 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!kycStorageConfigured()) {
    return NextResponse.json({ error: "Video storage is not configured" }, { status: 503 });
  }

  if (!isAllowedVideoContentType(parsed.data.contentType)) {
    return NextResponse.json({ error: "Unsupported video format" }, { status: 400 });
  }

  const userId = invite.userId ?? `onboard_${invite.id}`;
  const presigned = await presignKycVideoPut({
    userId,
    contentType: parsed.data.contentType as KycVideoContentType,
  });
  const uploadToken = signUploadToken(invite.id, presigned.key);

  // Server-issued liveness challenge: a random 4-digit code the user must read
  // aloud on camera. Recording the spoken code deters replay/spoof attacks.
  const challengeCode = String(Math.floor(1000 + Math.random() * 9000));
  const prompt = `Read this number aloud: ${challengeCode}`;

  return NextResponse.json({
    uploadUrl: presigned.uploadUrl,
    key: presigned.key,
    uploadToken,
    contentType: presigned.contentType,
    prompt,
    challengeCode,
    expiresInSec: presigned.expiresInSec,
    maxBytes: KYC_VIDEO_MAX_BYTES,
    maxDurationSec: KYC_VIDEO_MAX_DURATION_SEC,
  }, { status: 201 });
}
