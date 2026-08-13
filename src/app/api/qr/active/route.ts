import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-server";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { prisma } from "@/lib/db";
import {
  resolveLiveQr,
  collectedToday,
  peekOverflowQr,
  toRetailerQrPayload,
} from "@/lib/qr/rotation";

/**
 * The live static QR every retailer collects payments on, plus remaining
 * headroom and the next QR for overflow (split payments).
 *   { qr, overflowQr }                        → collect remaining on `qr`, rest on `overflowQr`
 *   { qr: null, reason: "LIMIT_REACHED" }     → every QR hit its daily cap; paused
 *   { qr: null, reason: "NOT_CONFIGURED" }    → admin hasn't set one up yet
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Only retailers collect on the shop QR — DT/MD/SD/admins have no collect surface.
    const user = await requireRole("RETAILER");
    await assertServiceEnabled(SERVICE_KEYS.QR, { name: "QR Payments", userId: user.id, role: user.role });
  } catch (e) {
    return toErrorResponse(e);
  }

  const qr = await resolveLiveQr();

  if (!qr) {
    // Is the pool merely exhausted for today, or has nothing ever been set up?
    const anyEnabled = await prisma.staticQr.count({ where: { enabled: true } });
    return NextResponse.json({ qr: null, overflowQr: null, reason: anyEnabled > 0 ? "LIMIT_REACHED" : "NOT_CONFIGURED" });
  }

  const used = await collectedToday(qr.id);
  const payload = toRetailerQrPayload(qr, used);

  // Only surface an overflow QR when the live one actually has a daily cap —
  // otherwise there is nothing to "split" onto the next code.
  const hasCap = payload.headroom.dailyLimit != null || payload.headroom.dailyLimitCount != null;
  let overflowQr = null;
  if (hasCap) {
    const next = await peekOverflowQr(qr.id);
    if (next) {
      overflowQr = toRetailerQrPayload(next, await collectedToday(next.id));
    }
  }

  return NextResponse.json({ qr: payload, overflowQr });
}
