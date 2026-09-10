/**
 * READ-ONLY investigation for the test-data reset. Prints:
 *   - every Invite with its linked user, balances, and onboarding artifact counts
 *   - candidate "test users" (Manish / Malika, and the codes seen in the UI)
 *   - the Revenue wallet state (revenueBalance holders + REVENUE ledger volume)
 *
 * Writes NOTHING. Safe to run any time.
 *   npx tsx scripts/inspectTestReset.ts
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

function money(v: any) {
  return `₹${Number(v ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

async function main() {
  const { prisma } = await import("../src/lib/db");

  // ── 1. All invites ─────────────────────────────────────────────────────
  const invites = await prisma.invite.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`\n================ INVITES (${invites.length}) ================`);
  for (const inv of invites) {
    const user = inv.userId
      ? await prisma.user.findUnique({
          where: { id: inv.userId },
          select: {
            id: true, name: true, userCode: true, role: true, status: true,
            walletBalance: true, aepsBalance: true, heldBalance: true,
            lienBalance: true, revenueBalance: true, payinBalance: true,
            kyc: { select: { id: true } },
          },
        })
      : null;
    const vrByInvite = await prisma.verificationResult.count({ where: { inviteId: inv.id } });
    const vrByUser = inv.userId
      ? await prisma.verificationResult.count({ where: { userId: inv.userId } })
      : 0;
    const decl = await prisma.declarationApproval.count({ where: { inviteId: inv.id } });
    const docs = inv.userId
      ? await prisma.document.count({ where: { userId: inv.userId } })
      : 0;

    console.log(`\n--- Invite ${inv.id}`);
    console.log(`  contact       : ${inv.name ?? "—"}  ${inv.email}  ${inv.phone}`);
    console.log(`  role/status   : ${inv.role} / ${inv.status}`);
    console.log(`  token         : ${inv.token}`);
    console.log(`  userId        : ${inv.userId ?? "(none — never onboarded)"}`);
    if (user) {
      console.log(`  linked user   : ${user.name} — ${user.userCode} (${user.role}/${user.status})`);
      console.log(`  balances      : primary=${money(user.walletBalance)} aeps=${money(user.aepsBalance)} held=${money(user.heldBalance)} lien=${money(user.lienBalance)} revenue=${money(user.revenueBalance)} payin=${money(user.payinBalance)}`);
      console.log(`  kyc           : ${user.kyc ? "present" : "none"}`);
    }
    console.log(`  verifications : ${vrByInvite} by inviteId, ${vrByUser} by userId`);
    console.log(`  declApprovals : ${decl}`);
    console.log(`  documents     : ${docs}`);
  }

  // ── 2. Candidate test users ────────────────────────────────────────────
  const codes = ["RT0101", "DT0101", "MD0101", "SD0101",
    "CMSU9YLYRJ", "CMSU9Y48MX", "CMSU9YO1GS", "CMSU9YE4OY"];
  const testUsers = await prisma.user.findMany({
    where: {
      OR: [
        { userCode: { in: codes } },
        { name: { contains: "Manish", mode: "insensitive" } },
        { name: { contains: "Malika", mode: "insensitive" } },
      ],
    },
    select: {
      id: true, name: true, userCode: true, role: true, status: true,
      walletBalance: true, aepsBalance: true, heldBalance: true,
      lienBalance: true, revenueBalance: true, payinBalance: true,
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  console.log(`\n================ CANDIDATE TEST USERS (${testUsers.length}) ================`);
  for (const u of testUsers) {
    console.log(`  ${u.name} — ${u.userCode} (${u.role}/${u.status})`);
    console.log(`     primary=${money(u.walletBalance)} aeps=${money(u.aepsBalance)} held=${money(u.heldBalance)} lien=${money(u.lienBalance)} revenue=${money(u.revenueBalance)} payin=${money(u.payinBalance)}`);
  }

  // ── 3. Revenue wallet ──────────────────────────────────────────────────
  const revenueHolders = await prisma.user.findMany({
    where: { revenueBalance: { not: 0 } },
    select: { id: true, name: true, userCode: true, role: true, revenueBalance: true },
  });
  const revTxnCount = await prisma.walletTxn.count({ where: { walletType: "REVENUE" } });
  const revSum = await prisma.user.aggregate({ _sum: { revenueBalance: true } });
  console.log(`\n================ REVENUE WALLET ================`);
  console.log(`  Σ revenueBalance across ALL users : ${money(revSum._sum.revenueBalance)}`);
  console.log(`  users with non-zero revenueBalance:`);
  for (const u of revenueHolders) {
    console.log(`     ${u.name} — ${u.userCode} (${u.role}) : ${money(u.revenueBalance)}`);
  }
  console.log(`  WalletTxn rows with walletType=REVENUE : ${revTxnCount}`);

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
