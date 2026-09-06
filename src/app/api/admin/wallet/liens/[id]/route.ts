import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { requireStepUp, readStepUpCode } from "@/lib/security/stepUp";
import { recordAdminActivity, readActionLocation } from "@/lib/security/adminActivity";
import { toErrorResponse } from "@/lib/security/apiErrors";
import {
  recoverWalletLien,
  releaseWalletLien,
  serializeLien,
  canManageLiens,
  WalletLienError,
} from "@/lib/wallet/lien";
import { toNumber, dec } from "@/lib/money";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const ActionBody = z.object({
  action: z.enum(["recover", "release"]),
  note: z.string().max(500).optional(),
});

/** PATCH — recover (force an immediate sweep) or release an active lien. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }
  if (!canManageLiens(admin))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { code, type } = readStepUpCode(req);
    await requireStepUp(admin, {
      action: "wallet_lien.review",
      code,
      type,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = ActionBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const lien =
      parsed.data.action === "recover"
        ? await recoverWalletLien(params.id)
        : await releaseWalletLien(params.id, admin.id, parsed.data.note);

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: `wallet_lien.${parsed.data.action}`,
        entity: "WalletLien",
        entityId: lien.id,
        meta: {
          targetUserId: lien.targetUserId,
          amount: toNumber(dec(lien.amount)),
          recoveredAmount: toNumber(dec(lien.recoveredAmount)),
          status: lien.status,
          note: parsed.data.note ?? null,
        },
        ip: clientIp(req),
      },
    });

    await recordAdminActivity({
      actor: admin,
      req,
      action: `wallet_lien.${parsed.data.action}`,
      kind: "write",
      entity: "WalletLien",
      entityId: lien.id,
      location: readActionLocation(req),
      meta: { status: lien.status },
    });

    return NextResponse.json({ ok: true, lien: serializeLien(lien) });
  } catch (e) {
    if (e instanceof WalletLienError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    console.error("[admin/wallet/liens/:id] PATCH error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
