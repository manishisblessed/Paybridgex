import { prisma } from "@/lib/db";

/**
 * Invite statuses that still "own" a verified identity. REJECTED / EXPIRED
 * (and purged invites) release the identifier so a genuine new applicant
 * can use it.
 */
const CLAIMING_INVITE_STATUSES = [
  "PENDING",
  "REGISTERED",
  "VERIFIED",
  "RESUBMIT",
  "APPROVED",
] as const;

export type IdentityKind = "PAN" | "GST" | "BANK" | "AADHAAR";

const MESSAGES: Record<IdentityKind, string> = {
  PAN: "This PAN is already linked to another Paybridgex account. Each PAN can only belong to one user.",
  GST: "This GST number is already linked to another Paybridgex account. Each GSTIN can only belong to one user.",
  BANK: "This bank account is already linked to another Paybridgex account. Each account number can only belong to one user.",
  AADHAAR:
    "This Aadhaar is already linked to another Paybridgex account. Each Aadhaar can only belong to one user.",
};

export function identityTakenMessage(kind: IdentityKind): string {
  return MESSAGES[kind];
}

export async function isIdentityTaken(opts: {
  kind: IdentityKind;
  value: string;
  excludeUserId?: string | null;
  excludeInviteId?: string | null;
}): Promise<boolean> {
  const value = normalizeIdentity(opts.kind, opts.value);
  if (!value) return false;

  if (await kycHasIdentity(opts.kind, value, opts.excludeUserId)) return true;
  if (await verificationHasIdentity(opts.kind, value, opts.excludeUserId, opts.excludeInviteId)) {
    return true;
  }
  // GST lookups are case-insensitive in SQL so a historically mixed-case
  // requestPayload still blocks reuse (the reported Super Distributor case).
  if (opts.kind === "GST") {
    return gstVerificationTakenSql(value, opts.excludeUserId, opts.excludeInviteId);
  }
  return false;
}

function normalizeIdentity(kind: IdentityKind, raw: string): string {
  const trimmed = raw.trim();
  if (kind === "PAN" || kind === "GST") return trimmed.toUpperCase();
  if (kind === "BANK") return trimmed.replace(/\s+/g, "");
  return trimmed;
}

async function kycHasIdentity(
  kind: IdentityKind,
  value: string,
  excludeUserId?: string | null
): Promise<boolean> {
  const exclude = excludeUserId ? { userId: { not: excludeUserId } } : {};

  if (kind === "AADHAAR") {
    const last4 = value.slice(-4);
    const dup = await prisma.kyc.findFirst({
      where: {
        OR: [
          { aadhaarNumber: value },
          ...(last4 ? [{ aadhaarLast4: last4, aadhaarNumber: null }] : []),
        ],
        ...exclude,
      },
      select: { userId: true },
    });
    return Boolean(dup);
  }

  const field =
    kind === "PAN" ? "panNumber" : kind === "GST" ? "gstin" : "bankAccountNumber";
  const dup = await prisma.kyc.findFirst({
    where: { [field]: value, ...exclude },
    select: { userId: true },
  });
  return Boolean(dup);
}

async function verificationHasIdentity(
  kind: IdentityKind,
  value: string,
  excludeUserId?: string | null,
  excludeInviteId?: string | null
): Promise<boolean> {
  const types =
    kind === "PAN"
      ? ["PAN_360"]
      : kind === "GST"
        ? ["GST"]
        : kind === "BANK"
          ? ["BANK_PENNY_DROP", "BANK_ADVANCE"]
          : ["AADHAAR_DIGILOCKER"];

  const payloadFilters =
    kind === "PAN"
      ? [{ requestPayload: { path: ["pan"], equals: value } }]
      : kind === "GST"
        ? [
            { requestPayload: { path: ["gst"], equals: value } },
            { requestPayload: { path: ["gstin"], equals: value } },
          ]
        : kind === "BANK"
          ? [{ requestPayload: { path: ["account_number"], equals: value } }]
          : [{ responsePayload: { path: ["uid"], equals: value } }];

  const hits = await prisma.verificationResult.findMany({
    where: {
      type: { in: types },
      status: "Success",
      OR: payloadFilters,
      ...(excludeInviteId ? { inviteId: { not: excludeInviteId } } : {}),
    },
    select: { inviteId: true, userId: true },
    take: 20,
  });

  for (const hit of hits) {
    if (await isClaimedBySomeoneElse(hit, excludeUserId, excludeInviteId)) {
      return true;
    }
  }
  return false;
}

async function gstVerificationTakenSql(
  gst: string,
  excludeUserId?: string | null,
  excludeInviteId?: string | null
): Promise<boolean> {
  const rows = await prisma.$queryRaw<
    Array<{ inviteId: string | null; userId: string | null }>
  >`
    SELECT "inviteId", "userId"
    FROM "VerificationResult"
    WHERE type = 'GST'
      AND status = 'Success'
      AND (
        UPPER(COALESCE("requestPayload"->>'gst', '')) = ${gst}
        OR UPPER(COALESCE("requestPayload"->>'gstin', '')) = ${gst}
      )
    LIMIT 30
  `;
  for (const row of rows) {
    if (await isClaimedBySomeoneElse(row, excludeUserId, excludeInviteId)) {
      return true;
    }
  }
  return false;
}

async function isClaimedBySomeoneElse(
  hit: { inviteId: string | null; userId: string | null },
  excludeUserId?: string | null,
  excludeInviteId?: string | null
): Promise<boolean> {
  if (excludeInviteId && hit.inviteId === excludeInviteId) return false;
  if (excludeUserId && hit.userId === excludeUserId) return false;

  // Linked to a real account that isn't the current applicant.
  if (hit.userId && hit.userId !== excludeUserId) return true;

  if (!hit.inviteId) return false;

  const other = await prisma.invite.findUnique({
    where: { id: hit.inviteId },
    select: { status: true, userId: true },
  });
  if (!other) return false;
  if (excludeUserId && other.userId === excludeUserId) return false;

  return (CLAIMING_INVITE_STATUSES as readonly string[]).includes(other.status);
}
