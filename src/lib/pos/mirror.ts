import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordPayin } from "@/lib/wallet/payin";
import { canonicalPosCaptureRef } from "@/lib/partners/sameday-pos";
import type {
  PosTransaction,
  PosTransactionStatus,
  PosTransactionsSummary,
} from "@/lib/partners/sameday-pos.types";

/**
 * POS transaction MIRROR — read-model access layer.
 *
 * The dashboard live feed and report exports read from the local
 * `PosTransactionMirror` table (see the model doc in schema.prisma) instead of
 * polling the Same Day partner API on every refresh. This module owns:
 *
 *   • upsert-from-feed   — used by the reconciliation sweep (partner is the
 *     authoritative source, so it overwrites the row's display fields).
 *   • upsert-from-webhook — used by the real-time capture webhook (only sets the
 *     fields the webhook carries, so it never nulls richer sweep data).
 *   • query + summarize   — indexed, paginated reads that back the API.
 *   • rowToFeedShape      — converts a DB row back into the partner
 *     `PosTransaction` shape the UI + enrichment already understand.
 *
 * All writes converge on the canonical RRN-based `transactionRef`, so the two
 * ingest paths can never create a duplicate row for one physical swipe.
 */

const up = (v: string | null | undefined): string | undefined => {
  const s = (v ?? "").trim().toUpperCase();
  return s ? s : undefined;
};

const clean = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim();
  return s ? s : null;
};

