import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { rejectQrClaim } from "@/lib/qr/claims";
import { QR_REJECTION_REASON_VALUES } from "@/lib/qr/rejectionReasons";

/** Admin — reject a QR claim (at least one reason required; shown to the retailer). */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    // Structured, multi-select reasons from the predefined catalog.
    reasons: z
      .array(z.enum(QR_REJECTION_REASON_VALUES as [string, ...string[]]))
      .max(QR_REJECTION_REASON_VALUES.length)
      .optional()
      .default([]),
    // Optional free-text note (also required if the only reason is OTHER).
    note: z.string().max(500).optional(),
  })
  .strict()
  .refine((b) => b.reasons.length > 0 || (b.note?.trim().length ?? 0) >= 3, {
    message: "Select at least one reason, or provide a note (min 3 characters).",
  })
  .refine((b) => !(b.reasons.length === 1 && b.reasons[0] === "OTHER") || (b.note?.trim().length ?? 0) >= 3, {
    message: "Provide a note when the only reason is 'Other'.",
  });

export async function POST(req: Request, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireAdminActivity(req, {
      action: "qr.claim.reject",
      roles: ["MASTER_ADMIN", "ADMIN", "SUPPORT"],
      entity: "QrClaim",
      entityId: params.id,
    });
    await enforceRateLimit(`qr:review:${admin.id}`, RATE_LIMITS.sensitiveWrite);
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const result = await rejectQrClaim({
      claimId: params.id,
      adminId: admin.id,
      reasons: parsed.data.reasons,
      note: parsed.data.note,
    });
    return NextResponse.json(result);
  } catch (e) {
    return toErrorResponse(e);
  }
}
