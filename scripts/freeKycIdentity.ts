/**
 * TEST HELPER — free specific identity fields on a KEPT user's Kyc so those
 * numbers can be re-used to onboard another (test) account, WITHOUT deleting
 * the user, invite, documents, or hierarchy.
 *
 * The identity-uniqueness gate locks PAN / GST / bank / Aadhaar via the Kyc
 * table. Nulling the chosen columns releases only those numbers; everything
 * else about the account stays intact.
 *
 * IMPORTANT: Aadhaar is matched on BOTH aadhaarNumber and aadhaarLast4, so both
 * are cleared together.
 *
 * SAFETY: dry-run by default. Pass --apply to write.
 *   npx tsx scripts/freeKycIdentity.ts SD0101 --aadhaar             # dry-run
 *   npx tsx scripts/freeKycIdentity.ts SD0101 --aadhaar --apply     # execute
 *   npx tsx scripts/freeKycIdentity.ts MD0101 --aadhaar --pan --bank --apply
 */
import fs from "node:fs";
import path from "node:path";

function loadEnv(file: string) {
  const p = path.resolve(process.cwd(), file);
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv(".env");
loadEnv(".env.local");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const flags = new Set(args.filter((a) => a.startsWith("--")).map((a) => a.slice(2)));
const target = args.find((a) => !a.startsWith("--"));

const GROUPS: Record<string, Record<string, null>> = {
  aadhaar: {
    aadhaarNumber: null,
    aadhaarLast4: null,
    aadhaarName: null,
    aadhaarDob: null,
    aadhaarGender: null,
    aadhaarAddress: null,
    aadhaarMobile: null,
    aadhaarVerifiedAt: null,
  },
  pan: { panNumber: null, panName: null, panVerifiedAt: null },
  bank: {
    bankAccountNumber: null,
    bankAccountName: null,
    bankIfsc: null,
    bankAccountStatus: null,
  },
  gst: { gstin: null },
  msme: { msmeNumber: null },
};

async function main() {
  if (!target) {
    console.error("Usage: freeKycIdentity.ts <userCode|email|phone> --aadhaar|--pan|--bank|--gst|--msme [--apply]");
    process.exit(1);
  }
  const chosen = [...flags].filter((f) => f in GROUPS);
  if (chosen.length === 0) {
    console.error("Specify at least one field group: --aadhaar --pan --bank --gst --msme");
    process.exit(1);
  }

  const { prisma } = await import("../src/lib/db");

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ userCode: target }, { email: target.toLowerCase() }, { phone: target }],
    },
    select: { id: true, name: true, userCode: true, role: true, kyc: { select: { id: true } } },
  });
  if (!user) {
    console.log(`No user matches "${target}". Nothing to do.`);
    await prisma.$disconnect();
    return;
  }
  if (!user.kyc) {
    console.log(`${user.name} (${user.userCode}) has no Kyc row. Nothing to free.`);
    await prisma.$disconnect();
    return;
  }

  const data: Record<string, null> = {};
  for (const g of chosen) Object.assign(data, GROUPS[g]);

  const before = await prisma.kyc.findUnique({
    where: { userId: user.id },
    select: Object.fromEntries(Object.keys(data).map((k) => [k, true])) as any,
  });

  console.log(`\n=== FREE KYC IDENTITY — mode: ${APPLY ? "APPLY (WRITING)" : "DRY-RUN"} ===`);
  console.log(`User   : ${user.name} — ${user.userCode} (${user.role})`);
  console.log(`Groups : ${chosen.join(", ")}`);
  console.log(`\nCurrent values that will be cleared:`);
  for (const [k, v] of Object.entries(before ?? {})) {
    console.log(`  ${k.padEnd(20)} : ${v === null || v === undefined ? "(already empty)" : String(v)}`);
  }

  if (!APPLY) {
    console.log("\nDRY-RUN — nothing written. Re-run with --apply to clear these fields.\n");
    await prisma.$disconnect();
    return;
  }

  await prisma.kyc.update({ where: { userId: user.id }, data });
  console.log("\n✓ Cleared. Those identity numbers are now free to reuse for another onboarding.\n");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\nFATAL:", e);
  try {
    const { prisma } = await import("../src/lib/db");
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
