/**
 * Replay commission distribution for past SUCCESS payouts that received zero
 * commission (they settled on the pre-fix code where the provider was hardcoded
 * to BULKPE and never matched the SAMEDAY scheme slabs).
 *
 * Uses the REAL distributeCommission engine, which is idempotency-keyed
 * (`commission:{txnId}:{userId}`), so re-running is always safe and never
 * double-pays. The synthetic settlement Transaction is minted here exactly as
 * finalizePayoutSuccess does (idempotent by refId) if it doesn't already exist.
 *
 * Run (PowerShell, repo root, with DATABASE_URL set):
 *   npx tsx scripts/replay-payout-commission.ts            # dry-run (no writes)
 *   npx tsx scripts/replay-payout-commission.ts --apply    # write credits
 */
try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.();
} catch {
  /* env provided by the process manager */
}

import { prisma } from "../src/lib/db";
import { distributeCommission } from "../src/lib/commission/distribute";
import { PAYOUT_MODE_SERVICE } from "../src/lib/scheme/resolver";
import { PAYOUT_MODE_PROVIDER } from "../src/lib/payout/charges";
import type { ServiceCode } from "@prisma/client";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(
    `[replay-payout-commission] mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"}`
  );

  const payouts = await prisma.payoutRequest.findMany({
    where: { status: "SUCCESS" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      userId: true,
      mode: true,
      amount: true,
      serviceCharge: true,
      providerTxnId: true,
      completedAt: true,
    },
  });

  console.log(`[replay-payout-commission] scanning ${payouts.length} SUCCESS payout(s)…\n`);

  let fixed = 0;
  let alreadyOk = 0;
  let skipped = 0;

  for (const po of payouts) {
    const service = PAYOUT_MODE_SERVICE[po.mode] as ServiceCode | undefined;
    if (!service) {
      console.log(`- ${po.id} mode=${po.mode}: no service mapping, skip`);
      skipped++;
      continue;
    }
    const provider = PAYOUT_MODE_PROVIDER[po.mode] ?? "SAMEDAY";
    const refId = `PYC${po.id.slice(-10).toUpperCase()}`;

    // Does a synthetic txn already exist, and does it already have credits?
    const existing = await prisma.transaction.findUnique({
      where: { refId },
      select: { id: true },
    });
    if (existing) {
      const credits = await prisma.commissionCredit.count({
        where: { transactionId: existing.id },
      });
      if (credits > 0) {
        alreadyOk++;
        continue;
      }
    }

    console.log(
      `- ${po.id} mode=${po.mode} amount=${Number(po.amount)} provider=${provider}: needs replay`
    );

    if (!APPLY) {
      fixed++;
      continue;
    }

    // Mint the synthetic settlement txn if missing (mirrors finalizePayoutSuccess).
    let txnId = existing?.id;
    if (!txnId) {
      const txn = await prisma.transaction.create({
        data: {
          refId,
          userId: po.userId,
          service,
          amount: po.amount,
          fee: po.serviceCharge,
          status: "SUCCESS",
          partner: provider,
          partnerTxnId: po.providerTxnId ?? po.id,
          createdAt: po.completedAt ?? undefined,
        },
      });
      txnId = txn.id;
    }

    const credits = await distributeCommission(
      txnId,
      po.userId,
      service,
      Number(po.amount),
      undefined,
      provider
    );

    const own = credits.find((c) => c.userId === po.userId);
    if (own) {
      await prisma.transaction.update({
        where: { id: txnId },
        data: { commission: own.amount },
      });
    }

    console.log(
      `    -> ${credits.length} credit(s): ` +
        JSON.stringify(credits.map((c) => ({ tier: c.tier, gross: c.gross, tds: c.tds, net: c.amount })))
    );
    fixed++;
  }

  console.log(
    `\n[replay-payout-commission] done — ${fixed} ${APPLY ? "replayed" : "would replay"}, ${alreadyOk} already had commission, ${skipped} skipped.`
  );
  if (!APPLY && fixed > 0) {
    console.log("Re-run with --apply to write the commission credits.");
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[replay-payout-commission] FAILED:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
