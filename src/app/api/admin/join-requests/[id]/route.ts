import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { canManageJoinRequests } from "@/lib/onboarding/joinAccess";

const PatchBody = z.object({
  status: z
    .enum(["NEW", "CONTACTED", "INVITED", "CLOSED", "REJECTED"])
    .optional(),
  notes: z.string().max(2000).optional(),
  inviteId: z.string().optional(),
});

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  if (!canManageJoinRequests(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.joinRequest.findUnique({
    where: { id: params.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Join request not found" }, { status: 404 });
  }

  const { status, notes, inviteId } = parsed.data;
  if (status === undefined && notes === undefined && inviteId === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const data: Record<string, unknown> = {
    handledById: user.id,
    handledAt: new Date(),
  };
  if (status !== undefined) data.status = status;
  if (notes !== undefined) data.notes = notes || null;
  if (inviteId !== undefined) data.inviteId = inviteId || null;

  const updated = await prisma.joinRequest.update({
    where: { id: params.id },
    data,
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "join.request.update",
      entity: "JoinRequest",
      entityId: updated.id,
      meta: { status, notesChanged: notes !== undefined },
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true, request: updated });
}
