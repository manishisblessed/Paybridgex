import { NextResponse } from "next/server";
import { z } from "zod";
import type { ServiceCode } from "@prisma/client";
import { requireRole, AuthError } from "@/lib/auth-server";
import { SERVICE_CODES } from "@/lib/scheme/constants";
import { resolveServiceVendorInfo } from "@/lib/scheme/serviceVendor";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const Query = z.object({
  service: z.enum(SERVICE_CODES),
  provider: z.string().trim().max(60).optional(),
  amount: z.coerce.number().nonnegative().max(100000000).default(0),
});

/**
 * GET /api/admin/schemes/vendor-preview?service=BILL_CREDIT_CARD&provider=bbps_credit_card&amount=1000
 *
 * Live vendor cost + minimum for a BBPS/Payout product, resolved from the rate
 * card, so the scheme-slab modal can preview revenue (charge − vendor) and
 * enforce the minimum BEFORE saving. Returns nulls when no card matches (the
 * slab would then carry no vendor lock and earn the whole charge as revenue).
 */
export async function GET(req: Request) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN");
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const info = await resolveServiceVendorInfo({
    service: parsed.data.service as ServiceCode,
    provider: parsed.data.provider ?? null,
    amount: parsed.data.amount,
  });

  return NextResponse.json({
    vendorCharge: info?.vendorCharge ?? null,
    minCharge: info?.minCharge ?? null,
    scopeKey: info?.scopeKey ?? null,
    mdrType: info?.mdrType ?? null,
  });
}
