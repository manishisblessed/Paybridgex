/**
 * Assign (or reassign) a RETAILER under a DISTRIBUTOR by userCode.
 *
 * This is the admin/operational counterpart to the Master-Admin hierarchy
 * transfer flow (`/api/admin/network/[id]/transfer` → declaration approval).
 * Unlike that two-step, approval-gated flow (which also NULLs the retailer's
 * scheme so the new parent assigns their own), this performs an immediate,
 * validated parent reassignment and writes an audit trail — suitable for the
 * common case of parking a freshly-onboarded retailer under the right
 * distributor.
 *
 * It is deliberately conservative:
 *   - validates roles (retailer must be RETAILER, new parent must be DISTRIBUTOR
 *     and ACTIVE and not soft-deleted);
 *   - blocks a circular hierarchy (new parent may not sit inside the retailer's
 *     own downline);
 *   - KEEPS the retailer's existing commission scheme by default (so pricing
 *     doesn't break). Pass --clear-scheme to mirror the transfer flow and null
 *     it (the distributor then assigns their own).
 *
 * SAFETY: dry-run by default — it only PRINTS what would change. Pass --apply to
 * actually write.
 *
 * Run (PowerShell, repo root, with DATABASE_URL set):
 *   npx tsx scripts/assignRetailerToDistributor.ts --retailer RT0112 --distributor DT0102
 *   npx tsx scripts/assignRetailerToDistributor.ts --retailer RT0112 --distributor DT0102 --apply
 *   npx tsx scripts/assignRetailerToDistributor.ts --retailer RT0112 --distributor DT0102 --apply --clear-scheme
 */
import { prisma } from "../src/lib/db";
import { getDescendantIds } from "../src/lib/security/ownership";

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const APPLY = process.argv.includes("--apply");
const CLEAR_SCHEME = process.argv.includes("--clear-scheme");
const retailerCode = argValue("retailer")?.trim();
const distributorCode = argValue("distributor")?.trim();

function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

async function nameFor(id: string | null | undefined): Promise<string> {
  if (!id) return "— (none)";
  const u = await prisma.user.findUnique({
    where: { id },
    select: { name: true, userCode: true, role: true },
  });
  return u ? `${u.name} (${u.userCode ?? "no-code"} · ${u.role})` : `${id} (not found)`;
}

async function main() {
  console.log(
    `[assignRetailerToDistributor] mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"}` +
      (CLEAR_SCHEME ? " · scheme will be CLEARED" : " · scheme kept")
  );

  if (!retailerCode || !distributorCode)
    die("Usage: --retailer <RT-code> --distributor <DT-code> [--apply] [--clear-scheme]");

  const retailer = await prisma.user.findFirst({
    where: { userCode: retailerCode, deletedAt: null },
    select: { id: true, name: true, role: true, status: true, parentId: true, schemeId: true, userCode: true },
  });
  if (!retailer) die(`Retailer with userCode "${retailerCode}" not found (or soft-deleted).`);

  const distributor = await prisma.user.findFirst({
    where: { userCode: distributorCode, deletedAt: null },
    select: { id: true, name: true, role: true, status: true, userCode: true },
  });
  if (!distributor) die(`Distributor with userCode "${distributorCode}" not found (or soft-deleted).`);

  // ── Validate the assignment ──────────────────────────────────────────────
  if (retailer.role !== "RETAILER")
    die(`Target ${retailer.userCode} is a ${retailer.role}, not a RETAILER. Refusing.`);
  if (distributor.role !== "DISTRIBUTOR")
    die(`New parent ${distributor.userCode} is a ${distributor.role}, not a DISTRIBUTOR. A retailer's parent must be a DISTRIBUTOR.`);
  if (distributor.status !== "ACTIVE")
    die(`New parent ${distributor.userCode} is ${distributor.status}, not ACTIVE. Refusing.`);
  if (retailer.parentId === distributor.id)
    die(`${retailer.userCode} is already assigned under ${distributor.userCode}. Nothing to do.`);

  const descendants = await getDescendantIds(retailer.id);
  if (descendants.includes(distributor.id))
    die("Circular hierarchy: the distributor is inside the retailer's own downline. Refusing.");

  const schemeName = retailer.schemeId
    ? (await prisma.scheme.findUnique({ where: { id: retailer.schemeId }, select: { name: true } }))?.name ?? retailer.schemeId
    : null;

  // ── Show the plan ─────────────────────────────────────────────────────────
  console.log("\n── Assignment plan ──────────────────────────────────────────");
  console.log(`Retailer      : ${retailer.name} (${retailer.userCode} · ${retailer.status})`);
  console.log(`Current parent: ${await nameFor(retailer.parentId)}`);
  console.log(`New parent    : ${distributor.name} (${distributor.userCode} · DISTRIBUTOR · ${distributor.status})`);
  console.log(`Scheme        : ${schemeName ?? "— (none)"} → ${CLEAR_SCHEME ? "CLEARED (null)" : "kept unchanged"}`);
  console.log("─────────────────────────────────────────────────────────────");

  if (!APPLY) {
    console.log("\nDRY-RUN — no changes written. Re-run with --apply to perform the assignment.\n");
    return;
  }

  // Actor for the audit trail: oldest MASTER_ADMIN (no session in a script).
  const actor = await prisma.user.findFirst({
    where: { role: "MASTER_ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.user.update({
      where: { id: retailer.id },
      data: {
        parentId: distributor.id,
        ...(CLEAR_SCHEME ? { schemeId: null } : {}),
      },
    }),
    prisma.auditLog.create({
      data: {
        userId: actor?.id ?? retailer.id,
        action: "hierarchy.retailer_assigned",
        entity: "User",
        entityId: retailer.id,
        meta: {
          via: "script:assignRetailerToDistributor",
          retailerCode: retailer.userCode,
          oldParentId: retailer.parentId,
          newParentId: distributor.id,
          newParentCode: distributor.userCode,
          schemeCleared: CLEAR_SCHEME,
        },
      },
    }),
  ]);

  console.log(`\n✓ Assigned ${retailer.userCode} under ${distributor.userCode} (${distributor.name}).`);
  if (CLEAR_SCHEME) console.log("  Scheme cleared — assign a new scheme for the retailer.");
  console.log("");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
