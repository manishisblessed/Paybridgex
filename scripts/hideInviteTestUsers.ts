/**
 * Hide the 4 invite-created test accounts from the admin Users tab.
 *
 * Soft-deletes (User.deletedAt) — physical DELETE is blocked by the
 * append-only AuditLog trigger. Also vacates unique email/phone/userCode/
 * shopName and Kyc identity fields so the same contacts can be re-invited.
 *
 * TARGETS (by userCode only): RT0101, DT0101, MD0101, SD0101
 * NEVER touches: MASTER_ADMIN, ADMIN, FINANCE, or any other user.
 *
 * SAFETY: dry-run by default. Pass --apply to write.
 *   npx tsx scripts/hideInviteTestUsers.ts
 *   npx tsx scripts/hideInviteTestUsers.ts --apply
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

const APPLY = process.argv.includes("--apply");
const TARGET_CODES = ["RT0101", "DT0101", "MD0101", "SD0101"] as const;

async function main() {
  const { prisma } = await import("../src/lib/db");

  console.log(`\n=== HIDE INVITE TEST USERS — mode: ${APPLY ? "APPLY" : "DRY-RUN"} ===`);

  const targets = await prisma.user.findMany({
    where: { userCode: { in: [...TARGET_CODES] }, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      userCode: true,
      shopName: true,
    },
  });

  if (targets.length === 0) {
    console.log("No matching live users. Nothing to do.\n");
    await prisma.$disconnect();
    return;
  }

  console.log(`\nWill hide ${targets.length} account(s) from Users / Network:`);
  for (const u of targets) {
    console.log(`  ${u.userCode}  ${u.name}  ${u.role}/${u.status}  ${u.email}  ${u.phone}`);
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN — nothing written. Re-run with --apply to hide.\n`);
    await prisma.$disconnect();
    return;
  }

  const actor = await prisma.user.findFirst({
    where: { role: "MASTER_ADMIN", deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  const now = new Date();
  for (const u of targets) {
    await prisma.$transaction(async (tx) => {
      await tx.kyc.updateMany({
        where: { userId: u.id },
        data: {
          panNumber: null,
          aadhaarNumber: null,
          aadhaarLast4: null,
          bankAccountNumber: null,
          gstin: null,
          msmeNumber: null,
        },
      });
      await tx.user.update({
        where: { id: u.id },
        data: {
          deletedAt: now,
          status: "CLOSED",
          email: `deleted.${u.id}@invalid.paybridgex`,
          phone: `+91DEL${u.id.replace(/[^a-z0-9]/gi, "").slice(-9)}`,
          userCode: null,
          shopName: null,
          tokenVersion: { increment: 1 },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor?.id ?? u.id,
          action: "user.test_data_purged",
          entity: "User",
          entityId: u.id,
          meta: {
            via: "script:hideInviteTestUsers",
            userCode: u.userCode,
            email: u.email,
            phone: u.phone,
            name: u.name,
            role: u.role,
            reason: "Hide invite-created test accounts from Users tab",
          },
        },
      });
    });
    console.log(`  hidden ${u.userCode} (${u.name})`);
  }

  const remaining = await prisma.user.count({
    where: {
      deletedAt: null,
      role: { notIn: ["ADMIN", "SUPPORT", "MASTER_ADMIN"] },
    },
  });
  const stillVisible = await prisma.user.findMany({
    where: { userCode: { in: [...TARGET_CODES] }, deletedAt: null },
    select: { userCode: true },
  });

  console.log(`\nVERIFY:`);
  console.log(`  target codes still visible : ${stillVisible.length} (expected 0)`);
  console.log(`  Users-tab count (non-staff): ${remaining}`);
  console.log(`\nDone.\n`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\nFATAL:", e);
  try {
    const { prisma } = await import("../src/lib/db");
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
