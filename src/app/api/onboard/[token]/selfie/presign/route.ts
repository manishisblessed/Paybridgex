import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  presignKycSelfiePut,
  kycStorageConfigured,
  isAllowedSelfieContentType,
  KYC_SELFIE_MAX_BYTES,
  type KycSelfieContentType,
} from "@/lib/storage/s3Kyc";
import crypto from "crypto";

const Body = z.object({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
}).strict();

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

function signSelfieToken(inviteId: string, key: string): string {
  const secret = process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("Missing signing secret");
  const exp = Math.floor(Date.now() / 1000) + 120;
  const payload = `selfie:${inviteId}:${key}:${exp}`;
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
    return NextResponse.json({ error: "Storage is not configured" }, { status: 503 });
  }

  const userId = invite.userId ?? `onboard_${invite.id}`;
  const presigned = await presignKycSelfiePut({
    userId,
    contentType: parsed.data.contentType as KycSelfieContentType,
  });
  const uploadToken = signSelfieToken(invite.id, presigned.key);

  return NextResponse.json({
    uploadUrl: presigned.uploadUrl,
    key: presigned.key,
    uploadToken,
    contentType: presigned.contentType,
    expiresInSec: presigned.expiresInSec,
    maxBytes: KYC_SELFIE_MAX_BYTES,
  }, { status: 201 });
}
