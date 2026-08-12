/**
 * READ-ONLY 2FA diagnostic.
 *
 *   npx tsx scripts/diag-2fa.ts                 # recent logins w/ 2FA off + recent 2FA audit logs
 *   npx tsx scripts/diag-2fa.ts <email|phone|userCode>
 *
 * Makes zero writes. Safe to run against production.
 */
import "./_load-env";
import { prisma } from "@/lib/db";

function mask(s: string | null | undefined): string {
  if (!s) return "—";
  if (s.includes("@")) {
    const [u, d] = s.split("@");
    return `${u.slice(0, 2)}***@${d}`;
  }
  if (s.length >= 6) return `${s.slice(0, 3)}***${s.slice(-2)}`;
  return "***";
}

async function inspectOne(identifier: string) {
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: identifier }, { phone: identifier }, { userCode: identifier }],
    },
    select: {
      id: true,
      userCode: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
      twoFactorBackupCodes: true,
      twoFactorVerifiedAt: true,
      lastLoginAt: true,
      tokenVersion: true,
    },
  });

  if (!user) {
    console.log(`\n❌ No user found for identifier "${identifier}"`);
    return;
  }

  const hasSecret = !!user.twoFactorSecret;
  console.log("\n════════════════════════════════════════════════");
  console.log(` USER: ${user.name}  (${user.userCode ?? "no code"})`);
  console.log("════════════════════════════════════════════════");
  console.log(` id                : ${user.id}`);
  console.log(` email / phone     : ${mask(user.email)} / ${mask(user.phone)}`);
  console.log(` role / status     : ${user.role} / ${user.status}`);
  console.log(` tokenVersion      : ${user.tokenVersion}`);
  console.log(` lastLoginAt       : ${user.lastLoginAt?.toISOString() ?? "—"}`);
  console.log("  ──────── 2FA state ────────");
  console.log(` twoFactorEnabled  : ${user.twoFactorEnabled}   <-- modal shows when this is false`);
  console.log(` twoFactorSecret   : ${hasSecret ? "SET (scanned QR at least once)" : "null (never scanned)"}`);
  console.log(` backupCodes count : ${user.twoFactorBackupCodes?.length ?? 0}`);
  console.log(` twoFactorVerifiedAt: ${user.twoFactorVerifiedAt?.toISOString() ?? "null (never confirmed)"}`);

  console.log("\n  ──────── diagnosis ────────");
  if (user.twoFactorEnabled) {
    console.log("  ✅ 2FA is ACTIVE in the DB. This account should NOT see the setup modal.");
    console.log("     If it still does, the browser session is stale — full sign-out + sign-in fixes it.");
  } else if (hasSecret && !user.twoFactorVerifiedAt) {
    console.log("  ⚠️  SCANNED BUT NEVER CONFIRMED. The QR/secret was generated, but the");
    console.log("     6-digit 'Verify & activate' step was never completed, so the flag is false.");
    console.log("     => Finish the verify step; the modal will stop appearing.");
  } else if (!hasSecret) {
    console.log("  ⚠️  No secret on record — 2FA was never set up on THIS account,");
    console.log("     or it was reset by an admin. Complete the full setup + verify flow.");
  } else {
    console.log("  ⚠️  Secret set + verifiedAt set but enabled=false — likely an admin reset");
    console.log("     after a prior activation. Re-run setup + verify.");
  }

  const logs = await prisma.auditLog.findMany({
    where: {
      userId: user.id,
      action: { in: ["2fa.setup_initiated", "2fa.enabled", "network.2fa_reset", "user.2fa_reset", "admin.2fa_reset", "master.2fa_reset", "sub.2fa_reset"] },
    },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: { action: true, createdAt: true, meta: true },
  });

  console.log("\n  ──────── recent 2FA audit trail (newest first) ────────");
  if (logs.length === 0) {
    console.log("  (no 2FA audit entries — setup was likely never even initiated on this account)");
  } else {
    for (const l of logs) {
      console.log(`  ${l.createdAt.toISOString()}  ${l.action}`);
    }
  }
  console.log("");
}

async function overview() {
  const [enabled, disabled, scannedNotConfirmed] = await Promise.all([
    prisma.user.count({ where: { twoFactorEnabled: true } }),
    prisma.user.count({ where: { twoFactorEnabled: false } }),
    prisma.user.count({ where: { twoFactorEnabled: false, NOT: { twoFactorSecret: null } } }),
  ]);

  console.log("\n════════════════════════════════════════════════");
  console.log(" 2FA OVERVIEW (all users)");
  console.log("════════════════════════════════════════════════");
  console.log(` enabled=true                : ${enabled}`);
  console.log(` enabled=false               : ${disabled}`);
  console.log(`   of which scanned-not-confirmed (secret set): ${scannedNotConfirmed}`);

  const recent = await prisma.user.findMany({
    where: { lastLoginAt: { not: null } },
    orderBy: { lastLoginAt: "desc" },
    take: 25,
    select: {
      userCode: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
      twoFactorVerifiedAt: true,
      lastLoginAt: true,
    },
  });

  console.log("\n──── 25 most recent logins (any 2FA state) — find your account here ────");
  if (recent.length === 0) {
    console.log("  (none)");
  } else {
    for (const u of recent) {
      const state = u.twoFactorEnabled
        ? "ENABLED"
        : u.twoFactorSecret
          ? (u.twoFactorVerifiedAt ? "off/reset?" : "scanned-not-confirmed")
          : "off/never-scanned";
      console.log(
        `  ${u.lastLoginAt?.toISOString()}  ${(u.userCode ?? "").padEnd(10)} ${(u.name ?? "").slice(0, 22).padEnd(22)} ${mask(u.email).padEnd(20)} ${mask(u.phone).padEnd(12)} [${state}]`
      );
    }
  }
  console.log("\nTip: re-run with your login id →  npx tsx scripts/diag-2fa.ts <email|phone|userCode>\n");
}

async function auditTrail() {
  const logs = await prisma.auditLog.findMany({
    where: {
      action: { in: ["auth.login", "2fa.verified", "2fa.attempt_failed", "2fa.setup_initiated", "2fa.enabled"] },
    },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { action: true, createdAt: true, userId: true },
  });

  const userIds = Array.from(new Set(logs.map((l) => l.userId).filter(Boolean))) as string[];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, userCode: true, name: true, twoFactorEnabled: true, twoFactorSecret: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  console.log("\n════════════════════════════════════════════════");
  console.log(" RECENT AUTH AUDIT TRAIL (newest first, UTC)");
  console.log("════════════════════════════════════════════════");
  for (const l of logs) {
    const u = l.userId ? byId.get(l.userId) : undefined;
    const who = u ? `${(u.userCode ?? "—").padEnd(9)} ${(u.name ?? "").slice(0, 20).padEnd(20)}` : "(unknown user)".padEnd(30);
    const flag = u ? `2fa=${u.twoFactorEnabled ? "ON " : "off"}${u.twoFactorSecret ? "" : "/noSecret"}` : "";
    console.log(`  ${l.createdAt.toISOString()}  ${l.action.padEnd(20)} ${who} ${flag}`);
  }
  console.log("");
}

async function main() {
  const arg = process.argv[2]?.trim();
  if (arg === "--audit") {
    await auditTrail();
  } else if (arg) {
    await inspectOne(arg);
  } else {
    await overview();
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
