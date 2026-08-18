/**
 * Shared assembly of a single KYC application's review payload.
 *
 * The admin KYC queue and the parent-facing network KYC endpoint must show the
 * exact same picture (personal/business details, PAN/Aadhaar/bank/GST results,
 * uploaded documents and onboarding artifacts). Keeping the assembly in one
 * place guarantees parity and avoids the two views drifting apart.
 */

/** A `Kyc` row with its owning user + directly-uploaded documents. */
export interface KycDetailKyc {
  id: string;
  status: string;
  userId: string;
  panNumber: string | null;
  panName: string | null;
  panVerifiedAt: Date | null;
  aadhaarLast4: string | null;
  aadhaarNumber: string | null;
  aadhaarName: string | null;
  aadhaarDob: string | null;
  aadhaarGender: string | null;
  aadhaarAddress: string | null;
  aadhaarMobile: string | null;
  aadhaarVerifiedAt: Date | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  bankAccountStatus: string | null;
  gstin: string | null;
  msmeNumber: string | null;
  nameMismatch: boolean;
  nameDeclarationAccepted: boolean;
  nameDeclarationAt: Date | null;
  dob: Date | null;
  rejectedReason: string | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  user: {
    id: string;
    userCode: string | null;
    name: string;
    email: string;
    phone: string;
    role: string;
    status: string;
    shopName: string | null;
    shopAddress: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    documents: Array<{
      id: string;
      type: string;
      publicId: string | null;
      url: string | null;
      format: string | null;
      resourceType: string | null;
      uploadedAt: Date;
    }>;
  };
}

/** A `VerificationResult` row belonging to the KYC's user or their invite. */
export interface KycDetailVerification {
  id: string;
  userId: string | null;
  inviteId: string | null;
  type: string;
  status: string;
  verifiedName: string | null;
  requestPayload: unknown;
  responsePayload: unknown;
  createdAt: Date;
}

/** Prisma `include` for loading a `Kyc` with everything the assembly needs. */
export const kycDetailInclude = {
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
} as const;

/** Prisma `select` for the verification rows the assembly consumes. */
export const kycDetailVerificationSelect = {
  id: true,
  userId: true,
  inviteId: true,
  type: true,
  status: true,
  verifiedName: true,
  requestPayload: true,
  responsePayload: true,
  createdAt: true,
} as const;

/**
 * Build the review payload for one KYC application from its row and the
 * applicant's verification results. `vResults` should already be scoped to the
 * KYC's user (by userId or the user's invite ids).
 */
export function buildKycDetail(k: KycDetailKyc, vResults: KycDetailVerification[]) {
  // The onboarding liveness video (ONBOARD_VIDEO) is a viewable artifact, not a
  // pass/fail check — surface it alongside the uploaded documents rather than
  // in the KYC verification results.
  const kycVerifications = vResults.filter(
    (v) => !v.type.startsWith("DOCUMENT_") && v.type !== "ONBOARD_VIDEO"
  );
  const onboardDocs = vResults.filter(
    (v) => v.type.startsWith("DOCUMENT_") || v.type === "ONBOARD_VIDEO"
  );

  // Source-of-truth fallbacks: when the Kyc row is missing a field, pull it
  // from the corresponding verification payload so the reviewer always sees the
  // complete, verified data.
  const find = (type: string) =>
    kycVerifications.find((v) => v.type === type && v.status === "Success");
  const panV = find("PAN_360");
  const bankV = find("BANK_PENNY_DROP") ?? find("BANK_ADVANCE");
  const gstV = find("GST");
  const aadhaarV = find("AADHAAR_DIGILOCKER");

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const panReq = (panV?.requestPayload ?? {}) as any;
  const panRes = (panV?.responsePayload ?? {}) as any;
  const bankReq = (bankV?.requestPayload ?? {}) as any;
  const bankRes = (bankV?.responsePayload ?? {}) as any;
  const gstReq = (gstV?.requestPayload ?? {}) as any;
  const gstRes = (gstV?.responsePayload ?? {}) as any;
  const aadRes = (aadhaarV?.responsePayload ?? {}) as any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const panNumber = k.panNumber ?? panReq.pan ?? panRes.pan ?? null;
  const panName = k.panName ?? panV?.verifiedName ?? panRes.registered_name ?? null;
  const bankAccountNumber = k.bankAccountNumber ?? bankReq.account_number ?? null;
  const bankIfsc = k.bankIfsc ?? bankReq.ifsc ?? null;
  const bankAccountName = k.bankAccountName ?? bankV?.verifiedName ?? bankRes.nameAtBank ?? null;
  const bankAccountStatus =
    k.bankAccountStatus ?? bankRes.account_status ?? bankRes.accountStatus ?? null;
  const gstin = k.gstin ?? gstReq.gst ?? null;

  const aadhaarName = k.aadhaarName ?? aadhaarV?.verifiedName ?? aadRes.name ?? null;
  const aadhaarNumber =
    k.aadhaarNumber ?? (aadRes.uid ? `XXXX-XXXX-${String(aadRes.uid).slice(-4)}` : null);
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
    aadhaarVerifiedAt:
      k.aadhaarVerifiedAt?.toISOString() ?? (aadhaarV ? aadhaarV.createdAt.toISOString() : null),
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
      const resPayload = (v.responsePayload ?? {}) as Record<string, unknown>;
      const isVideo = v.type === "ONBOARD_VIDEO";
      const contentType = (payload.contentType as string) ?? "";
      // S3-stored assets (biometric selfies, onboarding liveness videos) have
      // no direct/public URL, so route their preview through the signed
      // document endpoint.
      const key = typeof payload.key === "string" ? (payload.key as string) : null;
      const isS3 = payload.storage === "s3" || (!!key && /^kyc-(videos|selfies)\//.test(key));
      return {
        id: v.id,
        type: v.type.replace("DOCUMENT_", ""),
        originalType: v.type,
        status: v.status,
        url: (payload.url as string) ?? (isS3 ? `/api/kyc/document/${v.id}` : null),
        format:
          (payload.format as string) ?? (isVideo ? contentType.split("/")[1] ?? "mp4" : null),
        publicId: (payload.publicId as string) ?? null,
        resourceType: (payload.resourceType as string) ?? (isVideo ? "video" : "image"),
        gpsLatitude: (payload.gpsLatitude as number) ?? null,
        gpsLongitude: (payload.gpsLongitude as number) ?? null,
        rejectionReason: (resPayload.rejectionReason as string) ?? null,
        createdAt: v.createdAt.toISOString(),
      };
    }),
  };
}

export type KycDetailPayload = ReturnType<typeof buildKycDetail>;
