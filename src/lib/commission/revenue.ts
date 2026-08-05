import type { Prisma, ServiceCode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { creditWallet, debitWallet } from "@/lib/ledger";
import { dec, gt, sub, round, toNumber, type Money } from "@/lib/money";

/**
 * Platform revenue wallet.
 *
 * The company's gross margin on a scheme-priced transaction is:
 *
 *   platformRevenue = customer charge − Σ(gross commission paid to the chain)
 *
 * (GST is a tax liability, not revenue, so it is excluded.) After the network
 * chain is credited, whatever is left of the service charge is the platform's
 * cut. We credit it to the designated revenue account (the MASTER_ADMIN wallet)
 * so it accumulates in the admin's top-bar balance and shows up in the Revenue
 * wallet ledger.
 *
 * Every credit is idempotency-keyed (`revenue:{txnId}`) so retries / replays /
 * duplicate webhook deliveries can never double-credit.
 */

let cachedRevenueAccountId: string | null = null;

/**
 * The account that holds platform revenue: the oldest MASTER_ADMIN (platform
 * owner). Cached for the process lifetime — the owner account never changes at
 * runtime. Returns null if no MASTER_ADMIN exists (revenue crediting is then a
 * no-op rather than an error).
 */
export async function getRevenueAccountId(
  tx?: Prisma.TransactionClient
): Promise<string | null> {
  if (cachedRevenueAccountId) return cachedRevenueAccountId;
  const client = tx ?? prisma;
  const owner = await client.user.findFirst({
    where: { role: "MASTER_ADMIN", deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  cachedRevenueAccountId = owner?.id ?? null;
  return cachedRevenueAccountId;
}

/**
 * The account that holds the company PAYIN monitoring wallet. This is the same
 * platform-owner account that holds the REVENUE book (the oldest MASTER_ADMIN)
 * — the PAYIN book lives alongside REVENUE on that account, discriminated by
 * WalletTxn.walletType so the two never mix. Returns null when no MASTER_ADMIN
 * exists (payin mirroring is then a no-op rather than an error).
 */
export async function getPayinAccountId(
  tx?: Prisma.TransactionClient
): Promise<string | null> {
  return getRevenueAccountId(tx);
}

/**
 * Credit the platform's margin for a transaction to the revenue account.
 *
 * @param txnId       Transaction.id (for refs + idempotency)
 * @param service     ServiceCode (recorded on the ledger note)
 * @param charge      the customer-facing service charge collected (₹)
 * @param totalGross  Σ of gross commissions distributed to the chain (₹)
 * @param tx          optional Prisma transaction client (keeps it atomic with
 *                    the commission distribution)
 * @returns the revenue amount credited (0 when nothing was owed/credited)
 */
export async function creditPlatformRevenue(
  txnId: string,
  service: ServiceCode,
  charge: Money | number,
  totalGross: Money | number,
  tx?: Prisma.TransactionClient
): Promise<number> {
  const revenue = round(sub(dec(charge), dec(totalGross)));
  // Only credit a positive margin; a non-positive margin (e.g. a pool service
  // where commissions exceed the charge) is skipped rather than clamped so the
  // revenue ledger only ever reflects real earnings.
  if (!gt(revenue, 0)) return 0;

  const accountId = await getRevenueAccountId(tx);
  if (!accountId) return 0;

  try {
    await creditWallet(
      {
        userId: accountId,
        amount: revenue,
        reason: "PLATFORM_REVENUE",
        refType: "Transaction",
        refId: txnId,
        note: `Platform revenue on ${service} (charge ₹${toNumber(dec(charge))} − commission ₹${toNumber(dec(totalGross))})`,
        idempotencyKey: `revenue:${txnId}`,
      },
      tx
    );
  } catch {
    // Never block commission distribution or settlement on the revenue credit.
  }

  return toNumber(revenue);
}

/**
 * Credit the company's MDR margin (serviceCharge − vendorCharge) for a
 * transaction to the platform Revenue Wallet (the REVENUE book on the revenue
 * account). This is the pool from which upline (DT/MD/SD) commissions are then
 * paid out. Idempotency-keyed (`revenue-margin:{txnId}`) so replays/duplicate
 * webhook deliveries never double-credit.
 *
 * @returns the revenue account id when credited (needed to fund commissions),
 *          or null when there is no revenue account / nothing to credit.
 */
export async function creditMdrMargin(
  txnId: string,
  service: ServiceCode,
  margin: Money | number,
  tx?: Prisma.TransactionClient
): Promise<string | null> {
  const accountId = await getRevenueAccountId(tx);
  if (!accountId) return null;
  if (!gt(dec(margin), 0)) return accountId;

  await creditWallet(
    {
      userId: accountId,
      amount: round(margin),
      reason: "MDR_MARGIN",
      walletType: "REVENUE",
      refType: "Transaction",
      refId: txnId,
      note: `MDR margin on ${service}`,
      idempotencyKey: `revenue-margin:${txnId}`,
    },
    tx
  );
  return accountId;
}

/**
 * Debit a gross commission from the Revenue Wallet to fund an upline payout.
 * Idempotency-keyed per (txn, recipient) so replays never double-debit. The
 * commission is always funded from the same-transaction margin credited by
 * `creditMdrMargin`, so the revenue wallet can never go negative.
 */
export async function debitRevenueForCommission(
  accountId: string,
  txnId: string,
  recipientUserId: string,
  gross: Money | number,
  service: ServiceCode,
  tx?: Prisma.TransactionClient
): Promise<void> {
  if (!gt(dec(gross), 0)) return;
  await debitWallet(
    {
      userId: accountId,
      amount: round(gross),
      reason: "COMMISSION_PAYOUT",
      walletType: "REVENUE",
      refType: "Transaction",
      refId: txnId,
      note: `Commission payout funding on ${service} → ${recipientUserId}`,
      idempotencyKey: `revenue-comm-debit:${txnId}:${recipientUserId}`,
    },
    tx
  );
}
