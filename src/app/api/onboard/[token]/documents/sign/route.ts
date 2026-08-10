import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSignedUploadParams } from "@/lib/cloudinary";

const Body = z.object({
  type: z.enum([
    "PAN",
    "AADHAAR_FRONT",
    "AADHAAR_BACK",
    "BANK_PROOF",
    "CANCEL_CHEQUE",
    "PASSBOOK",
    "GST_CERT",
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
    "SELFIE",
  ]),
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

  const uploadParams = getSignedUploadParams({
    userId: `onboard_${invite.id}`,
    type: parsed.data.type,
    isSensitive: true,
  });

  return NextResponse.json(uploadParams);
}
