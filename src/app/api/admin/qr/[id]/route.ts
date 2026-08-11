import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth-server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { prisma } from "@/lib/db";
import { resolveLiveQr } from "@/lib/qr/rotation";

/**
 * Admin — edit a QR's queue settings.
 *   PATCH { enabled?, priority?, dailyLimit?, dailyLimitCount?, makeLiveNow? }
 *
 * Liveness is derived by the rotation engine, not set by hand: after any change
 * we re-resolve so the correct QR (lowest-priority enabled QR with daily
 * headroom) becomes the single live one. `enabled: false` is the admin's real
 * off switch (removes the QR from the queue). `makeLiveNow` is a convenience:
 * it clears today's auto-pause and bumps the QR to the front of the queue.
 * QRs are never deleted, so old claims keep their reference.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    enabled: z.boolean().optional(),
    priority: z.number().int().min(0).max(100_000).optional(),
    dailyLimit: z.number().positive().max(100_000_000).nullable().optional(),
    dailyLimitCount: z.number().int().positive().max(1_000_000).nullable().optional(),
    makeLiveNow: z.boolean().optional(),
    // Back-compat: an `active` toggle maps onto `enabled`.
    active: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "No fields to update" });

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN");
    await enforceRateLimit(`qr:manage:${admin.id}`, RATE_LIMITS.sensitiveWrite);
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const qr = await prisma.staticQr.findUnique({ where: { id: params.id } });
  if (!qr) return NextResponse.json({ error: "QR not found" }, { status: 404 });

  const data: Prisma.StaticQrUpdateInput = {};
  const enabled = parsed.data.enabled ?? parsed.data.active;
  if (enabled !== undefined) {
    data.enabled = enabled;
    // Turning a QR off should also drop it as the live one immediately.
    if (!enabled) {
      data.active = false;
      data.disabledAt = new Date();
      data.disabledById = admin.id;
    }
  }
  if (parsed.data.priority !== undefined) data.priority = parsed.data.priority;
  if (parsed.data.dailyLimit !== undefined) {
    data.dailyLimit = parsed.data.dailyLimit == null ? null : new Prisma.Decimal(parsed.data.dailyLimit);
  }
  if (parsed.data.dailyLimitCount !== undefined) data.dailyLimitCount = parsed.data.dailyLimitCount;

  if (parsed.data.makeLiveNow) {
    // Jump the queue: clear today's auto-pause and take a strictly-lower
    // priority than every other enabled QR so the engine picks it next.
    const top = await prisma.staticQr.aggregate({ _min: { priority: true }, where: { enabled: true } });
    const minPriority = top._min.priority ?? 100;
    data.enabled = true;
    data.autoPausedOn = null;
    data.priority = minPriority - 1;
  }

  await prisma.staticQr.update({ where: { id: qr.id }, data });

  const live = await resolveLiveQr();

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: enabled === false ? "static_qr.disabled" : "static_qr.updated",
      entity: "StaticQr",
      entityId: qr.id,
      meta: {
        label: qr.label,
        enabled: data.enabled ?? qr.enabled,
        priority: data.priority ?? qr.priority,
        dailyLimit: parsed.data.dailyLimit,
        dailyLimitCount: parsed.data.dailyLimitCount,
        makeLiveNow: parsed.data.makeLiveNow ?? false,
      },
    },
  });

  return NextResponse.json({ ok: true, id: qr.id, liveId: live?.id ?? null });
}
