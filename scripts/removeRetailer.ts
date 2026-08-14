/**
 * FULL PHYSICAL PURGE of a single retailer/user so they can be re-onboarded
 * from scratch with the same email / phone / PAN.
 *
 * What it removes:
 *   • Cloudinary document assets (private, per-user KYC uploads)
 *   • Invite(s) + any DeclarationApproval / VerificationResult tied to them
 *   • Kyc + Documents (also covered by ON DELETE CASCADE from User)
 *   • The 12(ish) append-only AuditLog rows referencing the user — this
 *     requires temporarily disabling the `auditlog_append_only` trigger inside
 *     one atomic transaction (auto-restored; a post-check re-verifies).
 *   • The User row itself (physical DELETE — nothing is left behind).
 *
 * SAFETY:
 *   • Dry-run by default. Pass --apply to write.
 *   • Refuses to run against any user with a non-zero wallet/held/lien/aeps
 *     balance or with WalletTxn/Transaction/PayoutRequest rows (financial
 *     history must never be silently destroyed) unless --force is also passed.
 *
 *   npx tsx scripts/removeRetailer.ts RT0112             # dry-run
 *   npx tsx scripts/removeRetailer.ts RT0112 --apply     # execute
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

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const FORCE = args.includes("--force");
const target = (args.find((a) => !a.startsWith("--")) || "RT0112").trim();

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { deleteFromCloudinary } = await import("../src/lib/cloudinary");

  console.log(`\n=== FULL PURGE of "${target}" — mode: ${APPLY ? "APPLY (WRITING)" : "DRY-RUN"} ===\n`);

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ userCode: target }, { email: target.toLowerCase() }, { phone: target }],
    },
  });
  if (!user) {
    console.log("No matching User found. Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  const userId = user.id;
  console.log(`Target: ${user.name} — ${user.userCode} — ${user.email} / ${user.phone}`);
  console.log(`        id=${userId}  role=${user.role}  status=${user.status}`);

  // ── Financial safety gate ──
  const [walletTxns, transactions, payouts] = await Promise.all([
    prisma.walletTxn.count({ where: { userId } }),
    prisma.transaction.count({ where: { userId } }),
    prisma.payoutRequest.count({ where: { userId } }),
  ]);
  const hasBalance =
    user.walletBalance.toString() !== "0" ||
    user.heldBalance.toString() !== "0" ||
    user.lienBalance.toString() !== "0" ||
    user.aepsBalance.toString() !== "0";
  const financialFootprint = walletTxns > 0 || transactions > 0 || payouts > 0 || hasBalance;
  if (financialFootprint) {
    console.log(
      `\n⚠ FINANCIAL FOOTPRINT DETECTED: walletTxn=${walletTxns} transaction=${transactions} payout=${payouts} balances(non-zero)=${hasBalance}`
    );
    if (!FORCE) {
      console.log("Refusing to purge a user with financial history. Re-run with --force to override.\n");
      await prisma.$disconnect();
      return;
    }
    console.log("--force supplied — proceeding despite financial footprint.");
  }

  // ── Gather related records ──
  const invites = await prisma.invite.findMany({
    where: {
      OR: [{ userId }, { email: user.email.toLowerCase() }, { phone: user.phone }],
    },
    select: { id: true },
  });
  const inviteIds = invites.map((i) => i.id);

  const docs = await prisma.document.findMany({
    where: { userId },
    select: { id: true, type: true, publicId: true, isSensitive: true },
  });

  const auditUserRefs = await prisma.auditLog.count({ where: { userId } });
  const auditEntityRefs = await prisma.auditLog.count({
    where: { entity: "User", entityId: userId },
  });

  console.log("\nPLAN:");
  console.log(`  • Cloudinary assets to destroy : ${docs.length}`);
  console.log(`  • Invite rows                  : ${inviteIds.length}`);
  console.log(`  • Document rows                : ${docs.length}`);
  console.log(`  • Kyc rows                     : 1 (cascade)`);
  console.log(`  • AuditLog rows (userId)       : ${auditUserRefs}`);
  console.log(`  • AuditLog rows (entity=User)  : ${auditEntityRefs}`);
  console.log(`  • User row                     : 1 (physical delete)`);

  if (!APPLY) {
    console.log("\nDRY-RUN — nothing written. Re-run with --apply to execute.\n");
    await prisma.$disconnect();
    return;
  }

  // ── 1. Purge Cloudinary assets (best-effort, outside the DB transaction) ──
  console.log("\n[1/3] Destroying Cloudinary assets…");
  for (const d of docs) {
    try {
      const res = await deleteFromCloudinary(d.publicId, { isSensitive: d.isSensitive });
      console.log(`  ✓ ${d.type}: ${JSON.stringify(res)}`);
    } catch (e) {
      console.error(`  ✗ ${d.type} (${d.publicId}): ${(e as Error).message}`);
    }
  }

  // ── 2. Atomic DB purge (invite/decl/verif → audit rows w/ trigger off → user) ──
  console.log("\n[2/3] Deleting DB rows in one transaction…");
  await prisma.$transaction(
    async (tx) => {
      if (inviteIds.length) {
        const dec = await tx.declarationApproval.deleteMany({ where: { inviteId: { in: inviteIds } } });
        const vr = await tx.verificationResult.deleteMany({
          where: { OR: [{ userId }, { inviteId: { in: inviteIds } }] },
        });
        console.log(`  DeclarationApproval deleted: ${dec.count}`);
        console.log(`  VerificationResult deleted : ${vr.count}`);
      } else {
        const vr = await tx.verificationResult.deleteMany({ where: { userId } });
        console.log(`  VerificationResult deleted : ${vr.count}`);
      }

      if (inviteIds.length) {
        const inv = await tx.invite.deleteMany({ where: { id: { in: inviteIds } } });
        console.log(`  Invite deleted             : ${inv.count}`);
      }

      // Temporarily lift the append-only guard to physically remove audit rows,
      // then restore it — all inside this transaction so a failure rolls the
      // trigger back on automatically.
      await tx.$executeRawUnsafe(`ALTER TABLE "AuditLog" DISABLE TRIGGER auditlog_append_only;`);
      const deletedAudit = await tx.$executeRawUnsafe(
        `DELETE FROM "AuditLog" WHERE "userId" = $1 OR ("entity" = 'User' AND "entityId" = $1);`,
        userId
      );
      await tx.$executeRawUnsafe(`ALTER TABLE "AuditLog" ENABLE TRIGGER auditlog_append_only;`);
      console.log(`  AuditLog rows deleted      : ${deletedAudit}`);

      // Finally the user — cascades remaining Document/Kyc rows. No AuditLog
      // rows reference the user anymore, so no SET NULL hits the trigger.
      await tx.user.delete({ where: { id: userId } });
      console.log(`  User deleted               : 1`);
    },
    { timeout: 30000 }
  );

  // ── 3. Post-checks: trigger restored + user gone + identity freed ──
  console.log("\n[3/3] Verifying…");
  const trig = await prisma.$queryRawUnsafe<{ tgenabled: string }[]>(
    `SELECT tgenabled FROM pg_trigger WHERE tgname = 'auditlog_append_only';`
  );
  const triggerOk = trig[0]?.tgenabled === "O"; // 'O' = enabled (origin/local)
  console.log(`  append-only trigger enabled : ${triggerOk ? "YES ✓" : `NO ✗ (tgenabled=${trig[0]?.tgenabled})`}`);
  if (!triggerOk) {
    // Defensive re-enable outside the transaction, should never be needed.
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ENABLE TRIGGER auditlog_append_only;`);
    console.log("  → re-enabled trigger defensively.");
  }

  const stillThere = await prisma.user.findUnique({ where: { id: userId } });
  console.log(`  user row gone               : ${stillThere ? "NO ✗" : "YES ✓"}`);

  const emailFree = !(await prisma.user.findUnique({ where: { email: user.email.toLowerCase() } }));
  const phoneFree = !(await prisma.user.findUnique({ where: { phone: user.phone } }));
  console.log(`  email free for re-onboard   : ${emailFree ? "YES ✓" : "NO ✗"}`);
  console.log(`  phone free for re-onboard   : ${phoneFree ? "YES ✓" : "NO ✗"}`);

  console.log("\n✓ Purge complete. The retailer can now be re-onboarded with the same email/phone/PAN.\n");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\nFATAL:", e);
  // Best-effort: make absolutely sure the audit guard is back on.
  try {
    const { prisma } = await import("../src/lib/db");
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ENABLE TRIGGER auditlog_append_only;`);
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
