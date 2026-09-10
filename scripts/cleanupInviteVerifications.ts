/**
 * Clear leftover / duplicate onboarding VERIFICATION test data for one or more
 * KEPT users, WITHOUT deleting the user, their Kyc, their Invite, or their
 * declaration approvals.
 *
 * Why: during testing many throwaway PAN / GST / bank / Aadhaar verification
 * attempts get recorded as `VerificationResult` rows against a user's onboarding
 * invite. The identity-uniqueness gate treats every successful attempt as
 * "claimed", so those stray numbers (belonging to nobody real) stay locked and
 * block re-onboarding a new DT / RT with them.
 *
 * This deletes ONLY the `VerificationResult` rows tied to the target users'
 * invites (and any linked by userId). The user's real identity stays protected
 * by the `Kyc` table (which is untouched), so their own PAN/Aadhaar/bank/GST
 * remain locked to them — only the stray extras are freed.
 *
 * SAFETY: dry-run by default. Pass --apply to write.
 *   npx tsx scripts/cleanupInviteVerifications.ts MD0101 SD0101           # dry-run
 *   npx tsx scripts/cleanupInviteVerifications.ts MD0101 SD0101 --apply   # execute
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
const targets = args.filter((a) => !a.startsWith("--"));
if (targets.length === 0) targets.push("MD0101", "SD0101");

// Only the identity-verification rows lock a PAN / GST / bank / Aadhaar under
// the uniqueness gate. Document & media UPLOAD rows are the kept account's real
// onboarding evidence and are preserved.
const IDENTITY_TYPES = new Set([
  "PAN_360",
  "GST",
  "BANK_PENNY_DROP",
  "BANK_ADVANCE",
  "AADHAAR_DIGILOCKER",
  "AADHAAR_DIGILOCKER_INIT",
  "BUSINESS_NAME",
]);

/* eslint-disable @typescript-eslint/no-explicit-any */
function identityOf(vr: {
  type: string;
  verifiedName: string | null;
  requestPayload: any;
  responsePayload: any;
}): string {
  const req = (vr.requestPayload ?? {}) as any;
  const res = (vr.responsePayload ?? {}) as any;
  switch (vr.type) {
    case "PAN_360":
      return `PAN ${req.pan ?? "?"}`;
    case "GST":
      return `GST ${req.gst ?? req.gstin ?? "?"}`;
    case "BANK_PENNY_DROP":
    case "BANK_ADVANCE":
      return `A/C ${req.account_number ?? "?"} ${req.ifsc ?? ""}`.trim();
    case "AADHAAR_DIGILOCKER":
      return `Aadhaar …${String(res.uid ?? "").slice(-4) || "?"}`;
    default:
      return "-";
  }
}

async function main() {
  const { prisma } = await import("../src/lib/db");

  console.log(
    `\n=== CLEANUP invite verifications — mode: ${APPLY ? "APPLY (WRITING)" : "DRY-RUN"} ===`
  );
  console.log(`Targets: ${targets.join(", ")}\n`);

  let grandTotal = 0;

  for (const target of targets) {
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { userCode: target },
          { email: target.toLowerCase() },
          { phone: target },
        ],
      },
      select: { id: true, name: true, userCode: true, email: true, phone: true, role: true },
    });

    if (!user) {
      console.log(`• "${target}" → no matching user. Skipped.\n`);
      continue;
    }

    const invites = await prisma.invite.findMany({
      where: {
        OR: [{ userId: user.id }, { email: user.email.toLowerCase() }, { phone: user.phone }],
      },
      select: { id: true },
    });
    const inviteIds = invites.map((i) => i.id);

    const where = {
      OR: [
        { userId: user.id },
        ...(inviteIds.length ? [{ inviteId: { in: inviteIds } }] : []),
      ],
    };

    const rows = await prisma.verificationResult.findMany({
      where,
      select: {
        id: true,
        type: true,
        status: true,
        verifiedName: true,
        requestPayload: true,
        responsePayload: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const toDelete = rows.filter((r) => IDENTITY_TYPES.has(r.type));
    const toKeep = rows.filter((r) => !IDENTITY_TYPES.has(r.type));

    console.log(
      `• ${user.name} — ${user.userCode} (${user.role}) — ${user.email} / ${user.phone}`
    );
    console.log(
      `    invites: ${inviteIds.length} | total VR: ${rows.length} | to delete: ${toDelete.length} | keep (docs/media): ${toKeep.length}`
    );
    console.log("    --- will DELETE (identity verifications) ---");
    for (const r of toDelete) {
      console.log(
        `      ✗ ${r.type.padEnd(22)} ${r.status.padEnd(8)} ${(r.verifiedName ?? "").padEnd(22)} ${identityOf(r)}`
      );
    }
    console.log("    --- will KEEP (onboarding evidence) ---");
    for (const r of toKeep) {
      console.log(`      ✓ ${r.type.padEnd(22)} ${r.status}`);
    }
    console.log("");
    grandTotal += toDelete.length;

    if (APPLY && toDelete.length) {
      const del = await prisma.verificationResult.deleteMany({
        where: { id: { in: toDelete.map((r) => r.id) } },
      });
      console.log(`    ✓ deleted ${del.count} identity VerificationResult row(s).\n`);
    }
  }

  if (!APPLY) {
    console.log(
      `DRY-RUN — nothing written. ${grandTotal} VerificationResult row(s) would be deleted.`
    );
    console.log("Re-run with --apply to execute.\n");
  } else {
    console.log(`✓ Cleanup complete. Removed ${grandTotal} stray verification row(s).`);
    console.log(
      "User / Kyc / Invite / declaration approvals were NOT touched — real identities stay locked; stray test numbers are freed.\n"
    );
  }

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
