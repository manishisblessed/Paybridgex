/**
 * Backfill network users' service allowlist (`User.enabledServices`) to the
 * per-tier DEFAULT configured in Network Manager (`network.default_services`).
 *
 * WHY: network users (RETAILER / DISTRIBUTOR / MASTER_DISTRIBUTOR /
 * SUPER_DISTRIBUTOR) are default-disabled — an empty `enabledServices` means NO
 * access, and each rail is granted explicitly. This one-off pass resets EXISTING
 * users of each tier to that tier's configured default set, so the "disabled by
 * default, enable manually" policy applies retroactively. With no default
 * configured (the ship state), every network user is reset to `[]` (all services
 * off), which is the intended clean slate.
 *
 * This OVERWRITES each matched user's `enabledServices` with the tier default —
 * any manual per-user grants are replaced. Staff roles (SUPPORT/ADMIN/
 * MASTER_ADMIN) are never touched (they bypass the allowlist entirely).
 *
 * SAFETY: dry-run by default (writes NOTHING). Pass `--apply` to persist.
 *
 * Run (repo root, DATABASE_URL set):
 *   npx tsx scripts/backfill-network-services.ts            # dry-run (preview)
 *   npx tsx scripts/backfill-network-services.ts --apply    # write
 */
import "./_load-env";
import { prisma } from "../src/lib/db";
import { NETWORK_ROLES, getSetting } from "../src/lib/settings";

const APPLY = process.argv.includes("--apply");

async function main() {
  const defaults = await getSetting("network.default_services");

  console.log(`${APPLY ? "APPLYING" : "DRY-RUN"} — reset network users' enabledServices to tier defaults:\n`);

  let grandTotal = 0;
  for (const role of NETWORK_ROLES) {
    const target = defaults[role] ?? [];
    const count = await prisma.user.count({ where: { role, deletedAt: null } });
    grandTotal += count;
    const label = role.replace(/_/g, " ").toLowerCase();
    const svcLabel = target.length === 0 ? "(none — all services off)" : target.join(", ");
    console.log(`  ${label.padEnd(20)} ${String(count).padStart(6)} user(s)  ->  ${svcLabel}`);

    if (APPLY && count > 0) {
      await prisma.user.updateMany({
        where: { role, deletedAt: null },
        data: { enabledServices: target },
      });
    }
  }

  console.log(`\n  ${grandTotal} network user(s) across ${NETWORK_ROLES.length} tiers.\n`);

  if (!APPLY) {
    console.log("Dry-run only — nothing written. Re-run with --apply to persist.");
    return;
  }
  console.log("✔ Backfill complete — every network user reset to its tier default.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
