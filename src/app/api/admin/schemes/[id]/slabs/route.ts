import { NextResponse } from "next/server";
import { z } from "zod";
import type { ServiceCode } from "@prisma/client";
import { requireRole, AuthError } from "@/lib/auth-server";
import { isAdminRole } from "@/lib/security/ownership";
import { prisma } from "@/lib/db";
import { serializeSlab } from "@/lib/scheme/serialize";
import { validateNonOverlapping } from "@/lib/scheme/resolver";
import { resolveServiceVendorLock } from "@/lib/scheme/serviceVendor";
import { SERVICE_CODES } from "@/lib/scheme/constants";

export const fetchCache = "force-no-store";

export const dynamic = "force-dynamic";

const SlabBody = z
  .object({
    service: z.enum(SERVICE_CODES),
    // Provider dimension (BBPS 1 vs BBPS 2, ...); null/omitted = any provider.
    provider: z.string().trim().min(1).max(60).nullish(),
    minAmount: z.number().min(0).max(100000000),
    maxAmount: z.number().min(0).max(100000000),
    chargeType: z.enum(["FLAT", "PERCENT"]).default("FLAT"),
    chargeValue: z.number().min(0),
    chargeGstInclusive: z.boolean().default(false),
    commissionType: z.enum(["FLAT", "PERCENT"]).default("FLAT"),
    commissionRetailer: z.number().min(0).default(0),
    commissionDistributor: z.number().min(0).default(0),
    commissionMaster: z.number().min(0).default(0),
    // Cascade model: commission the ASSIGNED user earns on this slab.
    commissionValue: z.number().min(0).default(0),
  })
  .superRefine((v, ctx) => {
    if (v.maxAmount < v.minAmount)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maxAmount"], message: "maxAmount must be ≥ minAmount" });
    // Percent values are fractions (0.0050 = 0.5%); guard against >100%.
    if (v.chargeType === "PERCENT" && v.chargeValue > 1)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["chargeValue"], message: "Percent charge must be a fraction ≤ 1 (e.g. 0.005 = 0.5%)" });
    if (v.commissionType === "PERCENT") {
      for (const k of ["commissionRetailer", "commissionDistributor", "commissionMaster", "commissionValue"] as const) {
        if (v[k] > 1)
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [k], message: "Percent commission must be a fraction ≤ 1" });
      }
    }
  });

export async function POST(req: Request, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN");
    if (!isAdminRole(admin.role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } catch (e: unknown) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const scheme = await prisma.scheme.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!scheme) return NextResponse.json({ error: "Scheme not found" }, { status: 404 });

  const parsed = SlabBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;

  const overlap = await validateNonOverlapping(
    scheme.id,
    body.service as ServiceCode,
    { minAmount: body.minAmount, maxAmount: body.maxAmount },
    undefined,
    body.provider ?? null
  );
  if (overlap) return NextResponse.json({ error: overlap }, { status: 409 });

  // Service rails (BBPS/Payout): lock the vendor cost from the provider's rate
  // card and enforce charge ≥ the card's Minimum. No-ops for other services and
  // for un-carded providers (preserves existing behaviour).
  const lock = await resolveServiceVendorLock({
    service: body.service as ServiceCode,
    provider: body.provider ?? null,
    chargeType: body.chargeType,
    chargeValue: body.chargeValue,
    minAmount: body.minAmount,
  });
  if (!lock.ok) return NextResponse.json({ error: lock.error }, { status: 400 });

  // Cascade model: admin schemes carry charges only — no commission. Commission
  // is set by each network parent when they derive a scheme for their children.
  const slab = await prisma.schemeSlab.create({
    data: {
      schemeId: scheme.id,
      service: body.service as ServiceCode,
      provider: body.provider ?? null,
      minAmount: body.minAmount,
      maxAmount: body.maxAmount,
      chargeType: body.chargeType,
      chargeValue: body.chargeValue,
      chargeGstInclusive: body.chargeGstInclusive,
      vendorCharge: lock.vendorCharge,
      commissionType: body.commissionType,
      commissionRetailer: 0,
      commissionDistributor: 0,
      commissionMaster: 0,
      commissionValue: 0,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "scheme.slab.create",
      entity: "SchemeSlab",
      entityId: slab.id,
      meta: { schemeId: scheme.id, service: body.service, minAmount: body.minAmount, maxAmount: body.maxAmount },
    },
  });

  return NextResponse.json({ ok: true, slab: serializeSlab(slab) }, { status: 201 });
}
