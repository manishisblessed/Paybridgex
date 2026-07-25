import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-server";
import { createPosExport } from "@/lib/partners/sameday-pos";
import { prisma } from "@/lib/db";
import { flags } from "@/lib/env";
import { scopePosTerminals } from "@/lib/pos/assignments";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";

export const fetchCache = "force-no-store";

export const dynamic = "force-dynamic";

const schema = z.object({
  format: z.enum(["csv", "pdf", "zip"]),
  date_from: z.string().min(1, "date_from is required"),
  date_to: z.string().min(1, "date_to is required"),
  status: z.enum(["AUTHORIZED", "CAPTURED", "FAILED", "REFUNDED", "VOIDED"]).nullable().optional(),
  terminal_id: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    await enforceRateLimit(`pos:export:${user.id}`, RATE_LIMITS.default);
  } catch (e) {
    return toErrorResponse(e);
  }

  if (!flags.pos) {
    return NextResponse.json(
      { error: "POS service is not enabled" },
      { status: 503 }
    );
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  // Ownership: non-admins may only export their own terminals' transactions.
  const scope = await scopePosTerminals(user);
  if (!scope.all) {
    if (scope.tids.length === 0)
      return NextResponse.json({ error: "No POS terminals are assigned to your account" }, { status: 403 });
    if (parsed.data.terminal_id) {
      if (!scope.tids.includes(parsed.data.terminal_id))
        return NextResponse.json({ error: "You do not have access to that terminal" }, { status: 403 });
    } else if (scope.tids.length === 1) {
      parsed.data.terminal_id = scope.tids[0];
    } else {
      return NextResponse.json(
        { error: "Select one of your terminals to export", terminals: scope.tids },
        { status: 400 }
      );
    }

    // Clamp date_from so exports only include transactions from after the
    // terminal was assigned to this user/downline.
    const match = scope.terminals.find((t) => t.tid === parsed.data.terminal_id);
    if (match?.assignedAt) {
      const assignedIso = match.assignedAt.toISOString();
      if (parsed.data.date_from < assignedIso) {
        parsed.data.date_from = assignedIso;
      }
    }
  }

  const result = await createPosExport(parsed.data);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error.error?.message ?? "Failed to create export job" },
      { status: result.status }
    );
  }

  // Record job ownership so export-status polling can be authorized (the
  // partner job id is otherwise an unguessable-but-unguarded handle / IDOR).
  const jobId = (result.data as { job_id?: string } | undefined)?.job_id;
  if (jobId) {
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "pos.export.create",
        entity: "PosExport",
        entityId: String(jobId),
        meta: { format: parsed.data.format, terminal_id: parsed.data.terminal_id ?? null },
      },
    });
  }

  return NextResponse.json(result.data, { status: 202 });
}
