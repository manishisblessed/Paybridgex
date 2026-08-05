import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { validateMdrSlab } from "@/lib/mdr/resolver";
import { validateMdrAgainstFloor } from "@/lib/mdr/floor";
import { findApprovedBrandRate } from "@/lib/brand/mdr";
import { findApprovedRailRate } from "@/lib/rail/mdr";

/**
 * POS slabs are governed by the manually-approved brand rate card: the vendor
 * cost is locked to it and the MDR can never be priced below it. This resolves
 * that rate for a (company, paymentMode, band) and returns either the locked
 * vendor values (in the approved rate's type) or an error to block the slab.
 */
async function lockPosVendorToBrandRate(input: {
  company: string | null | undefined;
  paymentMode: string;
  cardType?: string | null;
  brandType?: string | null;
  classification?: string | null;
  mdrType: "FLAT" | "PERCENT";
  minAmount: number;
}): Promise<
  | { ok: true; vendorCharge: number; vendorChargeT0: number; minMdr: number; minMdrT0: number }
  | { ok: false; error: string }
> {
  const company = input.company?.trim();
  if (!company || company === "*") {
    return {
      ok: false,
      error:
        "POS MDR must be scoped to a company. Select a company that has an approved rate in Brands & MDR.",
    };
  }
  const approved = await findApprovedBrandRate({
    company,
    paymentMode: input.paymentMode,
    cardType: input.cardType ?? null,
    brandType: input.brandType ?? null,
    classification: input.classification ?? null,
    amount: Math.max(input.minAmount, 1),
  });
  if (!approved) {
    const dimLabel = [input.paymentMode, input.cardType, input.brandType, input.classification]
      .filter((v) => v && v !== "*")
      .join("/");
    return {
      ok: false,
      error: `No company-approved rate exists for ${company} (${dimLabel || "*"}). Add it in Brands & MDR first.`,
    };
  }
  if (input.mdrType !== approved.mdrType) {
    return {
      ok: false,
      error: `MDR type must be ${approved.mdrType} to match the approved rate for ${company}.`,
    };
  }
  const vendorCharge = Number(approved.mdrValue);
  // Minimum MDR is the floor offered downstream (vendor + company margin). When
  // a brand hasn't set one yet it defaults to the vendor cost (zero company
  // margin), preserving the legacy "service ≥ vendor" behavior.
  const minMdr = Number(approved.minMdrValue) > 0 ? Number(approved.minMdrValue) : vendorCharge;
  const minMdrT0 = Number(approved.minMdrValueT0) > 0 ? Number(approved.minMdrValueT0) : minMdr;
  return {
    ok: true,
    vendorCharge,
    vendorChargeT0: Number(approved.mdrValueT0),
    minMdr,
    minMdrT0,
  };
}

/**
 * PG/QR slabs are governed by the provider's approved rail rate card (the direct
 * analogue of the POS brand rate). The vendor cost is locked to it and the MDR
 * can never be priced below it. The slab's `company` field carries the provider
 * scope key (ServiceRoute.provider, e.g. "BULKPE") for these rails.
 */
async function lockRailVendorToRate(input: {
  serviceKind: "PG" | "QR";
  scopeKey: string | null | undefined;
  paymentMode: string;
  cardType?: string | null;
  brandType?: string | null;
  classification?: string | null;
  mdrType: "FLAT" | "PERCENT";
  minAmount: number;
}): Promise<
  | { ok: true; vendorCharge: number; vendorChargeT0: number }
  | { ok: false; error: string }
