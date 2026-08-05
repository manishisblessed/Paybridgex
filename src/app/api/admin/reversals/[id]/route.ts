import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import {
  approveReversal,
  closeReversal,
  canManageReversals,
  ReversalError,
} from "@/lib/reversal/service";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.enum(["APPROVE", "REJECT", "CANCEL"]),
  note: z.string().max(300).optional(),
});

/** PATCH — checker decision (approve/reject) or maker cancel. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }
  if (!canManageReversals(admin))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const rev =
      parsed.data.action === "APPROVE"
        ? await approveReversal(params.id, admin.id)
        : await closeReversal(params.id, admin.id, parsed.data.action, parsed.data.note);

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: `reversal.${parsed.data.action.toLowerCase()}`,
        entity: "Reversal",
        entityId: rev.id,
        meta: { status: rev.status, note: parsed.data.note ?? null },
        ip: clientIp(req),
      },
    });
    return NextResponse.json({ ok: true, status: rev.status });
  } catch (e) {
    if (e instanceof ReversalError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[admin/reversals/:id] PATCH error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
