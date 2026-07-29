import { flags } from "@/lib/env";
import { getSetting, isCardClassificationEnabled } from "@/lib/settings";
import { getPosTransactions, canonicalPosCaptureRef } from "@/lib/partners/sameday-pos";
import { handlePosCapture } from "@/lib/settlement/pos";
import { lookupBin, classificationFromBin } from "@/lib/pos/binLookup";
import type { PosTransaction } from "@/lib/partners/sameday-pos.types";

/**
 * POS capture ingestion.
 *
 * Same Day Solution does NOT POST capture webhooks to us — the dashboard only
 * *pulls* transactions for display. So nothing ever lands in the settlement
 * queue on its own. This sweep closes that gap: it pulls CAPTURED transactions
 * from the partner API and feeds each into handlePosCapture, which prices MDR
 * (brand rate card or the owner's unified Scheme) and creates a PENDING
 * settlement entry (idempotent per txn ref). The T+1 cron then settles them on
 * their capture day (capturedAt), or instant mode credits immediately.
 *
 * Safe to run repeatedly: handlePosCapture dedupes on transactionRef, so a
 * capture is only ever queued/credited once regardless of overlap between runs.
 */

export type PosIngestResult = {
  skipped: boolean;
  reason?: string;
  dateFrom?: string;
  dateTo?: string;
  scanned: number;
  queued: number;    // new PENDING/INSTANT entries created (QUEUED + SETTLED)
  duplicate: number; // already ingested
  noScheme: number;  // no brand rate / user scheme matched — could not price
  skippedRows: number; // no assigned/active user, non-positive net, etc.
};

/** Start of the IST day `days` ago, as a UTC ISO string. */
function istStartDaysAgoIso(days: number): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const startIstMs = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - days);
  return new Date(startIstMs - 5.5 * 60 * 60 * 1000).toISOString();
}

const up = (v: string | null | undefined) => {
  const s = (v ?? "").trim().toUpperCase();
  return s ? s : undefined;
};

/**
 * Stable, capture-unique reference. Uses the SAME canonical (RRN-based) key as
 * the real-time webhook so a swipe seen by both paths resolves to ONE
 * transactionRef — the @unique constraint then prevents a duplicate settlement
 * entry / commission. Falls back to the partner txn id when no RRN is present.
 */
function txnRef(t: PosTransaction): string {
  return canonicalPosCaptureRef({
    rrn: t.rrn,
    terminalId: t.terminal_id,
    fallbackId: t.razorpay_txn_id || t.external_ref || `SDP-${t.id}`,
  });
}

function parseCapturedAt(t: PosTransaction): Date | undefined {
  for (const raw of [t.txn_time, t.posting_date, t.created_at]) {
    if (!raw) continue;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return undefined;
}

export async function runPosIngestSweep(opts?: {
  dateFrom?: string;
  dateTo?: string;
  maxPages?: number;
}): Promise<PosIngestResult> {
  const base: PosIngestResult = {
    skipped: false,
    scanned: 0,
    queued: 0,
    duplicate: 0,
    noScheme: 0,
    skippedRows: 0,
  };

  if (!flags.pos) return { ...base, skipped: true, reason: "POS partner disabled" };

  const cfg = await getSetting("settlement.pos_ingest");
  if (!cfg.enabled || cfg.paused) return { ...base, skipped: true, reason: "ingest disabled/paused" };

  const dateFrom = opts?.dateFrom ?? istStartDaysAgoIso(cfg.lookbackDays);
  const dateTo = opts?.dateTo ?? new Date().toISOString();
  const maxPages = opts?.maxPages ?? cfg.maxPages;

  // Card classification off → don't derive tiers from BIN (no eKYC spend); MDR
  // prices on Card Category instead.
  const classificationEnabled = await isCardClassificationEnabled();

  base.dateFrom = dateFrom;
  base.dateTo = dateTo;

  for (let page = 1; page <= maxPages; page++) {
    const res = await getPosTransactions({
      date_from: dateFrom,
      date_to: dateTo,
      status: "CAPTURED",
      page,
      page_size: 100,
    });

    if (!res.ok) {
      // Surface the failure but keep whatever we ingested so far.
      return { ...base, reason: res.error.error?.message ?? "partner fetch failed" };
    }

    const rows = res.data.data ?? [];
    for (const t of rows) {
      base.scanned++;
      // Money guard: settle ONLY genuinely captured swipes. We already ask the
      // API for status=CAPTURED, but never trust a single query param — an
      // AUTHORIZED (held, not captured), FAILED, REFUNDED or VOIDED row must
      // never credit a wallet. Re-check each row's own status defensively.
      if (up(t.status) !== "CAPTURED") {
        base.skippedRows++;
        continue;
      }
      const grossAmount = Number(t.amount);
      if (!t.terminal_id || !Number.isFinite(grossAmount) || grossAmount <= 0) {
        base.skippedRows++;
        continue;
      }

      const paymentMode = up(t.payment_mode) ?? "CARD";
      // BIN fallback: when the acquirer feed omits classification but exposes a
      // card number (e.g. Teachway terminals), derive it from the BIN so MDR is
      // priced on the same card dimension as feeds that do provide it.
      let classification = up(t.card_classification);
      if (classificationEnabled && !classification && paymentMode === "CARD") {
        const bin = (t.card_number ?? "").replace(/\D/g, "").slice(0, 6);
        if (bin.length === 6) {
          try {
            const binData = await lookupBin(bin);
            if (binData) classification = classificationFromBin(binData);
          } catch {
            // Non-blocking: settle without classification if BIN lookup fails.
          }
        }
      }

      const result = await handlePosCapture({
        transactionRef: txnRef(t),
        terminalId: t.terminal_id,
        grossAmount,
        paymentMode,
        cardType: up(t.card_type),
        brandType: up(t.card_brand),
        classification,
        capturedAt: parseCapturedAt(t),
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

    if (!res.data.pagination?.has_next) break;
  }

  return base;
}
