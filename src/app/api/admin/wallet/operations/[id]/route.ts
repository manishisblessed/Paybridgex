import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import {
  approveWalletOperation,
  closeWalletOperation,
  canManageWalletOps,
  WalletOpError,
} from "@/lib/wallet/operations";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const ActionBody = z.object({
  action: z.enum(["approve", "reject", "cancel"]),
  note: z.string().max(500).optional(),
});

/** PATCH — approve / reject / cancel a staged wallet operation. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }
  if (!canManageWalletOps(admin))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = ActionBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const op =
      parsed.data.action === "approve"
        ? await approveWalletOperation(params.id, admin.id)
        : await closeWalletOperation(
            params.id,
            admin.id,
            parsed.data.action === "reject" ? "REJECT" : "CANCEL",
            parsed.data.note
          );

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: `wallet_op.${parsed.data.action}`,
        entity: "WalletOperation",
        entityId: op.id,
        meta: { status: op.status, note: parsed.data.note ?? null },
        ip: clientIp(req),
      },
    });

    return NextResponse.json({ ok: true, status: op.status });
  } catch (e) {
    if (e instanceof WalletOpError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    console.error("[admin/wallet/operations/:id] PATCH error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
