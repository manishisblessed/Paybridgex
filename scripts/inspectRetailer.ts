/**
 * READ-ONLY inspection of a single retailer/user's full data footprint.
 *
 * Discovers every foreign key that references the "User" table (via the
 * Postgres catalog) and counts how many rows each one holds for the target
 * user, plus the string-keyed tables that have no FK (Invite/JoinRequest/
 * LoginAttempt/Otp/VerificationResult/…). Also reports AuditLog references,
 * which decide whether a physical DELETE is even possible (the append-only
 * audit trigger blocks the FK SET NULL).
 *
 * NOTHING is written. Use this to plan a removal.
 *
 *   npx tsx scripts/inspectRetailer.ts                 # defaults to RT0112
 *   npx tsx scripts/inspectRetailer.ts RT0112
 *   npx tsx scripts/inspectRetailer.ts dhavalbhakhar0809@gmail.com
 */
import fs from "node:fs";
import path from "node:path";

// ── Load .env before anything touches process.env (Prisma is lazy) ──
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

const DEFAULT_TARGET = "RT0112";

async function main() {
  const { prisma } = await import("../src/lib/db");
  const target = (process.argv[2] || DEFAULT_TARGET).trim();

  console.log(`\n=== Retailer inspection: "${target}" (READ-ONLY) ===\n`);

  // ── 1. Locate the user by userCode / email / phone ──
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { userCode: target },
        { email: target.toLowerCase() },
        { phone: target },
      ],
    },
  });

  // Invites can exist with no linked user yet — surface them regardless.
  const invitesByContact = await prisma.invite.findMany({
    where: {
      OR: [
        { email: target.toLowerCase() },
        { phone: target },
        ...(user ? [{ userId: user.id }, { email: user.email }, { phone: user.phone }] : []),
      ],
    },
    select: { id: true, email: true, phone: true, role: true, status: true, userId: true, createdAt: true },
  });

  if (!user) {
    console.log("No User row found for that identifier.");
    if (invitesByContact.length) {
      console.log(`\nBut ${invitesByContact.length} Invite(s) exist for that contact:`);
      for (const i of invitesByContact) {
        console.log(`  • invite ${i.id} — ${i.email} / ${i.phone} (${i.role}/${i.status}) userId=${i.userId ?? "—"}`);
      }
    }
    await prisma.$disconnect();
    return;
  }

  console.log("USER");
  console.log(`  id         : ${user.id}`);
  console.log(`  userCode   : ${user.userCode}`);
  console.log(`  name       : ${user.name}`);
  console.log(`  email      : ${user.email}`);
  console.log(`  phone      : ${user.phone}`);
  console.log(`  role       : ${user.role}`);
  console.log(`  status     : ${user.status}`);
  console.log(`  parentId   : ${user.parentId ?? "—"}`);
  console.log(`  shopName   : ${user.shopName ?? "—"}`);
  console.log(`  deletedAt  : ${user.deletedAt?.toISOString() ?? "— (active)"}`);
  console.log(`  createdAt  : ${user.createdAt.toISOString()}`);
  console.log(
    `  balances   : wallet=${user.walletBalance} held=${user.heldBalance} lien=${user.lienBalance} aeps=${user.aepsBalance}`
  );

  const userId = user.id;

  // ── 2. Discover every FK that references "User" and its delete rule ──
  const fks = await prisma.$queryRawUnsafe<
    { child_table: string; child_column: string; delete_rule: string; constraint_name: string }[]
  >(`
    SELECT tc.table_name        AS child_table,
           kcu.column_name      AS child_column,
           rc.delete_rule       AS delete_rule,
           tc.constraint_name   AS constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema   = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema    = tc.table_schema
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name
     AND rc.constraint_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'User'
      AND tc.table_schema = 'public'
    ORDER BY tc.table_name, kcu.column_name;
  `);

  console.log(`\nFK COLUMNS REFERENCING User (${fks.length} found) — rows for this user:`);
  const fkHits: { table: string; column: string; rule: string; count: number }[] = [];
  for (const fk of fks) {
    const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM "${fk.child_table}" WHERE "${fk.child_column}" = $1`,
      userId
    );
    const n = rows[0]?.n ?? 0;
    if (n > 0) {
      fkHits.push({ table: fk.child_table, column: fk.child_column, rule: fk.delete_rule, count: n });
    }
  }
  if (fkHits.length === 0) {
    console.log("  (none — no FK-linked child rows)");
  } else {
    for (const h of fkHits) {
      console.log(`  • ${h.table}.${h.column}  x${h.count}   [ON DELETE ${h.rule}]`);
    }
  }

  // ── 3. String-keyed tables that have NO FK to User (must be cleaned manually) ──
  const email = user.email.toLowerCase();
  const phone = user.phone;
  const inviteIds = invitesByContact.map((i) => i.id);

  const [
    verifByUser,
    verifByInvite,
    joinReqs,
    loginAttempts,
    otps,
    idempotency,
    settlementRuns,
    settlementAlerts,
    posAssignFrom,
    posAssignTo,
    posAssignBy,
  ] = await Promise.all([
    prisma.verificationResult.count({ where: { userId } }),
    inviteIds.length ? prisma.verificationResult.count({ where: { inviteId: { in: inviteIds } } }) : Promise.resolve(0),
    prisma.joinRequest.count({ where: { OR: [{ email }, { phone }] } }),
    prisma.loginAttempt.count({ where: { identifier: { in: [email, phone] } } }),
    prisma.otp.count({ where: { target: { in: [email, phone] } } }),
    prisma.idempotencyKey.count({ where: { userId } }).catch(() => -1),
    prisma.settlementRun.count({ where: { userId } }).catch(() => -1),
    prisma.settlementAlert.count({ where: { userId } }).catch(() => -1),
    prisma.posAssignmentLog.count({ where: { fromUserId: userId } }).catch(() => -1),
    prisma.posAssignmentLog.count({ where: { toUserId: userId } }).catch(() => -1),
    prisma.posAssignmentLog.count({ where: { byUserId: userId } }).catch(() => -1),
  ]);

  console.log("\nSTRING-KEYED / NON-FK REFERENCES:");
  console.log(`  • Invite (by contact/userId)      x${invitesByContact.length}`);
  for (const i of invitesByContact) {
    console.log(`       - ${i.id} (${i.role}/${i.status}) userId=${i.userId ?? "—"}`);
  }
  console.log(`  • VerificationResult.userId       x${verifByUser}`);
  console.log(`  • VerificationResult.inviteId     x${verifByInvite}`);
  console.log(`  • JoinRequest (email/phone)       x${joinReqs}`);
  console.log(`  • LoginAttempt (identifier)       x${loginAttempts}`);
  console.log(`  • Otp (target)                    x${otps}`);
  console.log(`  • IdempotencyKey.userId           x${idempotency}`);
  console.log(`  • SettlementRun.userId            x${settlementRuns}`);
  console.log(`  • SettlementAlert.userId          x${settlementAlerts}`);
  console.log(`  • PosAssignmentLog from/to/by     x${posAssignFrom}/${posAssignTo}/${posAssignBy}`);

  // ── 4. Uploaded documents (Cloudinary assets to purge) ──
  const docs = await prisma.document.findMany({
    where: { userId },
    select: { id: true, type: true, publicId: true, isSensitive: true },
  });
  console.log(`\nDOCUMENTS (Cloudinary assets) x${docs.length}:`);
  for (const d of docs) {
    console.log(`  • ${d.type}  publicId=${d.publicId}  sensitive=${d.isSensitive}`);
  }

  // ── 5. KYC video (S3 object to purge) ──
  const video = await prisma.kycVideo.findUnique({
    where: { userId },
    select: { id: true, status: true, purgedAt: true },
  });
  console.log(`\nKYC VIDEO (S3): ${video ? `present (status=${video.status}, purgedAt=${video.purgedAt?.toISOString() ?? "—"})` : "none"}`);

  // ── 6. KYC identity fields (unique constraints that block re-onboarding) ──
  const kyc = await prisma.kyc.findUnique({
    where: { userId },
    select: {
      status: true,
      panNumber: true,
      aadhaarNumber: true,
      bankAccountNumber: true,
      gstin: true,
      msmeNumber: true,
    },
  });
  console.log("\nKYC (unique identity fields that would block re-onboarding):");
  if (!kyc) {
    console.log("  (no Kyc row)");
  } else {
    console.log(`  status : ${kyc.status}`);
    console.log(`  pan    : ${kyc.panNumber ?? "—"}`);
    console.log(`  aadhaar: ${kyc.aadhaarNumber ? "set" : "—"}`);
    console.log(`  bankAcc: ${kyc.bankAccountNumber ? "set" : "—"}`);
    console.log(`  gstin  : ${kyc.gstin ?? "—"}`);
    console.log(`  msme   : ${kyc.msmeNumber ?? "—"}`);
  }

  // ── 7. AuditLog references — decides hard-delete feasibility ──
  const auditCount = await prisma.auditLog.count({ where: { userId } });
  const auditActed = await prisma.auditLog.count({ where: { entityId: userId } });
  console.log(`\nAUDIT LOG references: userId x${auditCount}, entityId x${auditActed}`);
  console.log(
    auditCount > 0
      ? "  → HARD DELETE of the User row will be BLOCKED by the append-only audit trigger.\n" +
          "    Removal must either (a) anonymize + soft-delete, or (b) temporarily bypass the\n" +
          "    audit trigger to physically delete these rows (destroys the audit trail)."
      : "  → No audit references; a physical hard-delete of the User row is feasible."
  );

  console.log("\n=== end inspection (no changes were made) ===\n");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