> {
  const scopeKey = input.scopeKey?.trim();
  if (!scopeKey || scopeKey === "*") {
    return {
      ok: false,
      error: `${input.serviceKind} MDR must be scoped to a provider. Select a provider that has an approved rate in MDR & minimum charges.`,
    };
  }
  const approved = await findApprovedRailRate({
    serviceKind: input.serviceKind,
    scopeKey,
    paymentMode: input.paymentMode,
    cardType: input.cardType ?? null,
    brandType: input.brandType ?? null,
    classification: input.classification ?? null,
    amount: Math.max(input.minAmount, 1),
  });
  if (!approved) {
    const dimLabel = [input.paymentMode, input.cardType, input.brandType, input.classification]
      .filter((v) => v && v !== "*")
      .join("/");
    return {
      ok: false,
      error: `No approved ${input.serviceKind} rate exists for ${scopeKey} (${dimLabel || "*"}). Add it in MDR & minimum charges first.`,
    };
  }
  if (input.mdrType !== approved.mdrType) {
    return {
      ok: false,
      error: `MDR type must be ${approved.mdrType} to match the approved ${input.serviceKind} rate for ${scopeKey}.`,
    };
  }
  return {
    ok: true,
    vendorCharge: Number(approved.mdrValue),
    vendorChargeT0: Number(approved.mdrValueT0),
  };
}

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * MDR (POS/PG/QR/UPI) slabs live on the unified Scheme. These endpoints manage
 * the MDR rows of a scheme identified by its Scheme id (params.id).
 */

const SlabBody = z.object({
  serviceKind: z.enum(["POS", "PG", "QR", "UPI"]),
  paymentMode: z.string().min(1).max(30).default("*"),
  company: z.string().trim().min(1).max(60).nullish(),
  cardType: z.string().trim().min(1).max(30).nullish(),
  brandType: z.string().trim().min(1).max(30).nullish(),
  classification: z.string().trim().min(1).max(30).nullish(),
  minAmount: z.number().nonnegative().default(0),
  maxAmount: z.number().positive().default(999999999),
  mdrType: z.enum(["FLAT", "PERCENT"]).default("PERCENT"),
  mdrValue: z.number().nonnegative(),
  // Instant (T+0) settlement rate; 0 = unset, falls back to mdrValue.
  mdrValueT0: z.number().nonnegative().default(0),
  // Vendor/acquirer cost the company pays upstream. Revenue = mdrValue − vendorCharge.
  vendorCharge: z.number().nonnegative().default(0),
  vendorChargeT0: z.number().nonnegative().default(0),
  // Commission distributed up the chain (DT/MD/SD). Retailer earns none.
  // Base = T+1 (standard). *T0 = instant settlement (falls back to T+1 when 0).
  commissionType: z.enum(["FLAT", "PERCENT"]).default("PERCENT"),
  commissionDistributor: z.number().nonnegative().default(0),
  commissionMaster: z.number().nonnegative().default(0),
  commissionSuperDistributor: z.number().nonnegative().default(0),
  commissionDistributorT0: z.number().nonnegative().default(0),
  commissionMasterT0: z.number().nonnegative().default(0),
  commissionSuperDistributorT0: z.number().nonnegative().default(0),
  // When true, the slab is created across ALL active schemes (not just this one).
  global: z.boolean().default(false),
});

/**
 * Guardrail: total DT+MD+SD commission must not exceed the company MDR margin
 * (serviceCharge − vendorCharge), so payouts are always funded by the same
 * transaction's earning and the revenue wallet can never go negative.
 *
 * When commission and MDR use the same RateType the comparison is exact. When
 * they differ (one FLAT, one PERCENT) both are evaluated at a nominal reference
 * amount as a conservative guardrail.
 */