function toDate(...vals: (string | null | undefined)[]): Date | null {
  for (const raw of vals) {
    if (!raw) continue;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** Canonical, capture-unique key — identical to the settlement/ingest key. */
function feedTxnRef(t: PosTransaction): string {
  return canonicalPosCaptureRef({
    rrn: t.rrn,
    terminalId: t.terminal_id,
    fallbackId: t.razorpay_txn_id || t.external_ref || `SDP-${t.id}`,
  });
}

/**
 * Map a partner feed row into mirror columns. The partner feed is the
 * authoritative source, so these values are written on BOTH create and update.
 * Returns null when the row lacks the minimum needed to key/display it.
 */
function feedRowToMirrorData(
  t: PosTransaction
): { transactionRef: string; data: Prisma.PosTransactionMirrorUncheckedCreateInput } | null {
  const transactionRef = feedTxnRef(t);
  const terminalId = clean(t.terminal_id);
  if (!transactionRef || !terminalId) return null;

  const amount = Number(t.amount);
  if (!Number.isFinite(amount) || amount < 0) return null;

  const txnTime = toDate(t.txn_time, t.posting_date, t.created_at);
  if (!txnTime) return null;

  return {
    transactionRef,
    data: {
      transactionRef,
      externalId: Number.isFinite(t.id) ? Number(t.id) : null,
      terminalId,
      amount: t.amount,
      status: up(t.status) ?? "CAPTURED",
      paymentMode: up(t.payment_mode) ?? "CARD",
      currency: clean(t.currency) ?? "INR",
      rrn: clean(t.rrn),
      cardBrand: clean(t.card_brand),
      cardType: clean(t.card_type),
      cardNumber: clean(t.card_number),
      cardClassification: clean(t.card_classification),
      cardTxnType: clean(t.card_txn_type),
      issuingBank: clean(t.issuing_bank),
      acquiringBank: clean(t.acquiring_bank),
      razorpayTxnId: clean(t.razorpay_txn_id),
      externalRef: clean(t.external_ref),
      deviceSerial: clean(t.device_serial),
      mid: clean(t.mid),
      authCode: clean(t.auth_code),
      txnType: clean(t.txn_type),
      customerName: clean(t.customer_name),
      payerName: clean(t.payer_name),
      receiptUrl: clean(t.receipt_url),
      txnTime,
      postingDate: toDate(t.posting_date),
      partnerCreatedAt: toDate(t.created_at),
      raw: t as unknown as Prisma.InputJsonValue,
      source: "SWEEP",
    },
  };
}

/**
 * Snapshot the CURRENT mirror status for a set of refs. Must be read BEFORE the
 * upsert so we can tell whether a capture is landing as CAPTURED for the FIRST
 * time (new row, or a prior AUTHORIZED→CAPTURED transition) versus a re-sweep of
 * an already-CAPTURED row. Keyed on the canonical `transactionRef`.
 */
async function mirrorStatusByRef(refs: string[]): Promise<Map<string, string | undefined>> {
  if (refs.length === 0) return new Map();
  const rows = await prisma.posTransactionMirror.findMany({
    where: { transactionRef: { in: refs } },
    select: { transactionRef: true, status: true },
  });
  return new Map(rows.map((r) => [r.transactionRef, up(r.status)]));
}

/**
 * Credit the company PAYIN monitor for every POS capture the FIRST time its
 * mirror row reaches CAPTURED — so the PAYIN book tracks the RAW POS Fleet
 * captured volume (every terminal), not just the settleable subset.
 *
 * Forward-only by construction: `priorStatus` is captured BEFORE the upsert, so
 * rows that were already CAPTURED (e.g. today's existing captures) are skipped
 * on every re-sweep of the lookback window — no accidental backfill. Best-effort
 * and idempotency-keyed (`payin:pos:<ref>`), so retries never double count.
 */
async function recordPosPayinForCaptures(
  entries: { transactionRef: string; status: string; amount: string; paymentMode: string }[],
  priorStatus: Map<string, string | undefined>
): Promise<void> {
  for (const e of entries) {
    if (e.status !== "CAPTURED") continue; // only captured swipes are business
    if (priorStatus.get(e.transactionRef) === "CAPTURED") continue; // already counted
    await recordPayin({
      rail: "POS",
      grossAmount: e.amount,
      refType: "PosTransactionMirror",
      refId: e.transactionRef,
      note: `POS payin (${e.paymentMode})`,
    });
  }
}

/**
 * Upsert a batch of partner feed rows into the mirror. Feed data is
 * authoritative, so existing rows are refreshed with the feed's values (this is
 * how the sweep repairs / completes rows first seen via the webhook). Returns
 * how many rows were written (created or updated) and how many were skipped.
 */
export async function upsertMirrorFromFeed(
  rows: PosTransaction[]
): Promise<{ written: number; skipped: number }> {
  let written = 0;
  let skipped = 0;

  const mapped = rows
    .map((t) => feedRowToMirrorData(t))
    .filter((m): m is NonNullable<typeof m> => m !== null);
  skipped += rows.length - mapped.length;

  // Snapshot prior statuses BEFORE writing so the payin monitor can fire only on
  // the first CAPTURED transition (forward-only; re-sweeps never backfill).
  const priorStatus = await mirrorStatusByRef(mapped.map((m) => m.transactionRef));

  const BATCH = 25;
  for (let i = 0; i < mapped.length; i += BATCH) {
    const slice = mapped.slice(i, i + BATCH);
    await Promise.all(
      slice.map(({ transactionRef, data }) => {
        // On update, keep feed provenance but never clobber a WEBHOOK row's
        // source label with SWEEP if it was created by the webhook — the field
        // is informational only, so we let the feed's SWEEP label win (the feed
        // is the completeness source). `raw` + display fields are refreshed.
        const { source: _source, ...update } = data;
        return prisma.posTransactionMirror.upsert({
          where: { transactionRef },
          create: data,
          update,
        });
      })
    );
    written += slice.length;
  }

  // Mirror the GROSS of newly-captured rows into the company payin wallet.
  await recordPosPayinForCaptures(
    mapped.map(({ transactionRef, data }) => ({
      transactionRef,
      status: String(data.status ?? "CAPTURED"),
      amount: String(data.amount),
      paymentMode: String(data.paymentMode ?? "CARD"),
    })),
    priorStatus
  );

  return { written, skipped };
}

/**
 * Real-time upsert from the capture webhook. Only the fields the webhook
 * carries are written, so a subsequent sweep (or a prior sweep row) is never
 * nulled out. Safe to call for every verified CAPTURED webhook.
 */
export async function upsertMirrorFromWebhook(input: {
  transactionRef: string;
  terminalId: string;
  grossAmount: number;
  paymentMode: string;
  status?: string;
  rrn?: string | null;
  cardType?: string | null;
  cardBrand?: string | null;
  cardClassification?: string | null;
  cardNumber?: string | null;
  acquiringBank?: string | null;
  authCode?: string | null;
  customerName?: string | null;
  mid?: string | null;
  externalId?: number | null;
  txnTime?: Date | null;
  raw?: unknown;
}): Promise<void> {
  const terminalId = clean(input.terminalId);
  if (!input.transactionRef || !terminalId) return;
  if (!(input.grossAmount > 0)) return;

  const txnTime = input.txnTime ?? new Date();
  const status = up(input.status) ?? "CAPTURED";
  const paymentMode = up(input.paymentMode) ?? "CARD";

  // Only the fields the webhook actually provides — undefined values are left
  // untouched by Prisma on update, preserving any richer sweep-sourced data.
  const shared = {
    terminalId,
    amount: input.grossAmount,
    status,
    paymentMode,
    rrn: clean(input.rrn) ?? undefined,
    cardType: clean(input.cardType) ?? undefined,
    cardBrand: clean(input.cardBrand) ?? undefined,
    cardClassification: clean(input.cardClassification) ?? undefined,
    cardNumber: clean(input.cardNumber) ?? undefined,
    acquiringBank: clean(input.acquiringBank) ?? undefined,
    authCode: clean(input.authCode) ?? undefined,
    customerName: clean(input.customerName) ?? undefined,
    mid: clean(input.mid) ?? undefined,
    externalId: input.externalId ?? undefined,
    txnTime,
  } satisfies Prisma.PosTransactionMirrorUncheckedUpdateInput;

  // Prior status BEFORE the upsert → detect the first CAPTURED transition for
  // the payin monitor (forward-only; a re-delivered CAPTURED webhook is a no-op).
  const priorStatus = up(
    (
      await prisma.posTransactionMirror.findUnique({
        where: { transactionRef: input.transactionRef },
        select: { status: true },
      })
    )?.status
  );

  await prisma.posTransactionMirror.upsert({
    where: { transactionRef: input.transactionRef },
    create: {
      transactionRef: input.transactionRef,
      currency: "INR",
      source: "WEBHOOK",
      raw: (input.raw ?? undefined) as Prisma.InputJsonValue | undefined,
      ...shared,
    },
    update: shared,
  });

  // Mirror the GROSS into the company payin wallet the first time this capture
  // lands as CAPTURED (matches the raw POS Fleet volume). Best-effort + keyed.
  if (status === "CAPTURED" && priorStatus !== "CAPTURED") {
    await recordPayin({
      rail: "POS",
      grossAmount: input.grossAmount,
      refType: "PosTransactionMirror",
      refId: input.transactionRef,
      note: `POS payin (${paymentMode})`,
    });
  }
}

// ── Read side ──────────────────────────────────────────────────────────────

type MirrorRow = Prisma.PosTransactionMirrorGetPayload<Record<string, never>>;

/** Convert a mirror DB row back into the partner `PosTransaction` UI shape. */
export function rowToFeedShape(row: MirrorRow): PosTransaction {
  return {
    id: row.externalId ?? 0,
    razorpay_txn_id: row.razorpayTxnId ?? "",
    external_ref: row.externalRef ?? "",
    terminal_id: row.terminalId,
    amount: row.amount.toString(),
    status: (up(row.status) ?? "CAPTURED") as PosTransactionStatus,
    rrn: row.rrn ?? "",
    card_brand: row.cardBrand ?? "",
    card_type: row.cardType ?? "",
    card_number: row.cardNumber ?? "",
    issuing_bank: row.issuingBank,
    card_classification: row.cardClassification,
    card_txn_type: row.cardTxnType,
    acquiring_bank: row.acquiringBank,
    payment_mode: row.paymentMode,
    device_serial: row.deviceSerial ?? "",
    customer_name: row.customerName ?? "",
    payer_name: row.payerName ?? "",
    txn_type: row.txnType ?? "",
    auth_code: row.authCode ?? "",
    mid: row.mid ?? "",
    currency: row.currency,
    receipt_url: row.receiptUrl ?? "",
    posting_date: row.postingDate ? row.postingDate.toISOString() : "",
    txn_time: row.txnTime.toISOString(),
    created_at: (row.partnerCreatedAt ?? row.createdAt).toISOString(),
  };
}

export type MirrorQueryFilters = {
  dateFrom: Date;
  dateTo: Date;
  status?: PosTransactionStatus | null;
  paymentMode?: string | null;
  /**
   * Terminal scope. `null` = tenant-wide (admin only, no terminal filter).
   * Otherwise an OR of terminal windows: each terminal may carry a `from`
   * clamp (the assignment date) so a holder never sees a prior holder's rows.
   */
  terminals: { tid: string; from?: Date | null }[] | null;
};

/** True when the scope resolved to zero terminals → the caller returns empty. */
export function isEmptyScope(filters: MirrorQueryFilters): boolean {
  return Array.isArray(filters.terminals) && filters.terminals.length === 0;
}

function buildWhere(filters: MirrorQueryFilters): Prisma.PosTransactionMirrorWhereInput {
  const base: Prisma.PosTransactionMirrorWhereInput = {
    txnTime: { gte: filters.dateFrom, lte: filters.dateTo },
  };
  if (filters.status) base.status = filters.status;
  if (filters.paymentMode) base.paymentMode = filters.paymentMode;

  if (filters.terminals === null) return base; // tenant-wide (admin)

  // Per-terminal windows: each terminal clamps its lower bound to max(dateFrom,
  // assignedAt) so pre-assignment rows stay hidden from the current holder.
  base.OR = filters.terminals.map((t) => {
    const from = t.from && t.from > filters.dateFrom ? t.from : filters.dateFrom;
    return { terminalId: t.tid, txnTime: { gte: from, lte: filters.dateTo } };
  });
  return base;
}

/** One page of mirror rows (newest first) plus the total matching count. */
export async function queryMirrorPage(
  filters: MirrorQueryFilters,
  page: number,
  pageSize: number
): Promise<{ rows: PosTransaction[]; total: number }> {
  if (isEmptyScope(filters)) return { rows: [], total: 0 };

  const where = buildWhere(filters);
  const [rows, total] = await Promise.all([
    prisma.posTransactionMirror.findMany({
      where,
      orderBy: [{ txnTime: "desc" }, { externalId: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.posTransactionMirror.count({ where }),
  ]);

  return { rows: rows.map(rowToFeedShape), total };
}

/** Aggregate summary over the FULL filtered set (not just the page). */
export async function summarizeMirror(
  filters: MirrorQueryFilters
): Promise<PosTransactionsSummary> {
  const empty: PosTransactionsSummary = {
    total_transactions: 0,
    total_amount: "0.00",
    authorized_count: 0,
    captured_count: 0,
    failed_count: 0,
    refunded_count: 0,
    captured_amount: "0.00",
    terminal_count: 0,
  };
  if (isEmptyScope(filters)) return empty;

  const where = buildWhere(filters);
  const [byStatus, byTerminal] = await Promise.all([
    prisma.posTransactionMirror.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.posTransactionMirror.groupBy({ by: ["terminalId"], where, _count: { _all: true } }),
  ]);

  let total = 0;
  let totalAmount = 0;
  let capturedAmount = 0;
  const counts = { AUTHORIZED: 0, CAPTURED: 0, FAILED: 0, REFUNDED: 0, VOIDED: 0 } as Record<string, number>;

  for (const g of byStatus) {
    const n = g._count._all;
    const amt = Number(g._sum.amount ?? 0);
    total += n;
    totalAmount += amt;
    const s = (up(g.status) ?? "") as string;
    if (s in counts) counts[s] += n;
    if (s === "CAPTURED") capturedAmount += amt;
  }

  return {
    total_transactions: total,
    total_amount: totalAmount.toFixed(2),
    authorized_count: counts.AUTHORIZED,
    captured_count: counts.CAPTURED,
    failed_count: counts.FAILED,
    refunded_count: counts.REFUNDED,
    captured_amount: capturedAmount.toFixed(2),
    terminal_count: byTerminal.length,
  };
}

/**
 * Every mirror row matching the filters (capped), newest first — backs the
 * report export so downloads contain the complete filtered dataset.
 */
export async function queryMirrorAll(
  filters: MirrorQueryFilters,
  cap: number
): Promise<{ rows: PosTransaction[]; total: number; truncated: boolean }> {
  if (isEmptyScope(filters)) return { rows: [], total: 0, truncated: false };

  const where = buildWhere(filters);
  const total = await prisma.posTransactionMirror.count({ where });
  const rows = await prisma.posTransactionMirror.findMany({
    where,
    orderBy: [{ txnTime: "desc" }, { externalId: "desc" }, { id: "desc" }],
    take: cap,
  });
  return { rows: rows.map(rowToFeedShape), total, truncated: total > rows.length };
}
