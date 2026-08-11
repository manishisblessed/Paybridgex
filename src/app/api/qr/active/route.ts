import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { prisma } from "@/lib/db";
import { resolveLiveQr } from "@/lib/qr/rotation";

/**
 * The one live static QR every retailer collects payments on. The rotation
 * engine derives it from the priority queue and per-QR daily caps, auto-pausing
 * a QR once it fills up and promoting the next one.
 *   { qr: {...} }                             → collect on this QR
 *   { qr: null, reason: "LIMIT_REACHED" }     → every QR hit its daily cap; paused
 *   { qr: null, reason: "NOT_CONFIGURED" }    → admin hasn't set one up yet
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireAuth();
    await assertServiceEnabled(SERVICE_KEYS.QR, { name: "QR Payments", userId: user.id, role: user.role });
  } catch (e) {
    return toErrorResponse(e);
  }

  const qr = await resolveLiveQr();

  if (!qr) {
    // Is the pool merely exhausted for today, or has nothing ever been set up?
    const anyEnabled = await prisma.staticQr.count({ where: { enabled: true } });
    return NextResponse.json({ qr: null, reason: anyEnabled > 0 ? "LIMIT_REACHED" : "NOT_CONFIGURED" });
  }

  return NextResponse.json({
    qr: {
      id: qr.id,
      label: qr.label,
      upiVpa: qr.upiVpa,
      imageUrl: qr.imageUrl,
      activatedAt: qr.createdAt.toISOString(),
    },
  });
}