const MARGIN_REF_AMOUNT = 100000;
function validateMarginVsCommission(b: {
  mdrType: "FLAT" | "PERCENT";
  mdrValue: number;
  mdrValueT0: number;
  vendorCharge: number;
  vendorChargeT0: number;
  commissionType: "FLAT" | "PERCENT";
  commissionDistributor: number;
  commissionMaster: number;
  commissionSuperDistributor: number;
  commissionDistributorT0: number;
  commissionMasterT0: number;
  commissionSuperDistributorT0: number;
}): string | null {
  const abs = (type: "FLAT" | "PERCENT", val: number) =>
    type === "FLAT" ? val : MARGIN_REF_AMOUNT * val;
  const EPS = 1e-6;

  const commissionSumT1 = abs(b.commissionType, b.commissionDistributor)
    + abs(b.commissionType, b.commissionMaster)
    + abs(b.commissionType, b.commissionSuperDistributor);

  // T+0 commission falls back to the T+1 value per tier when unset (0).
  const commissionSumT0 =
    abs(b.commissionType, b.commissionDistributorT0 > 0 ? b.commissionDistributorT0 : b.commissionDistributor)
    + abs(b.commissionType, b.commissionMasterT0 > 0 ? b.commissionMasterT0 : b.commissionMaster)
    + abs(b.commissionType, b.commissionSuperDistributorT0 > 0 ? b.commissionSuperDistributorT0 : b.commissionSuperDistributor);

  // T+1 margin
  const marginT1 = abs(b.mdrType, b.mdrValue) - abs(b.mdrType, b.vendorCharge);
  if (marginT1 < -EPS)
    return "Rate too low: the service charge (MDR) cannot be set below the vendor cost. That would make the company pay the acquirer more than it collects on every transaction (a loss), so no rate below MDR is allowed. Raise the service charge to at least the vendor cost.";
  if (commissionSumT1 - marginT1 > EPS)
    return "Total DT+MD+SD commission (T+1) exceeds the company margin (MDR − vendor charge). Reduce commissions or adjust the MDR / vendor charge.";

  // T+0 margin (fall back to T+1 values when a T+0 value is unset).
  const mdrT0 = b.mdrValueT0 > 0 ? b.mdrValueT0 : b.mdrValue;
  const vendorT0 = b.vendorChargeT0 > 0 ? b.vendorChargeT0 : b.vendorCharge;
  const marginT0 = abs(b.mdrType, mdrT0) - abs(b.mdrType, vendorT0);
  if (marginT0 < -EPS)
    return "Rate too low: the T+0 (instant) service charge cannot be set below the T+0 vendor cost. No rate below MDR is allowed. Raise the T+0 service charge to at least the T+0 vendor cost.";
  if (commissionSumT0 - marginT0 > EPS)
    return "Total DT+MD+SD commission (T+0 instant) exceeds the T+0 company margin. Reduce the instant commissions or adjust the T+0 MDR / vendor charge.";

  return null;
}

const pct = (frac: number) => `${(frac * 100).toFixed(2)}%`;

/**
 * POS-specific pricing rule (Brands "Minimum MDR" model, flexible residual):
 *   - Service charge (MDR) can never be below the brand's Minimum MDR, so the
 *     company always keeps its guaranteed margin (Minimum MDR − vendor cost).
 *   - The commission pool available to DT/MD/SD is what the scheme prices ABOVE
 *     the minimum: pool = Service − Minimum MDR. The three tiers may sum to AT
 *     MOST that pool (per leg); anything left UNallocated is additional company
 *     earning. T+0 uses its own service/minimum; an unset T+0 service falls back
 *     to T+1 (mirrors the rate resolver), but T+0 commissions do NOT fall back —
 *     they must be set explicitly (a 0 T+0 tier earns nothing on instant legs).
 * All POS values are percentages (fractions); enforced Percent-only upstream.
 */
