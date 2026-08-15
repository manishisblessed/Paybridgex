import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { creditWallet, debitWallet } from "@/lib/ledger";
import { dec, gt, round, type Money } from "@/lib/money";

/**
 * Company TDS Payable account.
 *
 * Every commission payout withholds 2% TDS (Section 194H). The withheld rupees
 * are moved INTO this internal system account so the withholding is a true
 * double-entry movement (Revenue DEBIT gross ↔ payee CREDIT net + TDS-account
 * CREDIT tds) — money is conserved and the account balance equals the
 * outstanding, not-yet-remitted TDS liability the company owes the government.
 *
 * The account is a FINANCE-role system user with a SUSPENDED status (it can
 * never log in) and an unusable random password. FINANCE is excluded from the
 * network-tier liability rollups, so the TDS float never pollutes user totals.
 *
 * Resolved lazily and cached for the process lifetime. Mirrors the Company
 * Suspense account pattern (see wallet/suspense.ts).
 */

const TDS_ACCOUNT_EMAIL = "tds-payable@system.paybridgex";
const TDS_ACCOUNT_PHONE = "+910000000002";

let cachedTdsAccountId: string | null = null;

/** Find (or create once) the Company TDS Payable account and return its id. */
export async function getTdsAccountId(tx?: Prisma.TransactionClient): Promise<string> {
  if (cachedTdsAccountId) return cachedTdsAccountId;
  const client = tx ?? prisma;

  const existing = await client.user.findUnique({
    where: { email: TDS_ACCOUNT_EMAIL },
    select: { id: true },
  });
  if (existing) {
    cachedTdsAccountId = existing.id;
    return existing.id;
  }

  const created = await client.user.create({
    data: {
      name: "Company TDS Payable",
      email: TDS_ACCOUNT_EMAIL,
      phone: TDS_ACCOUNT_PHONE,
      // Unusable password — this account is never meant to authenticate.
      passwordHash: `disabled:${crypto.randomBytes(24).toString("hex")}`,
      role: "FINANCE",
      status: "SUSPENDED",
      shopName: "Company TDS Payable",
    },
    select: { id: true },
  });
  cachedTdsAccountId = created.id;
  return created.id;
}

/**
 * Credit the TDS withheld from a single commission payout into the TDS Payable
 * account. Idempotency-keyed per (txn, payee) so replays / duplicate webhook
 * deliveries never double-record the liability — mirroring the payee's own
 * commission-credit idempotency.
 */
export async function creditTdsWithheld(
  txnId: string,
  payeeUserId: string,
  tds: Money | number,
  service: string,
  tx?: Prisma.TransactionClient
): Promise<void> {
  if (!gt(dec(tds), 0)) return;
  const accountId = await getTdsAccountId(tx);
  await creditWallet(
    {
      userId: accountId,
      amount: round(tds),
      reason: "TDS_WITHHELD",
      refType: "Transaction",
      refId: txnId,
      note: `TDS withheld on ${service} commission → ${payeeUserId}`,
      idempotencyKey: `tds-withheld:${txnId}:${payeeUserId}`,
    },
    tx
  );
}

/**
 * Debit the TDS Payable account when the withheld TDS is actually remitted to
 * the government (challan deposit). Idempotency-keyed on the caller-supplied
 * remittance reference so a re-submitted challan never double-debits.
 */
export async function debitTdsRemittance(
  remittanceRef: string,
  amount: Money | number,
  note: string,
  tx?: Prisma.TransactionClient
): Promise<void> {
  if (!gt(dec(amount), 0)) return;
  const accountId = await getTdsAccountId(tx);
  await debitWallet(
    {
      userId: accountId,
      amount: round(amount),
      reason: "TDS_WITHHELD",
      refType: "TdsRemittance",
      refId: remittanceRef,
      note,
      idempotencyKey: `tds-remit:${remittanceRef}`,
    },
    tx
  );
}
