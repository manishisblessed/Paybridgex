// Read-only diagnostic for the RechargeKit (Credit Card Bill Payment-2) rail.
//   Run:  npx tsx scripts/diag-rechargekit.ts
// Verifies the runtime prerequisites without printing any secrets:
//   1. The `rechargekit_cc` ServiceRoute row exists and is enabled.
//   2. Same Day credentials resolve (RechargeKit keys or POS fallback).
//   3. At least one active scheme has a BILL_CREDIT_CARD slab that the
//      SAMEDAY provider family can match (so charges/commission resolve).
//   4. How many retailers are attached to such a scheme (can transact today).
import "./_load-env";
import { PrismaClient } from "@prisma/client";
import { samedayCredentials } from "../src/lib/partners/sameday-core";
import { normalizeProviderTag } from "../src/lib/scheme/resolver";

const prisma = new PrismaClient();

function line(label: string, ok: boolean, detail = "") {
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log("\n=== RechargeKit / Credit Card Bill Payment-2 diagnostic ===\n");

  // 1. Service route row
  const route = await prisma.serviceRoute.findUnique({
    where: { key: "rechargekit_cc" },
    select: { name: true, enabled: true, type: true, kind: true },
  });
  line(
    "ServiceRoute rechargekit_cc exists & enabled",
    !!route && route.enabled && route.type === "SERVICE",
    route
      ? `name="${route.name}", enabled=${route.enabled}, type=${route.type}, kind=${route.kind}`
      : "row not found — run: npm run db:seed:services"
  );

  // 2. Credentials (presence only, never printed)
  const creds = samedayCredentials("RECHARGEKIT");
  line(
    "Same Day credentials resolve (RechargeKit or POS fallback)",
    !!creds,
    creds ? `baseUrl=${creds.baseUrl}` : "set SAMEDAY_RECHARGEKIT_API_KEY/SECRET or SAMEDAY_POS_API_KEY/SECRET"
  );

  // 3. BILL_CREDIT_CARD slabs on active schemes, matchable by SAMEDAY family
  const slabs = await prisma.schemeSlab.findMany({
    where: { service: "BILL_CREDIT_CARD", active: true, scheme: { active: true } },
    select: {
      minAmount: true,
      maxAmount: true,
      provider: true,
      chargeType: true,
      chargeValue: true,
      commissionType: true,
      commissionValue: true,
      scheme: { select: { id: true, name: true } },
    },
    orderBy: [{ schemeId: "asc" }, { minAmount: "asc" }],
  });

  const matchable = slabs.filter(
    (s) => s.provider == null || normalizeProviderTag(s.provider) === "SAMEDAY"
  );
  line(
    "BILL_CREDIT_CARD slab matchable by SAMEDAY family exists",
    matchable.length > 0,
    matchable.length > 0
      ? `${matchable.length} slab(s) across ${new Set(matchable.map((s) => s.scheme.id)).size} active scheme(s)`
      : "no slab — charges resolve to ₹0 until a BILL_CREDIT_CARD slab is added in Commission/Scheme Manager"
  );

  if (matchable.length > 0) {
    console.log("\n   Matchable slabs:");
    for (const s of matchable) {
      console.log(
        `     · ${s.scheme.name}: ₹${s.minAmount}-₹${s.maxAmount} | provider=${s.provider ?? "ANY"} | ` +
          `charge ${s.chargeType} ${s.chargeValue} | comm ${s.commissionType} ${s.commissionValue}`
      );
    }
  }

  // 4. Retailers attached to a scheme that has a matchable slab
  const schemeIdsWithSlab = Array.from(new Set(matchable.map((s) => s.scheme.id)));
  const retailersReady = schemeIdsWithSlab.length
    ? await prisma.user.count({
        where: { role: "RETAILER", deletedAt: null, schemeId: { in: schemeIdsWithSlab } },
      })
    : 0;
  const retailersTotal = await prisma.user.count({
    where: { role: "RETAILER", deletedAt: null },
  });
  line(
    "Retailers attached to a scheme that prices this rail",
    retailersReady > 0,
    `${retailersReady}/${retailersTotal} retailer(s) ready`
  );

  // 5. Retailers with the rail in their per-user allowlist (or unrestricted)
  const restricted = await prisma.user.count({
    where: {
      role: "RETAILER",
      deletedAt: null,
      enabledServices: { isEmpty: false },
      NOT: { enabledServices: { has: "rechargekit_cc" } },
    },
  });
  line(
    "Retailer per-user allowlist won't hide the rail",
    true,
    restricted === 0
      ? "no restricted retailers hide it"
      : `${restricted} retailer(s) have a restricted list WITHOUT rechargekit_cc — enable it for them in Manage Services`
  );

  console.log("\n=== end ===\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
