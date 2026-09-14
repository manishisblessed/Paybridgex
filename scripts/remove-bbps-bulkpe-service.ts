/**
 * One-off cleanup: remove the retired "Unified Bill Payment Platform"
 * (BBPS-2 / BulkPe) service route from the database.
 *
 * The rail was removed from the code (catalog, sidebar, page, routing) — its
 * utility categories now ride Bharat BillPay (bbps_sameday). The seeder only
 * upserts, so the historical `bbps_bulkpe_svc` ServiceRoute row lingers and
 * keeps rendering a "Unified Bill Payment Platform" brand card under
 * Brands & MDR → Services → BBPS. This pass deletes that orphan and any
 * dangling references so the card disappears.
 *
 * What it removes (all keyed to the retired service key "bbps_bulkpe_svc"):
 *   - the ServiceRoute row (the brand card / rate-card scope),
 *   - any RailMdrRate rows scoped to it (rate cards, if any),
 *   - the key from every user's `enabledServices` allowlist.
 *
 * NOTE: the legacy pricing CONFIG key "bbps_bulkpe" is intentionally KEPT —
 * pre-existing scheme slabs may still be pinned to it and it is not a visible
 * brand (type = CONFIG). This script never touches it.
 *
 * SAFETY: dry-run by default (writes NOTHING). Pass `--apply` to persist.
 * Idempotent: re-running after --apply is a no-op.
 *
 * Run (repo root, DATABASE_URL set):
 *   npx tsx scripts/remove-bbps-bulkpe-service.ts            # dry-run (preview)
 *   npx tsx scripts/remove-bbps-bulkpe-service.ts --apply    # write
 */
import "./_load-env";
import { prisma } from "../src/lib/db";

/** The retired Unified Bill Payment Platform service key (BBPS-2 / BulkPe). */
const RETIRED_KEY = "bbps_bulkpe_svc";

const APPLY = process.argv.includes("--apply");

async function main() {
  const [route, rateCount, usersWithKey] = await Promise.all([
    prisma.serviceRoute.findUnique({
      where: { key: RETIRED_KEY },
      select: { id: true, key: true, name: true },
    }),
    prisma.railMdrRate.count({ where: { scopeKey: RETIRED_KEY } }),
    prisma.user.count({ where: { enabledServices: { has: RETIRED_KEY } } }),
  ]);

  if (!route && rateCount === 0 && usersWithKey === 0) {
    console.log(
      `Nothing to remove — "${RETIRED_KEY}" is already absent from ServiceRoute, RailMdrRate, and every user allowlist.`
    );
    return;
  }

  console.log(`${APPLY ? "APPLYING" : "DRY-RUN"} — remove retired service "${RETIRED_KEY}":\n`);
  console.log(`  ServiceRoute row (brand card):        ${route ? `1 (${route.name})` : "0"}`);
  console.log(`  RailMdrRate rows scoped to it:        ${rateCount}`);
  console.log(`  User allowlists containing the key:   ${usersWithKey}\n`);

  if (!APPLY) {
    console.log("Dry-run only — nothing written. Re-run with --apply to persist.");
    return;
  }

  // Strip the key from any user allowlist that still carries it.
  const affected = await prisma.user.findMany({
    where: { enabledServices: { has: RETIRED_KEY } },
    select: { id: true, enabledServices: true },
  });
  for (const u of affected) {
    await prisma.user.update({
      where: { id: u.id },
      data: { enabledServices: u.enabledServices.filter((k) => k !== RETIRED_KEY) },
    });
  }

  const [ratesDeleted, routeDeleted] = await prisma.$transaction([
    prisma.railMdrRate.deleteMany({ where: { scopeKey: RETIRED_KEY } }),
    prisma.serviceRoute.deleteMany({ where: { key: RETIRED_KEY } }),
  ]);

  console.log(
    `✔ Removed — ServiceRoute: ${routeDeleted.count}, RailMdrRate: ${ratesDeleted.count}, allowlists cleaned: ${affected.length}.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
