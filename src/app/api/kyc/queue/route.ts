import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const pageSize = Math.min(50, Math.max(10, Number(searchParams.get("pageSize") ?? 25)));
  const statusFilter = searchParams.get("status");

  const where =
    statusFilter && ["PENDING_REVIEW", "APPROVED", "REJECTED"].includes(statusFilter)
      ? { status: statusFilter as "PENDING_REVIEW" | "APPROVED" | "REJECTED" }
      : undefined;

  const [total, kycs, pendingCount, approvedCount, rejectedCount] = await Promise.all([
    prisma.kyc.count({ where }),
    prisma.kyc.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            userCode: true,
            name: true,
            email: true,
            phone: true,
            role: true,
            status: true,
            shopName: true,
            shopAddress: true,
            city: true,
            state: true,
            pincode: true,
            documents: {
              select: {
                id: true,
                type: true,
                publicId: true,
                url: true,
                format: true,
                resourceType: true,
                uploadedAt: true,
              },
              orderBy: { uploadedAt: "desc" as const },
            },
          },
        },
      },
      orderBy: [
        { status: "asc" as const },
        { submittedAt: "desc" as const },
      ],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.kyc.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.kyc.count({ where: { status: "APPROVED" } }),
    prisma.kyc.count({ where: { status: "REJECTED" } }),
  ]);

  const userIds = kycs.map((k) => k.userId);

  // Onboarding verifications are created against the invite; their userId is
  // only backfilled at registration. Legacy/edge records can therefore still
  // have userId = null while remaining linked to an invite that IS owned by the
  // user. Resolve verifications by userId OR the user's invite id so the admin
  // always sees the applicant's PAN/bank/document data — not just the rows
  // where the userId backfill happened to run.
  const invites = await prisma.invite.findMany({
    where: { userId: { in: userIds } },
    select: { id: true, userId: true },
  });
  const inviteToUser = new Map<string, string>();
  for (const inv of invites) {
    if (inv.userId) inviteToUser.set(inv.id, inv.userId);
  }
  const inviteIds = invites.map((i) => i.id);

  const verificationResults = await prisma.verificationResult.findMany({
    where: {
      OR: [{ userId: { in: userIds } }, { inviteId: { in: inviteIds } }],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      userId: true,
      inviteId: true,
      type: true,
      status: true,
      verifiedName: true,
      requestPayload: true,
      responsePayload: true,
      createdAt: true,
    },
  });

  type VR = (typeof verificationResults)[number];
  const verificationsByUser = new Map<string, VR[]>();
  for (const v of verificationResults) {
    const owner =
      v.userId ?? (v.inviteId ? inviteToUser.get(v.inviteId) ?? null : null);
    if (!owner) continue;
    const list = verificationsByUser.get(owner) ?? [];
    list.push(v);
    verificationsByUser.set(owner, list);
  }

  return NextResponse.json({
    page,
    pageSize,
    total,
    kycs: kycs.map((k) => {
      const vResults = verificationsByUser.get(k.userId) ?? [];
      // The onboarding liveness video (ONBOARD_VIDEO) is a viewable artifact,
      // not a pass/fail check — surface it alongside the uploaded documents
      // rather than in the KYC verification results.
      const kycVerifications = vResults.filter(
        (v) => !v.type.startsWith("DOCUMENT_") && v.type !== "ONBOARD_VIDEO"
      );
      const onboardDocs = vResults.filter(
        (v) => v.type.startsWith("DOCUMENT_") || v.type === "ONBOARD_VIDEO"
      );

      // Source-of-truth fallbacks: when the Kyc row is missing a field, pull it
      // from the corresponding verification payload so the admin always sees the
      // complete, verified data.
      const find = (type: string) =>
        kycVerifications.find((v) => v.type === type && v.status === "Success");
      const panV = find("PAN_360");
      const bankV = find("BANK_PENNY_DROP") ?? find("BANK_ADVANCE");
      const gstV = find("GST");
      const aadhaarV = find("AADHAAR_DIGILOCKER");

      const panReq = (panV?.requestPayload ?? {}) as any;
      const panRes = (panV?.responsePayload ?? {}) as any;
      const bankReq = (bankV?.requestPayload ?? {}) as any;
      const bankRes = (bankV?.responsePayload ?? {}) as any;
      const gstReq = (gstV?.requestPayload ?? {}) as any;
      const gstRes = (gstV?.responsePayload ?? {}) as any;
      const aadRes = (aadhaarV?.responsePayload ?? {}) as any;

      const panNumber = k.panNumber ?? panReq.pan ?? panRes.pan ?? null;
      const panName = k.panName ?? panV?.verifiedName ?? panRes.registered_name ?? null;
      const bankAccountNumber =
        k.bankAccountNumber ?? bankReq.account_number ?? null;
      const bankIfsc = k.bankIfsc ?? bankReq.ifsc ?? null;
      const bankAccountName = k.bankAccountName ?? bankV?.verifiedName ?? bankRes.nameAtBank ?? null;
      const bankAccountStatus =
        k.bankAccountStatus ?? bankRes.account_status ?? bankRes.accountStatus ?? null;
      const gstin = k.gstin ?? gstReq.gst ?? null;

      const aadhaarName = k.aadhaarName ?? aadhaarV?.verifiedName ?? aadRes.name ?? null;
      const aadhaarNumber = k.aadhaarNumber ?? (aadRes.uid ? `XXXX-XXXX-${String(aadRes.uid).slice(-4)}` : null);
      const aadhaarLast4 = k.aadhaarLast4 ?? (aadRes.uid ? String(aadRes.uid).slice(-4) : null);
      const aadhaarDob = k.aadhaarDob ?? aadRes.dob ?? null;
      const aadhaarGender = k.aadhaarGender ?? aadRes.gender ?? null;
      const aadhaarAddress = k.aadhaarAddress ?? aadRes.address ?? null;
      const aadhaarMobile = k.aadhaarMobile ?? aadRes.aadhaarMobile ?? null;

      return {
        id: k.id,
        status: k.status,
        panNumber,
        panName,
        panVerifiedAt: k.panVerifiedAt?.toISOString() ?? (panV ? panV.createdAt.toISOString() : null),
        aadhaarLast4,
        aadhaarNumber,
        aadhaarName,
        aadhaarDob,
        aadhaarGender,
        aadhaarAddress,
        aadhaarMobile,
        aadhaarVerifiedAt: k.aadhaarVerifiedAt?.toISOString() ?? (aadhaarV ? aadhaarV.createdAt.toISOString() : null),
        bankAccountName,
        bankAccountNumber,
        bankIfsc,
        bankAccountStatus,
        bankVerifiedAt: bankV ? bankV.createdAt.toISOString() : null,
        gstin,
        gstVerified: !!gstV,
        gstLegalName: gstRes.legal_name_of_business ?? gstRes.legal_name ?? null,
        gstTradeName: gstRes.trade_name_of_business ?? gstRes.trade_name ?? null,
        msmeNumber: k.msmeNumber,
        nameMismatch: k.nameMismatch,
        nameDeclarationAccepted: k.nameDeclarationAccepted,
        nameDeclarationAt: k.nameDeclarationAt?.toISOString() ?? null,
        dob: k.dob?.toISOString() ?? null,
        rejectedReason: k.rejectedReason,
        submittedAt: k.submittedAt?.toISOString() ?? null,
        reviewedAt: k.reviewedAt?.toISOString() ?? null,
        user: {
          id: k.user.id,
          userCode: k.user.userCode,
          name: k.user.name,
          email: k.user.email,
          phone: k.user.phone,
          role: k.user.role,
          status: k.user.status,
          shopName: k.user.shopName,
          shopAddress: k.user.shopAddress,
          city: k.user.city,
          state: k.user.state,
          pincode: k.user.pincode,
        },
        documents: k.user.documents.map((d) => ({
          id: d.id,
          type: d.type,
          publicId: d.publicId,
          url: d.url,
          format: d.format,
          resourceType: d.resourceType,
          uploadedAt: d.uploadedAt.toISOString(),
        })),
        verifications: kycVerifications.map((v) => ({
          id: v.id,
          type: v.type,
          status: v.status,
          verifiedName: v.verifiedName,
          responsePayload: v.responsePayload,
          createdAt: v.createdAt.toISOString(),
        })),
        onboardingDocs: onboardDocs.map((v) => {
          const payload = (v.requestPayload ?? {}) as Record<string, unknown>;
          const isVideo = v.type === "ONBOARD_VIDEO";
          const contentType = (payload.contentType as string) ?? "";
          // S3-stored assets (biometric selfies, onboarding liveness videos)
          // have no direct/public URL, so route their preview through the
          // signed document endpoint.
          const key =
            typeof payload.key === "string" ? (payload.key as string) : null;
          const isS3 =
            payload.storage === "s3" ||
            (!!key && /^kyc-(videos|selfies)\//.test(key));
          return {
            id: v.id,
            type: v.type.replace("DOCUMENT_", ""),
            originalType: v.type,
            status: v.status,
            url:
              (payload.url as string) ??
              (isS3 ? `/api/kyc/document/${v.id}` : null),
            format:
              (payload.format as string) ??
              (isVideo ? contentType.split("/")[1] ?? "mp4" : null),
            publicId: (payload.publicId as string) ?? null,
            resourceType:
              (payload.resourceType as string) ?? (isVideo ? "video" : "image"),
            gpsLatitude: (payload.gpsLatitude as number) ?? null,
            gpsLongitude: (payload.gpsLongitude as number) ?? null,
            createdAt: v.createdAt.toISOString(),
          };
        }),
      };
    }),
    stats: {
      pending: pendingCount,
      approved: approvedCount,
      rejected: rejectedCount,
    },
  });
}
