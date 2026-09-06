import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { approveQrClaim } from "@/lib/qr/claims";

/**
 * Admin — approve a QR claim.
 * `portalVerified: true` is mandatory: the admin attests (audit-logged) that
 * the UTR was found in the third-party provider's merchant portal. Amounts
 * above the maker-checker threshold are staged on the first call and need a
 * second, different admin. The wallet credit is idempotent.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    portalVerified: z.boolean(),
    note: z.string().max(500).optional(),
  })
  .strict();

export async function POST(req: Request, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireAdminActivity(req, {
      action: "qr.claim.approve",
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
    const result = await approveQrClaim({
      claimId: params.id,
      adminId: admin.id,
      note: parsed.data.note,
      portalVerified: parsed.data.portalVerified,
    });
    return NextResponse.json(result);
  } catch (e) {
    return toErrorResponse(e);
  }
}