function validatePosCommissionEquality(
  b: {
    mdrType: "FLAT" | "PERCENT";
    mdrValue: number;
    mdrValueT0: number;
    commissionType: "FLAT" | "PERCENT";
    commissionDistributor: number;
    commissionMaster: number;
    commissionSuperDistributor: number;
    commissionDistributorT0: number;
    commissionMasterT0: number;
    commissionSuperDistributorT0: number;
  },
  minMdr: number,
  minMdrT0: number
): string | null {
  const EPS = 1e-6;
  if (b.mdrType !== "PERCENT")
    return "POS MDR must be a percentage.";
  if (b.commissionType !== "PERCENT")
    return "POS commission must be a percentage (to match the MDR).";

  const svcT1 = b.mdrValue;
  const svcT0 = b.mdrValueT0 > 0 ? b.mdrValueT0 : b.mdrValue;
  const minT1 = minMdr;
  const minT0 = minMdrT0 > 0 ? minMdrT0 : minMdr;

  // Floor: service charge can never be below the brand's Minimum MDR.
  if (svcT1 - minT1 < -EPS)
    return `Service charge ${pct(svcT1)} is below the brand's Minimum MDR of ${pct(minT1)}. No retailer can be given a rate below the Minimum MDR — raise the service charge to at least ${pct(minT1)}.`;
  if (svcT0 - minT0 < -EPS)
    return `T+0 (instant) service charge ${pct(svcT0)} is below the T+0 Minimum MDR of ${pct(minT0)}. Raise it to at least ${pct(minT0)}.`;

  // Commission pool = service − minimum; the chain may consume UP TO it. Any
  // unallocated remainder is kept by the company (flexible residual model), so
  // only OVER-allocation is rejected.
  const poolT1 = svcT1 - minT1;
  const poolT0 = svcT0 - minT0;
  const sumT1 = b.commissionDistributor + b.commissionMaster + b.commissionSuperDistributor;
  const sumT0 = b.commissionDistributorT0 + b.commissionMasterT0 + b.commissionSuperDistributorT0;

  if (sumT1 - poolT1 > EPS) {
    return `Total DT+MD+SD commission (T+1) of ${pct(sumT1)} exceeds the commission pool of ${pct(poolT1)} (Service ${pct(svcT1)} − Min MDR ${pct(minT1)}). Reduce commissions by ${pct(sumT1 - poolT1)}.`;
  }
  if (sumT0 - poolT0 > EPS) {
    return `Total DT+MD+SD commission (T+0 instant) of ${pct(sumT0)} exceeds the T+0 commission pool of ${pct(poolT0)} (Service ${pct(svcT0)} − Min MDR ${pct(minT0)}). Reduce commissions by ${pct(sumT0 - poolT0)}.`;
  }
  return null;
}

