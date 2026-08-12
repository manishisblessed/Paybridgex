/**
 * Backfill the vendor cost (and, where unambiguous, the price scope) on historical
 * BBPS/CC bill-payment transactions.
 *
 * Per-product pricing snapshots `Transaction.vendorCharge` (the upstream cost) and
 * `Transaction.priceScope` (which product priced it) at pay time. Rows created
 * before that existed carry `vendorCharge = 0` / `priceScope = null`, so the
 * revenue report treats their whole ex-GST charge as revenue (overstated by the
 * vendor cost). This one-off pass locks the CURRENT rate-card vendor cost onto
 * those rows so per-product revenue = charge − GST − vendor is accurate.
 *
 * Scope derivation (from Transaction.partner, best effort):
 *   - *RECHARGEKIT* → rechargekit_cc            (Same Day RechargeKit CC)
 *   - *BULKPE*      → bbps_bulkpe_svc            (Unified Bill Payment Platform)
 *   - *SAMEDAY/PAY2NEW* → bbps_credit_card for BILL_CREDIT_CARD, else bbps_sameday
 * `priceScope` is only written when it was null AND a scope was derived; a scope
 * already stored is respected and never overwritten. The Same Day CC guess
 * (bbps_credit_card) is a heuristic — old Same Day CC txns didn't record product.
 *
 * The vendor cost itself is resolved through the SAME logic the app uses
 * (`resolveServiceVendorInfo`: exact scope → partner family), so rows only get a
 * cost when a matching active rate card exists today; otherwise they stay 0.
 *
 * SAFETY: dry-run by default (writes NOTHING). Pass `--apply` to persist. The
 * `vendorCharge = 0` filter keeps re-runs idempotent (a locked row is skipped).
 * Payout history is intentionally NOT backfilled (no provider is stored on old
 * PayoutRequest rows to resolve the card unambiguously; it is captured going
 * forward at quote time).
 *
 * Run (repo root, DATABASE_URL set):
 *   npx tsx scripts/backfill-service-vendor.ts            # dry-run (preview only)
 *   npx tsx scripts/backfill-service-vendor.ts --apply    # write
 */
import "./_load-env";
import type { ServiceCode } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { resolveServiceVendorInfo } from "../src/lib/scheme/serviceVendor";
import { BBPS_PRICE_SCOPES } from "../src/lib/services/priceScope";

const BBPS_SERVICES: ServiceCode[] = [
  "BILL_ELECTRICITY",
  "BILL_WATER",
  "BILL_GAS",
  "BILL_CREDIT_CARD",
  "BILL_EDUCATION",
  "BILL_INSURANCE",
] as ServiceCode[];

const APPLY = process.argv.includes("--apply");

/** Best-effort product scope for an old txn from its partner tag + service. */
function deriveScope(
  partner: string | null,
  service: string
): string | null {
  const p = (partner ?? "").toUpperCase();
  if (p.includes("RECHARGEKIT")) return BBPS_PRICE_SCOPES.RECHARGEKIT_CC;
  if (p.includes("BULKPE")) return BBPS_PRICE_SCOPES.BBPS_BULKPE;
  if (p.includes("SAMEDAY") || p.includes("PAY2NEW")) {
    return service === "BILL_CREDIT_CARD"
      ? BBPS_PRICE_SCOPES.BBPS_CREDIT_CARD
      : BBPS_PRICE_SCOPES.BBPS_SAMEDAY;
  }
  return null;
}

type Plan = { id: string; vendor: number; setScope: string | null };

async function main() {
  const rows = await prisma.transaction.findMany({
    where: { status: "SUCCESS", vendorCharge: 0, service: { in: BBPS_SERVICES } },
    select: { id: true, service: true, amount: true, partner: true, priceScope: true },
  });

  if (rows.length === 0) {
    console.log("Nothing to backfill — every eligible BBPS transaction already has a vendor cost locked.");
    return;
  }

  // Cache vendor lookups by (service, scope) — BBPS cards are flat single-tier,
  // so the resolved vendor cost is stable regardless of the txn amount.
  const vendorCache = new Map<string, number | null>();
  const resolveVendor = async (service: ServiceCode, scope: string, amount: number): Promise<number | null> => {
    const key = `${service}|${scope}`;
    if (vendorCache.has(key)) return vendorCache.get(key)!;
    const info = await resolveServiceVendorInfo({ service, provider: scope, amount });
    const v = info ? info.vendorCharge : null;
    vendorCache.set(key, v);
    return v;
  };

  const plans: Plan[] = [];
  let unresolved = 0;
  for (const r of rows) {
    const existingScope = r.priceScope;
    const derived = deriveScope(r.partner, r.service);
    const lookupScope = existingScope ?? derived;
    if (!lookupScope) {
      unresolved++;
      continue;
    }
    const vendor = await resolveVendor(r.service, lookupScope, Number(r.amount));
    if (vendor == null || vendor <= 0) {
      unresolved++;
      continue;
    }
    plans.push({ id: r.id, vendor, setScope: existingScope ? null : derived });
  }

  // Summarise by (vendor, scope-to-set) for a readable preview + batched writes.
  const groups = new Map<string, { vendor: number; setScope: string | null; ids: string[] }>();
  for (const p of plans) {
    const key = `${p.vendor}|${p.setScope ?? "KEEP"}`;
    const g = groups.get(key) ?? { vendor: p.vendor, setScope: p.setScope, ids: [] };
    g.ids.push(p.id);
    groups.set(key, g);
  }

  console.log(`${APPLY ? "APPLYING" : "DRY-RUN"} — historical BBPS Transaction.vendorCharge backfill:\n`);
  console.log(`  Candidates (SUCCESS, vendorCharge=0, BILL_*): ${rows.length}`);
  console.log(`  Resolvable (a current rate card matched):     ${plans.length}`);
  console.log(`  Left as-is (no scope / no card):              ${unresolved}\n`);

  let totalVendor = 0;
  for (const g of groups.values()) {
    totalVendor += g.vendor * g.ids.length;
    const scopeLabel = g.setScope ? `set priceScope=${g.setScope}` : "keep priceScope";
    console.log(`  vendor ₹${g.vendor.toLocaleString("en-IN")}   ${String(g.ids.length).padStart(6)} rows   (${scopeLabel})`);
  }
  console.log(`\n  TOTAL vendor cost to lock: ₹${totalVendor.toLocaleString("en-IN")} across ${plans.length} rows\n`);

  if (!APPLY) {
    console.log("Dry-run only — nothing written. Re-run with --apply to persist.");
    console.log("NOTE: Same Day credit-card rows are assumed to be 'bbps_credit_card' (a heuristic).");
    console.log("NOTE: Payout history is not backfilled (no provider stored to resolve the card).");
    return;
  }

  let updated = 0;
  for (const g of groups.values()) {
    const res = await prisma.transaction.updateMany({
      where: { id: { in: g.ids } },
      data: {
        vendorCharge: g.vendor,
        ...(g.setScope ? { priceScope: g.setScope } : {}),
      },
    });
    updated += res.count;
  }
  console.log(`✔ Backfill complete — updated ${updated} transaction(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
