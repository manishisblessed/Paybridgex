import { prisma } from "@/lib/db";
import { lookupBin, classificationFromBin } from "@/lib/pos/binLookup";
import { isCardClassificationEnabled } from "@/lib/settings";
import type { PosTransaction } from "@/lib/partners/sameday-pos.types";

/**
 * Enrich raw POS transactions from the partner feed with:
 *
 *  1. The **retailer who actually held the terminal** at the moment of the
 *     swipe, resolved from the assignment history (`PosAssignmentLog`). Each
 *     `assign` entry defines a holding window [assignedDate, returnedDate) —
 *     non-overlapping, since reassigning closes the previous window. So a swipe
 *     is attributed to whoever owned the machine then: never a later holder,
 *     and never anyone for pre-assignment swipes.
 *
 *  2. A **card classification** for rows missing it. Some acquirers return a
 *     card number but no `card_classification`; for those we derive it from the
 *     card BIN. Lookups are batched by unique 6-digit BIN and cache-first
 *     (CardBinCache), so repeats are cheap DB hits and only true misses reach
 *     the BIN provider.
 *
 * Shared by the live transactions feed and the full report export so both show
 * identical, complete data.
 */
export async function enrichPosTransactions(
  rows: PosTransaction[]
): Promise<PosTransaction[]> {
  if (rows.length === 0) return rows;

  const tids = [...new Set(rows.map((t) => t.terminal_id).filter(Boolean))];
  const machines = tids.length
    ? await prisma.posMachine.findMany({
        where: { tid: { in: tids } },
        select: {
          tid: true,
          assignedUserId: true,
          assignedAt: true,
          assignmentLogs: {
            where: { action: "assign", toUserId: { not: null } },
            select: {
              toUserId: true,
              assignedDate: true,
              createdAt: true,
              returnedDate: true,
            },
            orderBy: { createdAt: "asc" },
          },
        },
      })
    : [];

  type HoldingPeriod = { userId: string; start: Date; end: Date | null };
  const periodsByTid = new Map<string, HoldingPeriod[]>();
  const holderIds = new Set<string>();
  for (const m of machines) {
    if (!m.tid) continue;
    const periods: HoldingPeriod[] = [];
    for (const log of m.assignmentLogs) {
      if (!log.toUserId) continue;
      periods.push({
        userId: log.toUserId,
        start: log.assignedDate ?? log.createdAt,
        end: log.returnedDate,
      });
      holderIds.add(log.toUserId);
    }
    if (periods.length === 0 && m.assignedUserId && m.assignedAt) {
      periods.push({ userId: m.assignedUserId, start: m.assignedAt, end: null });
      holderIds.add(m.assignedUserId);
    }
    periodsByTid.set(m.tid, periods);
  }

  const holders = holderIds.size
    ? await prisma.user.findMany({
        where: { id: { in: [...holderIds] } },
        select: { id: true, name: true, shopName: true, userCode: true, role: true },
      })
    : [];
  const holderById = new Map(holders.map((u) => [u.id, u]));

  const resolveHolderId = (tid: string, at: Date): string | null => {
    const periods = periodsByTid.get(tid);
    if (!periods) return null;
    for (let i = periods.length - 1; i >= 0; i--) {
      const p = periods[i];
      if (at >= p.start && (p.end === null || at <= p.end)) return p.userId;
    }
    return null;
  };

  const enriched = rows.map((txn) => {
    const txnTime = new Date(txn.txn_time ?? txn.created_at);
    const holderId = !Number.isNaN(txnTime.getTime())
      ? resolveHolderId(txn.terminal_id, txnTime)
      : null;
    const u = holderId ? holderById.get(holderId) : null;
    const retailer = u
      ? {
          id: u.id,
          name: u.name,
          shopName: (u as { shopName?: string | null }).shopName ?? null,
          userCode: (u as { userCode?: string | null }).userCode ?? null,
          role: u.role,
        }
      : null;
    return { ...txn, retailer };
  });

  const binOf = (cardNumber: string | null | undefined) =>
    (cardNumber ?? "").replace(/\D/g, "").slice(0, 6);

  // Card classification (tier) turned off platform-wide → skip BIN backfill
  // entirely (no eKYC Hub lookups, no balance spend). Feed-provided values are
  // left untouched; whether they're shown is governed by the `showInUi` flag.
  const classificationEnabled = await isCardClassificationEnabled();

  const missingBins = new Set<string>();
  if (classificationEnabled) {
    for (const txn of enriched) {
      if (!txn.card_classification && txn.payment_mode === "CARD") {
        const bin = binOf(txn.card_number);
        if (bin.length === 6) missingBins.add(bin);
      }
    }
  }

  if (missingBins.size > 0) {
    const binList = [...missingBins];
    const looked = await Promise.all(
      binList.map(async (bin) => {
        try {
          return [bin, await lookupBin(bin)] as const;
        } catch {
          return [bin, null] as const;
        }
      })
    );
    const binToClassification = new Map(
      looked
        .map(([bin, res]) => [bin, res ? classificationFromBin(res) : undefined] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
    );

    for (const txn of enriched) {
      if (!txn.card_classification && txn.payment_mode === "CARD") {
        const label = binToClassification.get(binOf(txn.card_number));
        if (label) txn.card_classification = label;
      }
    }
  }

  return enriched;
}
