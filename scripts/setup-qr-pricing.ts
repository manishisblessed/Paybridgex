/**
 * QR pricing setup (idempotent, safe to re-run).
 *
 * Wires up everything the QR collection → settlement → commission flow needs so
 * the two admin "QR Collections" images can actually earn and distribute money:
 *
 *   1. Ensures the QR service route (qr_dynamic / provider NPCI) is enabled, so
 *      railScopeKey("QR") resolves the provider scope used at settlement.
 *   2. Creates/updates the QR VENDOR rate card (RailMdrRate, scopeKey = NPCI):
 *      the acquirer cost + Minimum-MDR floor. This is the "brands → QR" tab.
 *      Dimensions are wildcard (provider "*", brandType null) so the live
 *      settlement resolver (resolveRailMdr) matches it.
 *   3. Adds/updates a QR MDR slab (MdrSlab, serviceKind QR) on every ACTIVE
 *      scheme: what the retailer pays + the DT/MD/SD commission split. company
 *      is pinned to the provider scope (NPCI) exactly as the admin UI does, so
 *      the resolver matches it at pricing + distribution time.
 *
 * Nothing here settles a claim or moves money — it only writes configuration.
 * After --commit it VERIFIES by pricing a live ₹ sample through the real engine
 * (priceSchemeSettlement + getEffectiveMdr) for one ready retailer per scheme.
 *
 * Usage:
 *   npx tsx scripts/setup-qr-pricing.ts            # dry-run: print state + plan
 *   npx tsx scripts/setup-qr-pricing.ts --commit   # apply the plan, then verify
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

function loadEnvFile(): void {
  for (const file of [".env.local", ".env"]) {
    const p = resolve(process.cwd(), file);
    if (!existsSync(p)) continue;
    for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  }
}
loadEnvFile();

const COMMIT = process.argv.includes("--commit");
const QR_KEY = "qr_dynamic";
const QR_PROVIDER = "NPCI"; // ServiceRoute.provider for the QR rail (catalog seed)
const QR_BRAND_TYPE = "RUPAY"; // NPCI RuPay network — the settlement's default

// ---------------------------------------------------------------------------
// Tunable QR pricing (PERCENT units — 0.50 means 0.50%). Change these freely;
// the script re-validates invariants and is idempotent on re-run.
// ---------------------------------------------------------------------------
const PRICING = {
  band: { minAmount: 1, maxAmount: 100000 },

  // Vendor rate card (RailMdrRate) — the acquirer cost + downstream floor.
  vendorPct: 0.5, // acquirer cost, T+1 (next-day)
  vendorPctT0: 0.6, // acquirer cost, instant (T+0)
  minMdrPct: 0.7, // lowest MDR any scheme may charge, T+1 (vendor + guaranteed margin)
  minMdrPctT0: 0.8, // lowest MDR, instant

  // Scheme MDR slab — what the retailer actually pays.
  servicePct: 1.5, // retailer MDR, T+1
  servicePctT0: 1.75, // retailer MDR, instant

  // Upline commission split (retailer earns nothing). Sum must be <= the pool
  // (service − minMdr) per leg. T+0 tiers do NOT fall back to T+1.
  commT1: { dt: 0.4, md: 0.2, sd: 0.1 }, // sum 0.70 <= pool 0.80
  commT0: { dt: 0.45, md: 0.25, sd: 0.15 }, // sum 0.85 <= pool 0.95
};

const f = (pct: number) => pct / 100; // percent -> stored fraction
const pctStr = (frac: number) => `${(frac * 100).toFixed(2)}%`;

/** Abort early if the chosen numbers can't pass the app's own validators. */
function assertInvariants() {
  const errs: string[] = [];
  if (PRICING.minMdrPct < PRICING.vendorPct)
    errs.push(`Min MDR ${PRICING.minMdrPct}% < vendor ${PRICING.vendorPct}% (T+1)`);
  if (PRICING.minMdrPctT0 < PRICING.vendorPctT0)
    errs.push(`Min MDR ${PRICING.minMdrPctT0}% < vendor ${PRICING.vendorPctT0}% (T+0)`);
  if (PRICING.servicePct < PRICING.minMdrPct)
    errs.push(`Service ${PRICING.servicePct}% < Min MDR ${PRICING.minMdrPct}% (T+1)`);
  if (PRICING.servicePctT0 < PRICING.minMdrPctT0)
    errs.push(`Service ${PRICING.servicePctT0}% < Min MDR ${PRICING.minMdrPctT0}% (T+0)`);

  const poolT1 = PRICING.servicePct - PRICING.minMdrPct;
  const sumT1 = PRICING.commT1.dt + PRICING.commT1.md + PRICING.commT1.sd;
  if (sumT1 - poolT1 > 1e-9)
    errs.push(`Commission T+1 sum ${sumT1}% exceeds pool ${poolT1.toFixed(2)}% (service − minMdr)`);

  const poolT0 = PRICING.servicePctT0 - PRICING.minMdrPctT0;
  const sumT0 = PRICING.commT0.dt + PRICING.commT0.md + PRICING.commT0.sd;
  if (sumT0 - poolT0 > 1e-9)
    errs.push(`Commission T+0 sum ${sumT0}% exceeds pool ${poolT0.toFixed(2)}% (T+0 service − minMdr)`);

  if (errs.length) {
    console.error("\n✗ Pricing invariants failed — fix PRICING before running:\n  - " + errs.join("\n  - "));
    process.exit(1);
  }
}

