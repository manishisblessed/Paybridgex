import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { deleteFromCloudinary } from "@/lib/cloudinary";
import { isResubmitTypeAllowed } from "@/lib/onboarding/resubmission";

const DOCUMENT_TYPES = [
  "PAN",
  "AADHAAR_FRONT",
  "AADHAAR_BACK",
  "SHOP_PHOTO",
  "BANK_PROOF",
  "CANCEL_CHEQUE",
  "PASSBOOK",
  "GST_CERT",
  "SELFIE",
  "LIVE_VIDEO",
  "SHOP_ESTABLISHMENT",
  "GUMASTA_LICENSE",
  "SIGNATURE",
  "ELECTRICITY_BILL",
  "ADDITIONAL_ID",
  "FAMILY_REFERENCE",
  "PG_FORM",
  "GPS_PHOTO_OUTSIDE",
  "GPS_PHOTO_INSIDE",
  "GPS_SELFIE_DISTRIBUTOR",
  "DISTRIBUTOR_DECLARATION",
  "SELF_DECLARATION",
  "SUCCESSOR_DECLARATION",
  "OTHER",
] as const;

const Body = z.object({
  type: z.enum(DOCUMENT_TYPES),
  publicId: z.string(),
  url: z.string().url(),
  resourceType: z.string().default("image"),
  format: z.string().optional(),
  bytes: z.number().int().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  gpsLatitude: z.number().optional(),
  gpsLongitude: z.number().optional(),
  /** Accuracy radius in meters of the live browser geolocation fix. */
  gpsAccuracy: z.number().optional(),
  /** ISO timestamp of when the location fix was taken (shutter press). */
  gpsCapturedAt: z.string().datetime().optional(),
  /** "browser" = live fix at capture time, "exif" = embedded photo metadata. */
  gpsSource: z.enum(["browser", "exif"]).optional(),
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

  if (!["PENDING", "REGISTERED", "RESUBMIT"].includes(invite.status)) {
    return NextResponse.json(
      { error: "Invite is no longer active" },
      { status: 400 }
    );
  }

  if (new Date() > invite.expiresAt) {
    return NextResponse.json({ error: "Invite has expired" }, { status: 400 });
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // During a targeted re-upload, only the documents an admin flagged may be
  // replaced — everything else is locked.
  if (
    invite.status === "RESUBMIT" &&
    !(await isResubmitTypeAllowed(invite.id, parsed.data.type))
  ) {
    return NextResponse.json(
      { error: "This document was not requested for re-upload" },
      { status: 403 }
    );
  }

  const doc = await prisma.verificationResult.create({
    data: {
      inviteId: invite.id,
      userId: invite.userId,
      type: `DOCUMENT_${parsed.data.type}`,
      orderid: `DOC_${Date.now()}_${parsed.data.type}`,
      status: "Uploaded",
      requestPayload: {
        publicId: parsed.data.publicId,
        url: parsed.data.url,
        resourceType: parsed.data.resourceType,
        format: parsed.data.format,
        bytes: parsed.data.bytes,
        width: parsed.data.width,
        height: parsed.data.height,
        gpsLatitude: parsed.data.gpsLatitude,
        gpsLongitude: parsed.data.gpsLongitude,
        gpsAccuracy: parsed.data.gpsAccuracy,
        gpsCapturedAt: parsed.data.gpsCapturedAt,
        gpsSource: parsed.data.gpsSource,
        // Server-observed capture context (not client-supplied).
        uploadIp: clientIp(req),
        uploadUserAgent: req.headers.get("user-agent") ?? undefined,
      },
    },
  });

  return NextResponse.json({ ok: true, id: doc.id });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite) {
    return NextResponse.json({ error: "Invalid invite" }, { status: 404 });
  }

  const docs = await prisma.verificationResult.findMany({
    where: {
      inviteId: invite.id,
      type: { startsWith: "DOCUMENT_" },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    documents: docs.map((d) => ({
      id: d.id,
      type: d.type.replace("DOCUMENT_", ""),
      ...(d.requestPayload as Record<string, unknown>),
      createdAt: d.createdAt.toISOString(),
    })),
  });
}

/**
 * Remove an uploaded document so the applicant can re-upload the correct
 * file. Only allowed while the invite is still in progress.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite) {
    return NextResponse.json({ error: "Invalid invite" }, { status: 404 });
  }

  if (!["PENDING", "REGISTERED", "RESUBMIT"].includes(invite.status)) {
    return NextResponse.json(
      { error: "Invite is no longer active" },
      { status: 400 }
    );
  }

  const type = new URL(req.url).searchParams.get("type");
  const parsed = z.enum(DOCUMENT_TYPES).safeParse(type);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid document type" }, { status: 400 });
  }

  const docs = await prisma.verificationResult.findMany({
    where: { inviteId: invite.id, type: `DOCUMENT_${parsed.data}` },
  });
  if (docs.length === 0) {
    return NextResponse.json({ ok: true, removed: 0 });
  }

  // Best effort: also destroy the underlying Cloudinary assets.
  for (const doc of docs) {
    const payload = doc.requestPayload as Record<string, unknown> | null;
    const publicId = payload?.publicId;
    if (typeof publicId === "string" && publicId) {
      try {
        await deleteFromCloudinary(publicId, { isSensitive: true });
      } catch {
        // Ignore — the DB record removal is what matters for the flow.
      }
    }
  }

  const result = await prisma.verificationResult.deleteMany({
    where: { inviteId: invite.id, type: `DOCUMENT_${parsed.data}` },
  });

  return NextResponse.json({ ok: true, removed: result.count });
}
