/**
 * TEST-DATA RESET (destructive). Scope:
 *   1. Delete ALL Invite rows + their onboarding artifacts
 *      (VerificationResult, DeclarationApproval). USER ACCOUNTS are KEPT
 *      (SD0101 / MD0101 / DT0101 / RT0101 stay as uplines). KYC is KEPT.
 *   2. Zero EVERY user's spendable books: walletBalance, aepsBalance,
 *      heldBalance, lienBalance -> 0. Deletes PRIMARY/AEPS WalletTxn and
 *      WalletLien so ledger integrity still matches. Does NOT touch
 *      payinBalance (Payin Today).
 *   3. Clear the Revenue Wallet completely: revenueBalance -> 0 on every
 *      holder AND delete all WalletTxn rows with walletType = REVENUE.
 *
 * SAFETY: dry-run by default. Pass --apply to write.
 *   npx tsx scripts/resetTestData.ts            # dry-run (prints plan)
 *   npx tsx scripts/resetTestData.ts --apply    # execute
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
    const key = line.slice(eq + 1).trim();
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

function money(v: unknown) {
  return `₹${Number(v ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

async function main() {
  const { prisma } = await import("../src/lib/db");

  console.log(`\n=== TEST-DATA RESET — mode: ${APPLY ? "APPLY (WRITING)" : "DRY-RUN"} ===`);

  const invites = await prisma.invite.findMany({ orderBy: { createdAt: "asc" } });
  const inviteIds = invites.map((i) => i.id);
  const linkedUserIds = invites.map((i) => i.userId).filter((id): id is string => !!id);

  const usersWithBalance = await prisma.user.findMany({
    where: {
      OR: [
        { walletBalance: { not: 0 } },
        { aepsBalance: { not: 0 } },
        { heldBalance: { not: 0 } },
        { lienBalance: { not: 0 } },
      ],
    },
    select: {
      id: true,
      name: true,
      userCode: true,
      role: true,
      walletBalance: true,
      aepsBalance: true,
      heldBalance: true,
      lienBalance: true,
    },
    orderBy: { role: "asc" },
  });

  const vrCount = await prisma.verificationResult.count({
    where: {
      OR: [
        { inviteId: { in: inviteIds } },
        ...(linkedUserIds.length ? [{ userId: { in: linkedUserIds } }] : []),
      ],
    },
  });
  const declCount = inviteIds.length
    ? await prisma.declarationApproval.count({ where: { inviteId: { in: inviteIds } } })
    : 0;
  const userCount = await prisma.user.count();
  const primaryTxn = await prisma.walletTxn.count({ where: { walletType: "PRIMARY" } });
  const aepsTxn = await prisma.walletTxn.count({ where: { walletType: "AEPS" } });
  const lienCount = await prisma.walletLien.count();
  const revHolders = await prisma.user.findMany({
    where: { revenueBalance: { not: 0 } },
    select: { id: true, name: true, role: true, revenueBalance: true },
  });
  const revTxnCount = await prisma.walletTxn.count({ where: { walletType: "REVENUE" } });

  console.log(`\n[1] INVITE DATA to DELETE (accounts + KYC kept):`);
  if (invites.length === 0) console.log(`    (no invites)`);
  for (const inv of invites) {
    console.log(
      `    ${inv.id}  ${inv.role}/${inv.status}  ${inv.name ?? "—"}  user=${inv.userId ?? "none"}`
    );
  }
  console.log(`    VerificationResult rows : ${vrCount}`);
  console.log(`    DeclarationApproval rows: ${declCount}`);
  console.log(`    Invite rows             : ${invites.length}`);
  console.log(`    Linked users KEPT       : ${linkedUserIds.length} (${linkedUserIds.join(", ") || "—"})`);

  console.log(`\n[2] BALANCES to ZERO on ALL ${userCount} users (primary/aeps/held/lien):`);
  if (usersWithBalance.length === 0) console.log(`    (already all ₹0)`);
  for (const u of usersWithBalance) {
    console.log(
      `    ${u.name} (${u.userCode ?? "—"}/${u.role}) primary=${money(u.walletBalance)} aeps=${money(u.aepsBalance)} held=${money(u.heldBalance)} lien=${money(u.lienBalance)} -> ₹0`
    );
  }
  console.log(`    delete WalletTxn PRIMARY : ${primaryTxn}`);
  console.log(`    delete WalletTxn AEPS    : ${aepsTxn}`);
  console.log(`    delete WalletLien        : ${lienCount}`);
  console.log(`    payinBalance             : UNTOUCHED`);

  console.log(`\n[3] REVENUE WALLET to CLEAR:`);
  if (revHolders.length === 0) console.log(`    (already ₹0)`);
  for (const r of revHolders) console.log(`    ${r.name} (${r.role}): ${money(r.revenueBalance)} -> ₹0.00`);
  console.log(`    delete WalletTxn REVENUE : ${revTxnCount}`);

  if (!APPLY) {
    console.log(`\nDRY-RUN — nothing written. Re-run with --apply to execute.\n`);
    await prisma.$disconnect();
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const vr = inviteIds.length
      ? await tx.verificationResult.deleteMany({
          where: {
            OR: [
              { inviteId: { in: inviteIds } },
              ...(linkedUserIds.length ? [{ userId: { in: linkedUserIds } }] : []),
            ],
          },
        })
      : { count: 0 };
    const decl = inviteIds.length
      ? await tx.declarationApproval.deleteMany({ where: { inviteId: { in: inviteIds } } })
      : { count: 0 };
    const inv = inviteIds.length
      ? await tx.invite.deleteMany({ where: { id: { in: inviteIds } } })
      : { count: 0 };

    const primary = await tx.walletTxn.deleteMany({ where: { walletType: "PRIMARY" } });
    const aeps = await tx.walletTxn.deleteMany({ where: { walletType: "AEPS" } });
    const liens = await tx.walletLien.deleteMany({});
    const bal = await tx.user.updateMany({
      data: { walletBalance: 0, aepsBalance: 0, heldBalance: 0, lienBalance: 0 },
    });

    const revTxn = await tx.walletTxn.deleteMany({ where: { walletType: "REVENUE" } });
    const revBal = await tx.user.updateMany({
      where: { revenueBalance: { not: 0 } },
      data: { revenueBalance: 0 },
    });

    return { vr, decl, inv, primary, aeps, liens, bal, revTxn, revBal };
  });

  const leftoverInvites = await prisma.invite.count();
  const leftoverRev = await prisma.user.aggregate({ _sum: { revenueBalance: true } });
  const leftoverBal = await prisma.user.aggregate({
    _sum: { walletBalance: true, aepsBalance: true, heldBalance: true, lienBalance: true },
  });
  const keptUsers = await prisma.user.findMany({
    where: { userCode: { in: ["SD0101", "MD0101", "DT0101", "RT0101"] } },
    select: { name: true, userCode: true, role: true, status: true },
  });

  console.log(`\n✓ APPLIED:`);
  console.log(`    VerificationResult deleted : ${result.vr.count}`);
  console.log(`    DeclarationApproval deleted: ${result.decl.count}`);
  console.log(`    Invite deleted             : ${result.inv.count}`);
  console.log(`    PRIMARY WalletTxn deleted  : ${result.primary.count}`);
  console.log(`    AEPS WalletTxn deleted     : ${result.aeps.count}`);
  console.log(`    WalletLien deleted         : ${result.liens.count}`);
  console.log(`    Users balance-zeroed       : ${result.bal.count}`);
  console.log(`    REVENUE WalletTxn deleted  : ${result.revTxn.count}`);
  console.log(`    Users revenue-zeroed       : ${result.revBal.count}`);
  console.log(`\nVERIFY:`);
  console.log(`    invites remaining          : ${leftoverInvites} (expected 0)`);
  console.log(`    Σ primary                  : ${money(leftoverBal._sum.walletBalance)} (expected ₹0.00)`);
  console.log(`    Σ aeps                     : ${money(leftoverBal._sum.aepsBalance)} (expected ₹0.00)`);
  console.log(`    Σ held                     : ${money(leftoverBal._sum.heldBalance)} (expected ₹0.00)`);
  console.log(`    Σ lien                     : ${money(leftoverBal._sum.lienBalance)} (expected ₹0.00)`);
  console.log(`    Σ revenue                  : ${money(leftoverRev._sum.revenueBalance)} (expected ₹0.00)`);
  console.log(`    accounts KEPT:`);
  for (const u of keptUsers) console.log(`      ${u.userCode}  ${u.name}  ${u.role}/${u.status}`);
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