async function main() {
  assertInvariants();

  const { prisma } = await import("../src/lib/db");

  console.log(`\n=== QR pricing setup (${COMMIT ? "COMMIT" : "DRY-RUN"}) ===\n`);

  // ---- Resolve provider scope + current state ----------------------------
  const [route, floors, existingRates, activeSchemes, revenueOwner, activeQrs] = await Promise.all([
    prisma.serviceRoute.findUnique({ where: { key: QR_KEY } }),
    prisma.companyMdrFloor.findMany({ where: { serviceKind: "QR", active: true } }),
    prisma.railMdrRate.findMany({ where: { serviceKind: "QR" } }),
    prisma.scheme.findMany({ where: { active: true }, select: { id: true, name: true, isDefault: true } }),
    prisma.user.findFirst({ where: { role: "MASTER_ADMIN", deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
    prisma.staticQr.findMany({ where: { active: true }, select: { label: true } }),
  ]);

  const scope = route?.provider ?? QR_PROVIDER;

  console.log("CURRENT STATE:");
  console.log(`  QR route (${QR_KEY})     : ${route ? `${route.enabled ? "enabled" : "DISABLED"}, provider=${route.provider ?? "—"}` : "MISSING (will create)"}`);
  console.log(`  Provider scope (scopeKey): ${scope}`);
  console.log(`  Active StaticQr images   : ${activeQrs.length}${activeQrs.length ? " → " + activeQrs.map((q) => q.label).join(", ") : "  ⚠ none live"}`);
  console.log(`  Revenue account          : ${revenueOwner ? revenueOwner.name : "⚠ NONE (no MASTER_ADMIN)"}`);
  console.log(`  Existing QR vendor rates : ${existingRates.length}`);
  console.log(`  QR company floors        : ${floors.length}${floors.map((fl) => ` [${pctStr(Number(fl.mdrValue))}]`).join("")}`);
  console.log(`  Active schemes           : ${activeSchemes.length} → ${activeSchemes.map((s) => s.name + (s.isDefault ? " (default)" : "")).join(", ") || "none"}`);

  console.log("\nPLANNED PRICING (scope = " + scope + "):");
  console.log(`  Vendor cost   : ${PRICING.vendorPct}%  (T+1)   ${PRICING.vendorPctT0}%  (instant)`);
  console.log(`  Min MDR floor : ${PRICING.minMdrPct}%  (T+1)   ${PRICING.minMdrPctT0}%  (instant)`);
  console.log(`  Retailer MDR  : ${PRICING.servicePct}%  (T+1)   ${PRICING.servicePctT0}%  (instant)`);
  console.log(`  Commission T+1: DT ${PRICING.commT1.dt}%  MD ${PRICING.commT1.md}%  SD ${PRICING.commT1.sd}%  (pool ${(PRICING.servicePct - PRICING.minMdrPct).toFixed(2)}%)`);
  console.log(`  Commission T+0: DT ${PRICING.commT0.dt}%  MD ${PRICING.commT0.md}%  SD ${PRICING.commT0.sd}%  (pool ${(PRICING.servicePctT0 - PRICING.minMdrPctT0).toFixed(2)}%)`);

  if (!COMMIT) {
    console.log("\n(dry-run) Re-run with --commit to apply the plan and verify live pricing.\n");
    await prisma.$disconnect();
    return;
  }

  // ---- 1. Ensure the QR route exists + is enabled ------------------------
  if (!route) {
    await prisma.serviceRoute.create({
      data: {
        key: QR_KEY,
        name: "QR Payments",
        type: "SERVICE",
        kind: "QR",
        provider: QR_PROVIDER,
        enabled: true,
        note: "Static / dynamic UPI QR collections.",
        sortOrder: 40,
      },
    });
    console.log(`\n✓ Created + enabled QR route (${QR_KEY}, provider ${QR_PROVIDER}).`);
  } else {
    const patch: { enabled?: boolean; provider?: string } = {};
    if (!route.enabled) patch.enabled = true;
    if (!route.provider) patch.provider = QR_PROVIDER;
    if (Object.keys(patch).length) {
      await prisma.serviceRoute.update({ where: { id: route.id }, data: patch });
      console.log(`\n✓ Updated QR route (${Object.keys(patch).join(", ")}).`);
    } else {
      console.log(`\n• QR route already enabled with provider ${route.provider}.`);
    }
  }

  // ---- 2. Upsert the QR vendor rate card (RailMdrRate) -------------------
  // Wildcard dims (provider "*", brandType null) so the live resolveRailMdr —
  // which passes no provider/brandType — matches it at settlement.
  const rateWhere = {
    serviceKind: "QR" as const,
    scopeKey: scope,
    provider: "*",
    paymentMode: "UPI",
    cardType: null,
    brandType: null,
    classification: null,
  };
  const rateValues = {
    scopeLabel: scope,
    minAmount: PRICING.band.minAmount,
    maxAmount: PRICING.band.maxAmount,
    mdrType: "PERCENT" as const,
    mdrValue: f(PRICING.vendorPct),
    mdrValueT0: f(PRICING.vendorPctT0),
    minMdrValue: f(PRICING.minMdrPct),
    minMdrValueT0: f(PRICING.minMdrPctT0),
    active: true,
  };
  const existingRate = await prisma.railMdrRate.findFirst({ where: rateWhere });
  if (existingRate) {
    await prisma.railMdrRate.update({ where: { id: existingRate.id }, data: rateValues });
    console.log(`✓ Updated QR vendor rate card for ${scope}.`);
  } else {
    await prisma.railMdrRate.create({ data: { ...rateWhere, ...rateValues } });
    console.log(`✓ Created QR vendor rate card for ${scope}.`);
  }

  // ---- 3. Upsert a QR MDR slab on every active scheme --------------------
  const slabValues = {
    minAmount: PRICING.band.minAmount,
    maxAmount: PRICING.band.maxAmount,
    mdrType: "PERCENT" as const,
    mdrValue: f(PRICING.servicePct),
    mdrValueT0: f(PRICING.servicePctT0),
    vendorCharge: f(PRICING.vendorPct),
    vendorChargeT0: f(PRICING.vendorPctT0),
    commissionType: "PERCENT" as const,
    commissionRetailer: 0,
    commissionDistributor: f(PRICING.commT1.dt),
    commissionMaster: f(PRICING.commT1.md),
    commissionSuperDistributor: f(PRICING.commT1.sd),
    commissionDistributorT0: f(PRICING.commT0.dt),
    commissionMasterT0: f(PRICING.commT0.md),
    commissionSuperDistributorT0: f(PRICING.commT0.sd),
    active: true,
  };
  const slabWhere = {
    serviceKind: "QR" as const,
    paymentMode: "UPI",
    company: scope, // provider scope, exactly like the admin modal
    cardType: null,
    brandType: null,
    classification: null,
  };

  let created = 0;
  let updated = 0;
  for (const scheme of activeSchemes) {
    const existingSlab = await prisma.mdrSlab.findFirst({ where: { schemeId: scheme.id, ...slabWhere } });
    if (existingSlab) {
      await prisma.mdrSlab.update({ where: { id: existingSlab.id }, data: slabValues });
      updated++;
    } else {
      await prisma.mdrSlab.create({ data: { schemeId: scheme.id, ...slabWhere, ...slabValues } });
      created++;
    }
  }
  console.log(`✓ QR MDR slabs: ${created} created, ${updated} updated across ${activeSchemes.length} active scheme(s).`);

  // ---- 4. Verify with LIVE pricing (read-only; no money moves) -----------
  await verify(prisma, scope);

  await prisma.$disconnect();
}

/**
 * Prove the config works by pricing a ₹ sample through the real settlement +
 * MDR engine for one ready retailer per distinct scheme. This calls the same
 * pure functions the settlement uses — it never settles or credits anything.
 */
async function verify(prisma: import("@prisma/client").PrismaClient, scope: string) {
  const { getEffectiveMdr } = await import("../src/lib/mdr/resolver");
  const { priceSchemeSettlement } = await import("../src/lib/settlement/engine");

  const SAMPLE = 10000; // ₹ gross collection used for the demonstration
  const TDS = 0.02;

  console.log(`\n=== VERIFY — live pricing of a ₹${SAMPLE.toLocaleString("en-IN")} QR collection ===`);

  const retailers = await prisma.user.findMany({
    where: { role: "RETAILER", status: "ACTIVE", schemeId: { not: null }, parentId: { not: null } },
    select: { id: true, name: true, userCode: true, schemeId: true },
    orderBy: { createdAt: "asc" },
  });

  const seenSchemes = new Set<string>();
  let shown = 0;
  for (const r of retailers) {
    if (!r.schemeId || seenSchemes.has(r.schemeId)) continue;

    for (const leg of ["T1", "T0"] as const) {
      const mdr = await getEffectiveMdr(r.id, "QR", SAMPLE, {
        paymentMode: "UPI",
        company: scope,
        brandType: QR_BRAND_TYPE,
        settlementType: leg,
      });
      if (mdr.source === "NONE") {
        // Slab didn't resolve for this scheme (e.g. company mismatch) — report it.
        if (leg === "T1") console.log(`\n  ⚠ ${r.name} [${r.userCode ?? "—"}] — no QR slab resolved for scheme ${r.schemeId}`);
        continue;
      }
      const price = await priceSchemeSettlement({
        userId: r.id,
        serviceKind: "QR",
        grossAmount: SAMPLE,
        paymentMode: "UPI",
        brandType: QR_BRAND_TYPE,
        settlementType: leg,
        scopeKey: scope,
      });

      const dt = Number(mdr.commission.distributor);
      const md = Number(mdr.commission.master);
      const sd = Number(mdr.commission.superDistributor);
      const grossComm = dt + md + sd;
      const mdrAmt = Number(mdr.mdr);
      const vendorAmt = price ? Number(price.vendorAmount ?? 0) : Number(mdr.vendor);
      const companyMargin = mdrAmt - vendorAmt;

      if (leg === "T1") console.log(`\n  ${r.name} [${r.userCode ?? "—"}]  scheme=${r.schemeId}`);
      console.log(`    ${leg === "T1" ? "T+1 (next-day)" : "T+0 (instant) "}: ` +
        `MDR ₹${mdrAmt.toFixed(2)} | retailer net ₹${(price ? Number(price.netAmount) : SAMPLE - mdrAmt).toFixed(2)} | ` +
        `vendor ₹${vendorAmt.toFixed(2)} | company margin ₹${companyMargin.toFixed(2)}`);
      console.log(`                    commission → DT ₹${dt.toFixed(2)}  MD ₹${md.toFixed(2)}  SD ₹${sd.toFixed(2)} ` +
        `(gross ₹${grossComm.toFixed(2)}, net after 2% TDS ₹${(grossComm * (1 - TDS)).toFixed(2)}) | ` +
        `company keeps ₹${(companyMargin - grossComm).toFixed(2)} in Revenue`);
    }

    seenSchemes.add(r.schemeId);
    if (++shown >= 5) break; // cap the demo output
  }

  if (shown === 0) {
    console.log("\n  (no ACTIVE retailer with a scheme + upline found to demo pricing — configuration is still applied)");
  }
  console.log("");
}

main().catch((e) => {
  console.error("\n✗ Setup failed:", e);
  process.exit(1);
});
