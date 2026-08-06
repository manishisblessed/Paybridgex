/**
 * Align settlement config to the "retailer chooses instant + morning T+1" model.
 *
 * Goal: STOP booking Revenue Wallet margin + DT/MD/SD commission at
 * transaction/capture time. Instead:
 *   • captures land PENDING (no auto-instant),
 *   • retailer may instant-settle (T0) a chosen subset → commission booked then,
 *   • everything else is swept by the morning T+1 cron → commission booked then.
 *
 * This is a CONFIG change only (no code, no money moved). It:
 *   1. Turns OFF global auto-instant (POS + PG).
 *   2. Clears per-user auto-instant overrides (User.instantSettlement = false).
 *   3. Un-pins any brand pinned to INSTANT (settlementMode INSTANT → BOTH).
 *   4. Enables the retailer-facing instant-settle button (POS/PG/QR).
 *   5. Ensures the morning T+1 crons are enabled + un-paused.
 *
 * Idempotent + re-runnable. Prints BEFORE and AFTER state.
 *
 * Run (PowerShell, repo root):
 *   npx tsx scripts/align-settlement-config.ts            # dry-run (inspect only)
 *   $env:APPLY="1"; npx tsx scripts/align-settlement-config.ts   # apply changes
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

const APPLY = process.env.APPLY === "1";

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { getSetting, setSetting } = await import("../src/lib/settings");

  const line = (s: string) => console.log(s);
  line(`\n=== Settlement config alignment (${APPLY ? "APPLY" : "DRY-RUN"}) ===\n`);

  // ---- BEFORE ----
  const [posInstant, pgInstant, posT1, pgT1, qrT1, instantBtn] = await Promise.all([
    getSetting("settlement.pos_instant"),
    getSetting("settlement.pg_instant"),
    getSetting("settlement.pos_t1"),
    getSetting("settlement.pg_t1"),
    getSetting("settlement.qr_t1"),
    getSetting("settlement.instant_button"),
  ]);
  const usersAutoInstant = await prisma.user.count({ where: { instantSettlement: true } });
  const brandsInstant = await prisma.brand.count({ where: { settlementMode: "INSTANT" } });

  line("BEFORE:");
  line(`  settlement.pos_instant.defaultEnabled : ${posInstant.defaultEnabled}`);
  line(`  settlement.pg_instant.defaultEnabled  : ${pgInstant.defaultEnabled}`);
  line(`  settlement.pos_t1   enabled/paused/hour: ${posT1.enabled}/${posT1.paused}/${posT1.hour}`);
  line(`  settlement.pg_t1    enabled/paused/hour: ${pgT1.enabled}/${pgT1.paused}/${pgT1.hour}`);
  line(`  settlement.qr_t1    enabled/paused/hour: ${qrT1.enabled}/${qrT1.paused}/${qrT1.hour}`);
  line(`  settlement.instant_button pos/pg/qr    : ${instantBtn.posEnabled}/${instantBtn.pgEnabled}/${instantBtn.qrEnabled}`);
  line(`  Users with instantSettlement=true      : ${usersAutoInstant}`);
  line(`  Brands pinned settlementMode=INSTANT   : ${brandsInstant}`);

  if (!APPLY) {
    line("\n(DRY-RUN — no changes written. Re-run with APPLY=1 to apply.)\n");
    await prisma.$disconnect();
    return;
  }

  // ---- APPLY ----
  line("\nApplying changes…");

  await setSetting("settlement.pos_instant", { ...posInstant, defaultEnabled: false });
  await setSetting("settlement.pg_instant", { ...pgInstant, defaultEnabled: false });

  // Ensure the morning T+1 crons run (keep configured hour/minAmount).
  await setSetting("settlement.pos_t1", { ...posT1, enabled: true, paused: false });
  await setSetting("settlement.pg_t1", { ...pgT1, enabled: true, paused: false });
  await setSetting("settlement.qr_t1", { ...qrT1, enabled: true, paused: false });

  // Expose the retailer-facing instant-settle button on all three rails so a
  // retailer can pick which transactions to fast-settle (T0); the rest ride T+1.
  await setSetting("settlement.instant_button", {
    posEnabled: true,
    pgEnabled: true,
    qrEnabled: true,
  });

  const clearedUsers = await prisma.user.updateMany({
    where: { instantSettlement: true },
    data: { instantSettlement: false },
  });
  const unpinnedBrands = await prisma.brand.updateMany({
    where: { settlementMode: "INSTANT" },
    data: { settlementMode: "BOTH" },
  });

  line(`  ✓ pos_instant.defaultEnabled → false`);
  line(`  ✓ pg_instant.defaultEnabled → false`);
  line(`  ✓ pos_t1 / pg_t1 / qr_t1 → enabled, un-paused`);
  line(`  ✓ instant_button → pos/pg/qr enabled`);
  line(`  ✓ Users un-set instantSettlement: ${clearedUsers.count}`);
  line(`  ✓ Brands INSTANT → BOTH: ${unpinnedBrands.count}`);

  // ---- AFTER ----
  const [a1, a2, a3, a4, a5, a6] = await Promise.all([
    getSetting("settlement.pos_instant"),
    getSetting("settlement.pg_instant"),
    getSetting("settlement.pos_t1"),
    getSetting("settlement.pg_t1"),
    getSetting("settlement.qr_t1"),
    getSetting("settlement.instant_button"),
  ]);
  const usersAfter = await prisma.user.count({ where: { instantSettlement: true } });
  const brandsAfter = await prisma.brand.count({ where: { settlementMode: "INSTANT" } });

  line("\nAFTER:");
  line(`  settlement.pos_instant.defaultEnabled : ${a1.defaultEnabled}`);
  line(`  settlement.pg_instant.defaultEnabled  : ${a2.defaultEnabled}`);
  line(`  settlement.pos_t1   enabled/paused/hour: ${a3.enabled}/${a3.paused}/${a3.hour}`);
  line(`  settlement.pg_t1    enabled/paused/hour: ${a4.enabled}/${a4.paused}/${a4.hour}`);
  line(`  settlement.qr_t1    enabled/paused/hour: ${a5.enabled}/${a5.paused}/${a5.hour}`);
  line(`  settlement.instant_button pos/pg/qr    : ${a6.posEnabled}/${a6.pgEnabled}/${a6.qrEnabled}`);
  line(`  Users with instantSettlement=true      : ${usersAfter}`);
  line(`  Brands pinned settlementMode=INSTANT   : ${brandsAfter}`);

  line("\n✓ Alignment complete. Captures now queue PENDING; commission + Revenue");
  line("  Wallet margin are booked at settlement (retailer instant subset, or the");
  line("  morning T+1 cron), never at transaction time.\n");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("\n✗ Alignment failed:", e);
  process.exit(1);
});
