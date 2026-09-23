/**
 * Reset TEST users to a clean slate: wipe their wallet passbook + earnings
 * history and zero every balance book. TEST DATA ONLY.
 *
 * Deletes, per user:
 *   • WalletTxn        (the passbook — every credit/debit)
 *   • CommissionCredit (their earnings history)
 * …and sets walletBalance/aepsBalance/revenueBalance/payinBalance/
 * heldBalance/lienBalance to 0.
 *
 * NOTE: This is a unilateral test reset — it does NOT re-balance any
 * counterparty (e.g. whoever funded them). Use only on isolated test accounts.
 *
 * SAFETY: DRY-RUN by default; pass `--apply` to write. One transaction per user.
 *
 *   npx tsx scripts/reset-test-user-wallet.ts <userIdOrEmailOrName> [more...] [--apply]
 */
export {};

try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.();
} catch {
  /* env provided by the shell */
}

async function main() {
  const { prisma } = await import("@/lib/db");
  const { Prisma } = await import("@prisma/client");

  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const idents = args.filter((a) => a !== "--apply");
  if (idents.length === 0) {
    console.error("Usage: npx tsx scripts/reset-test-user-wallet.ts <userIdOrEmailOrName> [more...] [--apply]");
    process.exit(1);
  }

  const toN = (d: unknown) => Number(new Prisma.Decimal(d as never));

  console.log(`\n${apply ? "APPLY" : "DRY-RUN"} — resetting ${idents.length} test user(s)\n`);

  for (const ident of idents) {
    const user = await prisma.user.findFirst({
      where: { OR: [{ id: ident }, { email: ident }, { name: { equals: ident, mode: "insensitive" } }] },
      select: {
        id: true, name: true, email: true, role: true,
        walletBalance: true, aepsBalance: true, revenueBalance: true,
        payinBalance: true, heldBalance: true, lienBalance: true,
      },
    });
    console.log("────────────────────────────────────────────────────");
    if (!user) {
      console.log(`✗ No user matched "${ident}" — skipped.`);
      continue;
    }

    const txnCount = await prisma.walletTxn.count({ where: { userId: user.id } });
    const commCount = await prisma.commissionCredit.count({ where: { userId: user.id } });

    console.log(`${user.name} [${user.role}]  id=${user.id}`);
    console.log(
      `  balances: primary=₹${toN(user.walletBalance)} aeps=₹${toN(user.aepsBalance)} revenue=₹${toN(user.revenueBalance)} payin=₹${toN(user.payinBalance)} held=₹${toN(user.heldBalance)} lien=₹${toN(user.lienBalance)}`
    );
    console.log(`  will delete: ${txnCount} WalletTxn, ${commCount} CommissionCredit → then zero all balances`);

    if (!apply) continue;

    await prisma.$transaction(async (tx) => {
      await tx.walletTxn.deleteMany({ where: { userId: user.id } });
      await tx.commissionCredit.deleteMany({ where: { userId: user.id } });
      await tx.user.update({
        where: { id: user.id },
        data: {
          walletBalance: new Prisma.Decimal(0),
          aepsBalance: new Prisma.Decimal(0),
          revenueBalance: new Prisma.Decimal(0),
          payinBalance: new Prisma.Decimal(0),
          heldBalance: new Prisma.Decimal(0),
          lienBalance: new Prisma.Decimal(0),
        },
      });
    });
    console.log("  ✓ history cleared + balances zeroed");
  }

  console.log("────────────────────────────────────────────────────");
  if (!apply) console.log("\nRe-run with --apply to perform the reset.\n");
  await prisma.$disconnect();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
