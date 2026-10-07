import { prisma } from "@/lib/db";
import { add, dec, round, toNumber } from "@/lib/money";

/**
 * Ledger charge breakdown.
 *
 * A WalletTxn row only stores the NET wallet movement (`amount`). For rails
 * that layer charges on top of a base amount we join the source record to
 * surface the breakdown — the base transaction amount vs. the charges:
 *   • PayoutRequest  → txnAmount = amount, charges = serviceCharge + gst
 *                      (WalletTxn.amount == totalDebit == amount + charges)
 *   • Transaction    → txnAmount = amount, charges = fee
 *                      (WalletTxn.amount == amount + fee)
 * Everything else has no charge component → both null (render as "—").
 */

export type LedgerBreakdown = { txnAmount: number | null; charges: number | null };

export type BreakdownRow = { refType: string | null; refId: string | null };

/**
 * Batch-resolve the charge breakdown for a page of ledger rows. Fetches each
 * source model once (no N+1) and returns a lookup fn keyed by the row's
 * refType/refId.
 */
export async function buildBreakdowns(
  rows: BreakdownRow[]
): Promise<(r: BreakdownRow) => LedgerBreakdown> {
  const payoutIds = [
    ...new Set(
      rows.filter((r) => r.refType === "PayoutRequest" && r.refId).map((r) => r.refId as string)
    ),
  ];
  const txnIds = [
    ...new Set(
      rows.filter((r) => r.refType === "Transaction" && r.refId).map((r) => r.refId as string)
    ),
  ];

  const [payouts, txns] = await Promise.all([
    payoutIds.length
      ? prisma.payoutRequest.findMany({
          where: { id: { in: payoutIds } },
          select: { id: true, amount: true, serviceCharge: true, gst: true },
        })
      : Promise.resolve([]),
    txnIds.length
      ? prisma.transaction.findMany({
          where: { id: { in: txnIds } },
          select: { id: true, amount: true, fee: true },
        })
      : Promise.resolve([]),
  ]);

  const payoutMap = new Map(payouts.map((p) => [p.id, p]));
  const txnMap = new Map(txns.map((t) => [t.id, t]));

  return (r: BreakdownRow): LedgerBreakdown => {
    if (r.refType === "PayoutRequest" && r.refId) {
      const p = payoutMap.get(r.refId);
      if (p)
        return {
          txnAmount: toNumber(dec(p.amount)),
          charges: toNumber(round(add(dec(p.serviceCharge), dec(p.gst)))),
        };
    }
    if (r.refType === "Transaction" && r.refId) {
      const t = txnMap.get(r.refId);
      if (t) return { txnAmount: toNumber(dec(t.amount)), charges: toNumber(dec(t.fee)) };
    }
    return { txnAmount: null, charges: null };
  };
}