/** POST — add an MDR slab to a scheme (band-overlap validated). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const parsed = SlabBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const b = parsed.data;

  // POS pricing is always a percentage of the transaction.
  if (b.serviceKind === "POS" && (b.mdrType !== "PERCENT" || b.commissionType !== "PERCENT"))
    return NextResponse.json(
      { error: "POS MDR and commission must both be percentages." },
      { status: 400 }
    );

  // POS: lock vendor to the company-approved brand rate and capture the brand's
  // Minimum MDR (the downstream floor) for the commission-pool equality check.
  let posMinMdr = 0;
  let posMinMdrT0 = 0;
  if (b.serviceKind === "POS") {
    const lock = await lockPosVendorToBrandRate({
      company: b.company,
      paymentMode: b.paymentMode,
      cardType: b.cardType,
      brandType: b.brandType,
      classification: b.classification,
      mdrType: b.mdrType,
      minAmount: b.minAmount,
    });
    if (!lock.ok) return NextResponse.json({ error: lock.error }, { status: 400 });
    b.vendorCharge = lock.vendorCharge;
    b.vendorChargeT0 = lock.vendorChargeT0;
    posMinMdr = lock.minMdr;
    posMinMdrT0 = lock.minMdrT0;
  }

  // PG / QR: lock vendor to the provider-approved rail rate (blocks below-cost MDR).
  if (b.serviceKind === "PG" || b.serviceKind === "QR") {
    const lock = await lockRailVendorToRate({
      serviceKind: b.serviceKind,
      scopeKey: b.company,
      paymentMode: b.paymentMode,
      cardType: b.cardType,
      brandType: b.brandType,
      classification: b.classification,
      mdrType: b.mdrType,
      minAmount: b.minAmount,
    });
    if (!lock.ok) return NextResponse.json({ error: lock.error }, { status: 400 });
    b.vendorCharge = lock.vendorCharge;
    b.vendorChargeT0 = lock.vendorChargeT0;
  }

  const { global: isGlobal, ...slabFields } = b;

  // Resolve target scheme(s).
  const targetSchemeIds: string[] = [];
  if (isGlobal) {
    const allSchemes = await prisma.scheme.findMany({
      where: { active: true },
      select: { id: true },
    });
    if (allSchemes.length === 0)
      return NextResponse.json({ error: "No active schemes found" }, { status: 404 });
    for (const s of allSchemes) targetSchemeIds.push(s.id);
  } else {
    const scheme = await prisma.scheme.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!scheme) return NextResponse.json({ error: "Scheme not found" }, { status: 404 });
    targetSchemeIds.push(params.id);
  }

  const floorErr = await validateMdrAgainstFloor(
    {
      serviceKind: b.serviceKind,
      paymentMode: b.paymentMode,
      mdrType: b.mdrType,
      mdrValue: b.mdrValue,
      mdrValueT0: b.mdrValueT0,
    },
    // A slab is pipeline/provider-agnostic — it must clear every rail floor.
    { matchAllScopes: true }
  );
  if (floorErr) return NextResponse.json({ error: floorErr }, { status: 400 });

  // POS uses the Minimum-MDR pool equality; other rails use the ≤-margin guard.
  const marginErr =
    b.serviceKind === "POS"
      ? validatePosCommissionEquality(b, posMinMdr, posMinMdrT0)
      : validateMarginVsCommission(b);
  if (marginErr) return NextResponse.json({ error: marginErr }, { status: 400 });

  // Validate overlap and create for each target scheme.
  const created: string[] = [];
  const skipped: string[] = [];
  for (const sid of targetSchemeIds) {
    const overlap = await validateMdrSlab(
      sid,
      b.serviceKind,
      b.paymentMode,
      { minAmount: b.minAmount, maxAmount: b.maxAmount },
      undefined,
      {
        company: b.company ?? null,
        cardType: b.cardType ?? null,
        brandType: b.brandType ?? null,
        classification: b.classification ?? null,
      }
    );
    if (overlap) {
      skipped.push(sid);
      continue;
    }

    const slab = await prisma.mdrSlab.create({
      data: {
        schemeId: sid,
        ...slabFields,
        company: slabFields.company ?? null,
        cardType: slabFields.cardType ?? null,
        brandType: slabFields.brandType ?? null,
        classification: slabFields.classification ?? null,
      },
    });
    created.push(slab.id);
  }

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: isGlobal ? "mdr_slab.created_global" : "mdr_slab.created",
      entity: "MdrSlab",
      entityId: created[0] ?? "none",
      meta: {
        schemeId: isGlobal ? targetSchemeIds : params.id,
        created: created.length,
        skipped: skipped.length,
        ...slabFields,
      },
      ip: clientIp(req),
    },
  });

  if (created.length === 0)
    return NextResponse.json(
      { error: "All target schemes already have an overlapping MDR slab for this configuration." },
      { status: 400 }
    );

  return NextResponse.json(
    {
      ok: true,
      slabId: created[0],
      created: created.length,
      skipped: skipped.length,
    },
    { status: 201 }
  );
}

const UpdateBody = z.object({
  slabId: z.string().min(1),
  paymentMode: z.string().min(1).max(30).optional(),
  company: z.string().trim().min(1).max(60).nullish(),
  cardType: z.string().trim().min(1).max(30).nullish(),
  brandType: z.string().trim().min(1).max(30).nullish(),
  classification: z.string().trim().min(1).max(30).nullish(),
  minAmount: z.number().nonnegative().optional().default(0),
  maxAmount: z.number().positive().optional().default(999999999),
  mdrType: z.enum(["FLAT", "PERCENT"]).optional(),
  mdrValue: z.number().nonnegative().optional(),
  mdrValueT0: z.number().nonnegative().optional(),
  vendorCharge: z.number().nonnegative().optional(),
  vendorChargeT0: z.number().nonnegative().optional(),
  commissionType: z.enum(["FLAT", "PERCENT"]).optional(),
  commissionDistributor: z.number().nonnegative().optional(),
  commissionMaster: z.number().nonnegative().optional(),
  commissionSuperDistributor: z.number().nonnegative().optional(),
  commissionDistributorT0: z.number().nonnegative().optional(),
  commissionMasterT0: z.number().nonnegative().optional(),
  commissionSuperDistributorT0: z.number().nonnegative().optional(),
  active: z.boolean().optional(),
});

/** PATCH — edit an MDR slab's values/dimensions (band-overlap revalidated). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const parsed = UpdateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { slabId, ...b } = parsed.data;

  const existing = await prisma.mdrSlab.findFirst({ where: { id: slabId, schemeId: params.id } });
  if (!existing) return NextResponse.json({ error: "Slab not found" }, { status: 404 });

  const next = {
    paymentMode: b.paymentMode ?? existing.paymentMode,
    company: b.company !== undefined ? b.company : existing.company,
    cardType: b.cardType !== undefined ? b.cardType : existing.cardType,
    brandType: b.brandType !== undefined ? b.brandType : existing.brandType,
    classification: b.classification !== undefined ? b.classification : existing.classification,
    minAmount: b.minAmount ?? Number(existing.minAmount),
    maxAmount: b.maxAmount ?? Number(existing.maxAmount),
  };

  const overlap = await validateMdrSlab(
    params.id,
    existing.serviceKind,
    next.paymentMode,
    { minAmount: next.minAmount, maxAmount: next.maxAmount },
    existing.id,
    {
      company: next.company ?? null,
      cardType: next.cardType ?? null,
      brandType: next.brandType ?? null,
      classification: next.classification ?? null,
    }
  );
  if (overlap) return NextResponse.json({ error: overlap }, { status: 400 });

  // POS: re-lock vendor to the approved brand rate when a pricing/dimension OR
  // commission field changes. Partial edits (e.g. toggling `active`) skip this
  // so they aren't blocked by legacy slabs.
  const pricingTouched =
    b.mdrValue !== undefined ||
    b.mdrValueT0 !== undefined ||
    b.mdrType !== undefined ||
    b.vendorCharge !== undefined ||
    b.company !== undefined ||
    b.paymentMode !== undefined;
  const commissionTouched =
    b.commissionType !== undefined ||
    b.commissionDistributor !== undefined ||
    b.commissionMaster !== undefined ||
    b.commissionSuperDistributor !== undefined ||
    b.commissionDistributorT0 !== undefined ||
    b.commissionMasterT0 !== undefined ||
    b.commissionSuperDistributorT0 !== undefined;
  let posMinMdr = 0;
  let posMinMdrT0 = 0;
  const posRevalidate = existing.serviceKind === "POS" && (pricingTouched || commissionTouched);
  if (posRevalidate) {
    if ((b.mdrType ?? existing.mdrType) !== "PERCENT" || (b.commissionType ?? existing.commissionType) !== "PERCENT")
      return NextResponse.json({ error: "POS MDR and commission must both be percentages." }, { status: 400 });
    const lock = await lockPosVendorToBrandRate({
      company: next.company,
      paymentMode: next.paymentMode,
      cardType: next.cardType,
      brandType: next.brandType,
      classification: next.classification,
      mdrType: b.mdrType ?? existing.mdrType,
      minAmount: next.minAmount,
    });
    if (!lock.ok) return NextResponse.json({ error: lock.error }, { status: 400 });
    b.vendorCharge = lock.vendorCharge;
    b.vendorChargeT0 = lock.vendorChargeT0;
    posMinMdr = lock.minMdr;
    posMinMdrT0 = lock.minMdrT0;
  }

  if ((existing.serviceKind === "PG" || existing.serviceKind === "QR") && pricingTouched) {
    const lock = await lockRailVendorToRate({
      serviceKind: existing.serviceKind,
      scopeKey: next.company,
      paymentMode: next.paymentMode,
      cardType: next.cardType,
      brandType: next.brandType,
      classification: next.classification,
      mdrType: b.mdrType ?? existing.mdrType,
      minAmount: next.minAmount,
    });
    if (!lock.ok) return NextResponse.json({ error: lock.error }, { status: 400 });
    b.vendorCharge = lock.vendorCharge;
    b.vendorChargeT0 = lock.vendorChargeT0;
  }

  const floorErr = await validateMdrAgainstFloor(
    {
      serviceKind: existing.serviceKind,
      paymentMode: next.paymentMode,
      mdrType: b.mdrType ?? existing.mdrType,
      mdrValue: b.mdrValue ?? Number(existing.mdrValue),
      mdrValueT0: b.mdrValueT0 ?? Number(existing.mdrValueT0),
    },
    { matchAllScopes: true }
  );
  if (floorErr) return NextResponse.json({ error: floorErr }, { status: 400 });

  const mergedForCheck = {
    mdrType: b.mdrType ?? existing.mdrType,
    mdrValue: b.mdrValue ?? Number(existing.mdrValue),
    mdrValueT0: b.mdrValueT0 ?? Number(existing.mdrValueT0),
    vendorCharge: b.vendorCharge ?? Number(existing.vendorCharge),
    vendorChargeT0: b.vendorChargeT0 ?? Number(existing.vendorChargeT0),
    commissionType: b.commissionType ?? existing.commissionType,
    commissionDistributor: b.commissionDistributor ?? Number(existing.commissionDistributor),
    commissionMaster: b.commissionMaster ?? Number(existing.commissionMaster),
    commissionSuperDistributor:
      b.commissionSuperDistributor ?? Number(existing.commissionSuperDistributor),
    commissionDistributorT0: b.commissionDistributorT0 ?? Number(existing.commissionDistributorT0),
    commissionMasterT0: b.commissionMasterT0 ?? Number(existing.commissionMasterT0),
    commissionSuperDistributorT0:
      b.commissionSuperDistributorT0 ?? Number(existing.commissionSuperDistributorT0),
  };

  // POS (when pricing/commission changed): enforce the Minimum-MDR pool
  // equality. Other rails keep the ≤-margin guard. Untouched POS edits (e.g.
  // active toggle) skip revalidation so legacy slabs aren't blocked.
  const marginErr = posRevalidate
    ? validatePosCommissionEquality(mergedForCheck, posMinMdr, posMinMdrT0)
    : existing.serviceKind === "POS"
    ? null
    : validateMarginVsCommission(mergedForCheck);
  if (marginErr) return NextResponse.json({ error: marginErr }, { status: 400 });

  const updated = await prisma.mdrSlab.update({
    where: { id: existing.id },
    data: {
      ...next,
      ...(b.mdrType !== undefined ? { mdrType: b.mdrType } : {}),
      ...(b.mdrValue !== undefined ? { mdrValue: b.mdrValue } : {}),
      ...(b.mdrValueT0 !== undefined ? { mdrValueT0: b.mdrValueT0 } : {}),
      ...(b.vendorCharge !== undefined ? { vendorCharge: b.vendorCharge } : {}),
      ...(b.vendorChargeT0 !== undefined ? { vendorChargeT0: b.vendorChargeT0 } : {}),
      ...(b.commissionType !== undefined ? { commissionType: b.commissionType } : {}),
      ...(b.commissionDistributor !== undefined ? { commissionDistributor: b.commissionDistributor } : {}),
      ...(b.commissionMaster !== undefined ? { commissionMaster: b.commissionMaster } : {}),
      ...(b.commissionSuperDistributor !== undefined
        ? { commissionSuperDistributor: b.commissionSuperDistributor }
        : {}),
      ...(b.commissionDistributorT0 !== undefined ? { commissionDistributorT0: b.commissionDistributorT0 } : {}),
      ...(b.commissionMasterT0 !== undefined ? { commissionMasterT0: b.commissionMasterT0 } : {}),
      ...(b.commissionSuperDistributorT0 !== undefined
        ? { commissionSuperDistributorT0: b.commissionSuperDistributorT0 }
        : {}),
      ...(b.active !== undefined ? { active: b.active } : {}),
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "mdr_slab.updated",
      entity: "MdrSlab",
      entityId: updated.id,
      meta: { schemeId: params.id, changes: b },
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true, slabId: updated.id });
}

const DeleteBody = z.object({ slabId: z.string().min(1) });

/** DELETE — remove an MDR slab. */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const parsed = DeleteBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const slab = await prisma.mdrSlab.findFirst({
    where: { id: parsed.data.slabId, schemeId: params.id },
  });
  if (!slab) return NextResponse.json({ error: "Slab not found" }, { status: 404 });

  await prisma.mdrSlab.delete({ where: { id: slab.id } });
  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "mdr_slab.deleted",
      entity: "MdrSlab",
      entityId: slab.id,
      meta: { schemeId: params.id },
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true });
}
