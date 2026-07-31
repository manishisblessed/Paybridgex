import { flags } from "@/lib/env";
import { getSetting, isCardClassificationEnabled } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { handlePosCapture } from "@/lib/settlement/pos";

/**
 * POS settlement sweep — MIRROR-DRIVEN.
 *
 * The `PosTransactionMirror` read-model is now the single source of truth for
 * POS transactions (populated by the capture webhook + the reconciliation
 * sweep). Rather than pulling the partner API a SECOND time to feed settlement,
 * this sweep reads CAPTURED rows straight from our own DB and feeds each into
 * `handlePosCapture`, which prices MDR (brand rate card or the retailer's
 * unified Scheme), creates a PENDING/INSTANT settlement entry, and distributes
 * upline commission. The T+1 cron then settles PENDING entries on their capture
 * day; instant mode credits immediately.
 *
 * Only genuinely settleable captures are processed: we pre-resolve the set of
 * terminals that are (a) assigned to a retailer AND (b) whose retailer is ACTIVE
 * with an assigned scheme, then query the mirror for just those terminals.
 * `handlePosCapture`'s own gates (assigned / active / priceable) remain the
 * final safety net, so an unpriceable capture is surfaced as `noScheme` rather
 * than settled.
 *
 * Fully idempotent: `handlePosCapture` dedupes on the canonical `transactionRef`
 * (the mirror uses the SAME key), so overlapping/retried runs never double-book.
 */

export type PosMirrorSettleResult = {
  skipped: boolean;
  reason?: string;
  dateFrom?: string;
  dateTo?: string;
  eligibleTerminals: number;
  scanned: number;
  queued: number; // new PENDING/INSTANT (or instantly SETTLED) entries created
  duplicate: number; // already had a settlement entry
  noScheme: number; // assigned but not priceable (no scheme/rate) — needs admin
  skippedRows: number; // no assigned/active user, non-positive net, bad row
};

/** Start of the IST day `days` ago, as a UTC Date. */
function istStartDaysAgo(days: number): Date {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const startIstMs = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - days);
  return new Date(startIstMs - 5.5 * 60 * 60 * 1000);
}

/**
 * Resolve the terminal IDs eligible for settlement: assigned to an ACTIVE
 * retailer who has a scheme assigned. Brand-priced machines don't strictly need
 * a user scheme, so those are included whenever assigned to an active user too.
 */
async function eligibleTerminalIds(): Promise<string[]> {
  const machines = await prisma.posMachine.findMany({
    where: {
      tid: { not: null },
      assignedUserId: { not: null },
      assignedUser: { status: "ACTIVE" },
      OR: [
        // Retailer-scheme priced: retailer must carry a scheme.
        { assignedUser: { schemeId: { not: null } } },
        // Brand-priced: the brand rate card prices it regardless of user scheme.
        { brandId: { not: null } },
      ],
    },
    select: { tid: true },
  });
  const tids = new Set<string>();
  for (const m of machines) if (m.tid) tids.add(m.tid);
  return [...tids];
}

export async function runPosMirrorSettleSweep(opts?: {
  dateFrom?: string;
  dateTo?: string;
  lookbackDays?: number;
  /** Cap on rows processed per run (safety valve for large backfills). */
  maxRows?: number;
}): Promise<PosMirrorSettleResult> {
  const base: PosMirrorSettleResult = {
    skipped: false,
    eligibleTerminals: 0,
    scanned: 0,
    queued: 0,
    duplicate: 0,
    noScheme: 0,
    skippedRows: 0,
  };

  if (!flags.pos) return { ...base, skipped: true, reason: "POS partner disabled" };

  // Re-use the ingest knobs so the admin has ONE place to enable/pause the
  // money-moving POS pipeline and set the lookback window.
  const cfg = await getSetting("settlement.pos_ingest");
  if (!cfg.enabled || cfg.paused)
    return { ...base, skipped: true, reason: "settlement sweep disabled/paused" };

  const lookbackDays = opts?.lookbackDays ?? cfg.lookbackDays;
  const dateFrom = opts?.dateFrom ? new Date(opts.dateFrom) : istStartDaysAgo(lookbackDays);
  const dateTo = opts?.dateTo ? new Date(opts.dateTo) : new Date();
  const maxRows = opts?.maxRows ?? 5000;

  base.dateFrom = dateFrom.toISOString();
  base.dateTo = dateTo.toISOString();

  const tids = await eligibleTerminalIds();
  base.eligibleTerminals = tids.length;
  if (tids.length === 0) return base; // nothing assigned+schemed → nothing to settle

  // Card classification off → don't pass a tier the MDR resolver would ignore.
  const classificationEnabled = await isCardClassificationEnabled();

  // Pull captured mirror rows for eligible terminals in the window, oldest
  // first so T+1 due-dates process in capture order.
  const rows = await prisma.posTransactionMirror.findMany({
    where: {
      status: "CAPTURED",
      terminalId: { in: tids },
      txnTime: { gte: dateFrom, lte: dateTo },
    },
    orderBy: { txnTime: "asc" },
    take: maxRows,
  });

  for (const t of rows) {
    base.scanned++;

    const grossAmount = Number(t.amount);
    if (!t.terminalId || !Number.isFinite(grossAmount) || grossAmount <= 0) {
      base.skippedRows++;
      continue;
    }

    const result = await handlePosCapture({
      transactionRef: t.transactionRef,
      terminalId: t.terminalId,
      grossAmount,
      paymentMode: t.paymentMode ?? "CARD",
      cardType: t.cardType ?? undefined,
      brandType: t.cardBrand ?? undefined,
      classification: classificationEnabled ? t.cardClassification ?? undefined : undefined,
      capturedAt: t.txnTime,
      // company is resolved from the machine inside handlePosCapture.
    });

    switch (result.status) {
      case "SETTLED":
      case "QUEUED":
        base.queued++;
        break;
      case "DUPLICATE":
        base.duplicate++;
        break;
      case "NO_SCHEME":
        base.noScheme++;
        break;
      default:
        base.skippedRows++;
    }
  }

  return base;
}
