/**
 * Enable/disable the Payment Gateway service route (key `pg_razorpay`), which
 * gates self-service wallet top-ups (`assertServiceEnabled(SERVICE_KEYS.PG)`).
 *
 * Turn it OFF while no live PG (BulkPe/Razorpay) is configured, so users get a
 * clean "unavailable" instead of hitting the mock provider.
 *
 *   npx tsx scripts/toggle-pg-service.ts off   # disable (default)
 *   npx tsx scripts/toggle-pg-service.ts on    # re-enable
 */
import "./_load-env";
import { prisma } from "../src/lib/db";

const KEY = "pg_razorpay";
const arg = (process.argv[2] ?? "off").toLowerCase();
const enabled = arg === "on";

async function main() {
  const before = await prisma.serviceRoute.findUnique({
    where: { key: KEY },
    select: { key: true, name: true, enabled: true },
  });
  if (!before) {
    // eslint-disable-next-line no-console
    console.error(`ServiceRoute '${KEY}' not found. Run 'npm run db:seed:services' first.`);
    process.exit(1);
  }

  const updated = await prisma.serviceRoute.update({
    where: { key: KEY },
    data: { enabled },
    select: { key: true, name: true, enabled: true },
  });

  // eslint-disable-next-line no-console
  console.log(
    `[toggle-pg-service] ${updated.name} (${updated.key}): ${before.enabled ? "ENABLED" : "DISABLED"} -> ${updated.enabled ? "ENABLED" : "DISABLED"}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
