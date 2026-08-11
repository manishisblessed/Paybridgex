import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth-server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { uploadToCloudinary } from "@/lib/cloudinary";
import { prisma } from "@/lib/db";
import { getQrClaimOverview } from "@/lib/qr/claims";
import { collectedTodayMap, qrLiveState, resolveLiveQr } from "@/lib/qr/rotation";

/**
 * Admin — static QR management (priority queue with per-QR daily caps).
 *   GET  — list every QR (newest first) with today's usage + state, plus the
 *          claims overview numbers
 *   POST — upload a new QR image and add it to the rotation queue at the given
 *          priority; the engine then decides which QR is live (the lowest-
 *          priority enabled QR with daily headroom)
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const CreateBody = z
  .object({
    label: z.string().min(2).max(120),
    upiVpa: z.string().regex(/^[\w.\-]{2,}@[a-zA-Z]{2,}$/).optional(),
    priority: z.number().int().min(0).max(100_000).optional(),
    dailyLimit: z.number().positive().max(100_000_000).optional(),
    dailyLimitCount: z.number().int().positive().max(1_000_000).optional(),
    dataUrl: z
      .string()
      .min(32)
      .max(8_000_000)
      .regex(/^data:image\/(png|jpe?g|webp);base64,/, "Must be a PNG/JPEG/WebP image data URL"),
  })
  .strict();

export async function GET() {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT");
  } catch (e) {
    return toErrorResponse(e);
  }

  const [qrs, overview] = await Promise.all([
    prisma.staticQr.findMany({
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      take: 50,
      include: {
        createdBy: { select: { id: true, name: true } },
        _count: { select: { claims: true } },
      },
    }),
    getQrClaimOverview(),
  ]);

  const usage = await collectedTodayMap(qrs.map((q) => q.id));

  return NextResponse.json({
    qrs: qrs.map((q) => {
      const used = usage.get(q.id) ?? { amount: 0, count: 0 };
      return {
        id: q.id,
        label: q.label,
        upiVpa: q.upiVpa,
        imageUrl: q.imageUrl,
        active: q.active,
        enabled: q.enabled,
        priority: q.priority,
        dailyLimit: q.dailyLimit != null ? Number(q.dailyLimit) : null,
        dailyLimitCount: q.dailyLimitCount,
        collectedToday: used.amount,
        collectedTodayCount: used.count,
        state: qrLiveState(q, used),
        claimCount: q._count.claims,
        createdBy: q.createdBy.name,
        createdAt: q.createdAt.toISOString(),
        disabledAt: q.disabledAt?.toISOString() ?? null,
      };
    }),
    overview,
  });
}

export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN");
    await enforceRateLimit(`qr:manage:${admin.id}`, RATE_LIMITS.sensitiveWrite);
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    // QR images are meant to be shown to every retailer — public delivery.
    const uploaded = await uploadToCloudinary(parsed.data.dataUrl, {
      userId: admin.id,
      type: "static-qr",
      isSensitive: false,
    });

    // Add to the queue as inactive; the rotation engine decides which QR is
    // live based on priority + daily headroom (called right after).
    const qr = await prisma.staticQr.create({
      data: {
        label: parsed.data.label,
        upiVpa: parsed.data.upiVpa ?? null,
        imagePublicId: uploaded.public_id,
        imageUrl: uploaded.secure_url,
        active: false,
        enabled: true,
        priority: parsed.data.priority ?? 100,
        dailyLimit: parsed.data.dailyLimit != null ? new Prisma.Decimal(parsed.data.dailyLimit) : null,
        dailyLimitCount: parsed.data.dailyLimitCount ?? null,
        createdById: admin.id,
      },
    });

    const live = await resolveLiveQr();

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "static_qr.created",
        entity: "StaticQr",
        entityId: qr.id,
        meta: {
          label: qr.label,
          upiVpa: qr.upiVpa,
          priority: qr.priority,
          dailyLimit: parsed.data.dailyLimit ?? null,
          dailyLimitCount: parsed.data.dailyLimitCount ?? null,
          liveNow: live?.id === qr.id,
        },
      },
    });

    return NextResponse.json(
      {
        id: qr.id,
        label: qr.label,
        upiVpa: qr.upiVpa,
        imageUrl: qr.imageUrl,
        priority: qr.priority,
        active: live?.id === qr.id,
      },
      { status: 201 }
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
