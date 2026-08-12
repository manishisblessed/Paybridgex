import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth-server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertKycCurrent } from "@/lib/security/kycGate";
import { assertLivenessReady } from "@/lib/security/livenessGate";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { uploadToCloudinary } from "@/lib/cloudinary";
import { prisma } from "@/lib/db";
import {
  precheckQrClaim,
  submitQrClaim,
  screenshotSha256,
  getRetailerDailyClaimUsage,
} from "@/lib/qr/claims";

/**
 * Retailer — QR settlement claims.
 *
 * POST — file a claim: amount + 12-digit UTR + payment date/time + screenshot.
 *        The screenshot hash and the UTR are dedupe keys (DB-unique); the
 *        wallet is credited ONLY after admin review, never here.
 * GET  — the caller's own claims, newest first.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    qrId: z.string().min(8),
    amount: z.number().positive(),
    // RuPay credit-card collections: card last 4 is required, UPI UTR and the
    // paid-on time are optional.
    cardLast4: z.string().regex(/^\d{4}$/, "Enter the last 4 digits of the RuPay card"),
    utr: z.string().min(12).max(20).optional(),
    paidAt: z.string().datetime().optional(),
    screenshotDataUrl: z
      .string()
      .min(64)
      .max(8_000_000) // ~6MB binary once base64-encoded
      .regex(/^data:image\/(png|jpe?g|webp);base64,/, "Screenshot must be a PNG/JPEG/WebP image"),
  })
  .strict();

export async function GET() {
  let user;
  try {
    // QR claims are a retailer-only surface (collect & claim).
    user = await requireRole("RETAILER");
  } catch (e) {
    return toErrorResponse(e);
  }

  const [claims, dailyUsage] = await Promise.all([
    prisma.qrClaim.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { qr: { select: { label: true } } },
    }),
    getRetailerDailyClaimUsage(user.id),
  ]);

  return NextResponse.json({
    dailyUsage,
    claims: claims.map((c) => ({
      id: c.id,
      qrLabel: c.qr.label,
      amount: Number(c.amount),
      utr: c.utr,
      cardLast4: c.cardLast4,
      paidAt: c.paidAt?.toISOString() ?? null,
      status: c.status,
      // Settlement figures (net of scheme MDR) — present once settled.
      netAmount: c.netAmount != null ? Number(c.netAmount) : null,
      mdrAmount: c.mdrAmount != null ? Number(c.mdrAmount) : null,
      settledVia: c.settledVia,
      settledAt: c.settledAt?.toISOString() ?? null,
      reviewNote: c.status === "REJECTED" || c.status === "CLAWED_BACK" ? c.reviewNote : null,
      createdAt: c.createdAt.toISOString(),
      reviewedAt: c.reviewedAt?.toISOString() ?? null,
    })),
  });
}

export async function POST(req: Request) {
  let user;
  try {
    // Filing a claim is retailer-only — uplines never collect on the QR themselves.
    user = await requireRole("RETAILER");
    // Admin kill-switch + per-user allowlist (default-disabled) for this rail.
    await assertServiceEnabled(SERVICE_KEYS.QR, { name: "QR Payments", userId: user.id, role: user.role });
    await assertLivenessReady(user);
    await assertKycCurrent(user);
    await enforceRateLimit(`qr:claim:${user.id}`, RATE_LIMITS.fundRequestCreate);
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const bytes = Buffer.from(parsed.data.screenshotDataUrl.split(",")[1] ?? "", "base64");
    if (bytes.length < 1024) {
      return NextResponse.json({ error: "Screenshot file looks empty or corrupted" }, { status: 400 });
    }
    const screenshotHash = screenshotSha256(bytes);

    const base = {
      userId: user.id,
      qrId: parsed.data.qrId,
      amount: parsed.data.amount,
      cardLast4: parsed.data.cardLast4,
      utr: parsed.data.utr ?? null,
      paidAt: parsed.data.paidAt ? new Date(parsed.data.paidAt) : null,
      screenshotHash,
    };

    // Validate everything (incl. UTR/screenshot dedupe and velocity caps)
    // BEFORE paying for the Cloudinary upload.
    await precheckQrClaim(base);

    // Payment screenshots carry third-party PII — private storage, signed
    // delivery for reviewers only.
    const uploaded = await uploadToCloudinary(parsed.data.screenshotDataUrl, {
      userId: user.id,
      type: "qr-claim",
      isSensitive: true,
    });

    const claim = await submitQrClaim({
      ...base,
      screenshotPublicId: uploaded.public_id,
      screenshotFormat: uploaded.format ?? undefined,
    });

    return NextResponse.json(
      {
        claim: {
          id: claim.id,
          amount: Number(claim.amount),
          utr: claim.utr,
          cardLast4: claim.cardLast4,
          paidAt: claim.paidAt?.toISOString() ?? null,
          status: claim.status,
          createdAt: claim.createdAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
