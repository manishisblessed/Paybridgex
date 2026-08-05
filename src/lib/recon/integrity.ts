import type { WalletType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dec, eq, toFixedString, type Money } from "@/lib/money";
import { sendOpsAlert } from "@/lib/monitoring/alerts";
import { logger } from "@/lib/logger";

/**
 * Ledger integrity audit — proves, for every user, that the denormalized
 * balances on the User row agree with the authoritative records:
 *
 *   1. BALANCE_VS_LEDGER   — walletBalance must equal Σ(CREDIT) − Σ(DEBIT)
 *                            over the user's WalletTxn history (opening
 *                            balance is always 0; every movement is a txn).
 *   2. PASSBOOK_CONTINUITY — the newest WalletTxn.balanceAfter must equal the
 *                            current walletBalance (catches lost updates).
 *   3. HELD_VS_INFLIGHT    — heldBalance must equal Σ(totalDebit) of payouts
 *                            still holding funds (PENDING_APPROVAL, APPROVED,
 *                            PROCESSING).
 *   4. LIEN_VS_ACTIVE      — lienBalance must equal Σ(amount − recoveredAmount)
 *                            over the user's ACTIVE liens (the outstanding
 *                            chargeback/fraud freeze).
 *
 * Any mismatch means money silently appeared or disappeared — a critical
 * incident. Findings are persisted to AuditLog (action recon.ledger_mismatch)
 * for the admin console and pushed to the ops alert webhook.
 *
 * The audit is read-only: it NEVER mutates balances. Fixing a mismatch is a
 * deliberate human decision (ADJUSTMENT entry), not an automated one.
 */

export type IntegrityFinding = {
  userId: string;
  check:
    | "BALANCE_VS_LEDGER"
    | "AEPS_VS_LEDGER"
    | "REVENUE_VS_LEDGER"
    | "PAYIN_VS_LEDGER"
    | "PASSBOOK_CONTINUITY"
    | "HELD_VS_INFLIGHT"
    | "LIEN_VS_ACTIVE";
  /** Which wallet book the finding relates to (for the per-book ledger checks). */
  book?: WalletType;
  expected: string;
  actual: string;
};

export type IntegrityReport = {
  ranAt: string;
  usersChecked: number;
  findings: IntegrityFinding[];
  ok: boolean;
};

/** The wallet books tracked per user, mapped to their denormalized column. */
const BOOK_COLUMN: Record<WalletType, "walletBalance" | "aepsBalance" | "revenueBalance" | "payinBalance"> = {
  PRIMARY: "walletBalance",
  AEPS: "aepsBalance",
  REVENUE: "revenueBalance",
  PAYIN: "payinBalance",
};

const BOOK_CHECK: Record<WalletType, IntegrityFinding["check"]> = {
  PRIMARY: "BALANCE_VS_LEDGER",
  AEPS: "AEPS_VS_LEDGER",
  REVENUE: "REVENUE_VS_LEDGER",
  PAYIN: "PAYIN_VS_LEDGER",
};

type BookMap = Map<string, Map<WalletType, Money>>;

function setBook(map: BookMap, userId: string, book: WalletType, value: Money) {
  let inner = map.get(userId);
  if (!inner) {
    inner = new Map();
    map.set(userId, inner);
  }
  inner.set(book, value);
}

/**
 * Σ(CREDIT) − Σ(DEBIT) per user PER WALLET BOOK. Each book (PRIMARY / AEPS /
 * REVENUE / PAYIN) keeps its own balanceAfter chain and denormalized column, so
 * reconciliation is per-book — mixing them would flag every multi-book account
 * (e.g. the platform-owner account that holds REVENUE + PAYIN).
 */
async function ledgerNetByUserBook(): Promise<BookMap> {
  const grouped = await prisma.walletTxn.groupBy({
    by: ["userId", "walletType", "direction"],
    _sum: { amount: true },
  });
  const net: BookMap = new Map();
  for (const row of grouped) {
    const inner = net.get(row.userId) ?? new Map<WalletType, Money>();
    const prev = inner.get(row.walletType) ?? dec(0);
    const sum = dec(row._sum.amount ?? 0);
    inner.set(row.walletType, row.direction === "CREDIT" ? prev.add(sum) : prev.sub(sum));
    net.set(row.userId, inner);
  }
  return net;
}

/** Latest balanceAfter per user PER WALLET BOOK in a single scan (DISTINCT ON). */
async function latestBalanceAfterByUserBook(): Promise<BookMap> {
  const rows = await prisma.$queryRaw<{ userId: string; walletType: WalletType; balanceAfter: unknown }[]>`
    SELECT DISTINCT ON ("userId", "walletType") "userId", "walletType", "balanceAfter"
    FROM "WalletTxn"
    ORDER BY "userId", "walletType", "createdAt" DESC, "id" DESC
  `;
  const map: BookMap = new Map();
  for (const row of rows) setBook(map, row.userId, row.walletType, dec(String(row.balanceAfter)));
  return map;
}

/** Σ(totalDebit) of fund-holding payouts per user. */
async function heldByUser(): Promise<Map<string, Money>> {
  const grouped = await prisma.payoutRequest.groupBy({
    by: ["userId"],
    where: { status: { in: ["PENDING_APPROVAL", "APPROVED", "PROCESSING"] } },
    _sum: { totalDebit: true },
  });
  const map = new Map<string, Money>();
  for (const row of grouped) map.set(row.userId, dec(row._sum.totalDebit ?? 0));
  return map;
}

/** Σ(amount − recoveredAmount) of ACTIVE liens per user (the outstanding freeze). */
async function activeLienByUser(): Promise<Map<string, Money>> {
  const liens = await prisma.walletLien.findMany({
    where: { status: "ACTIVE" },
    select: { targetUserId: true, amount: true, recoveredAmount: true },
  });
  const map = new Map<string, Money>();
  for (const l of liens) {
    const outstanding = dec(l.amount).sub(dec(l.recoveredAmount));
    const add = outstanding.gt(0) ? outstanding : dec(0);
    map.set(l.targetUserId, (map.get(l.targetUserId) ?? dec(0)).add(add));
  }
  return map;
}

/**
 * Run the full integrity audit. Read-only; safe to run any time. Persists a
 * summary AuditLog row (recon.ledger_audit) plus one row per mismatch.
 */
export async function runLedgerIntegrityAudit(): Promise<IntegrityReport> {
  const ranAt = new Date().toISOString();

  const [users, ledgerNet, lastBalanceAfter, held, activeLien] = await Promise.all([
    prisma.user.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        walletBalance: true,
        aepsBalance: true,
        revenueBalance: true,
        payinBalance: true,
        heldBalance: true,
        lienBalance: true,
      },
    }),
    ledgerNetByUserBook(),
    latestBalanceAfterByUserBook(),
    heldByUser(),
    activeLienByUser(),
  ]);

  const findings: IntegrityFinding[] = [];
  const BOOKS: WalletType[] = ["PRIMARY", "AEPS", "REVENUE", "PAYIN"];

  for (const user of users) {
    const balance = dec(user.walletBalance);
    const heldBalance = dec(user.heldBalance);
    const netByBook = ledgerNet.get(user.id);
    const lastByBook = lastBalanceAfter.get(user.id);

    // Per-book reconciliation: each book's column must equal Σ(CREDIT)−Σ(DEBIT)
    // over that book's txns, and match the newest balanceAfter in that book.
    for (const book of BOOKS) {
      const column = dec(user[BOOK_COLUMN[book]]);
      const net = netByBook?.get(book) ?? dec(0);
      if (!eq(column, net)) {
        findings.push({
          userId: user.id,
          check: BOOK_CHECK[book],
          book,
          expected: toFixedString(net),
          actual: toFixedString(column),
        });
      }
      const lastAfter = lastByBook?.get(book);
      if (lastAfter !== undefined && !eq(column, lastAfter)) {
        findings.push({
          userId: user.id,
          check: "PASSBOOK_CONTINUITY",
          book,
          expected: toFixedString(lastAfter),
          actual: toFixedString(column),
        });
      }
    }

    const expectedHeld = held.get(user.id) ?? dec(0);
    if (!eq(heldBalance, expectedHeld)) {
      findings.push({
        userId: user.id,
        check: "HELD_VS_INFLIGHT",
        expected: toFixedString(expectedHeld),
        actual: toFixedString(heldBalance),
      });
    }

    const lienBalance = dec(user.lienBalance);
    const expectedLien = activeLien.get(user.id) ?? dec(0);
    if (!eq(lienBalance, expectedLien)) {
      findings.push({
        userId: user.id,
        check: "LIEN_VS_ACTIVE",
        expected: toFixedString(expectedLien),
        actual: toFixedString(lienBalance),
      });
    }
  }

  const report: IntegrityReport = {
    ranAt,
    usersChecked: users.length,
    findings,
    ok: findings.length === 0,
  };

  // Persist: one summary row always, one detail row per finding.
  await prisma.auditLog.create({
    data: {
      action: "recon.ledger_audit",
      entity: "System",
      meta: {
        ranAt,
        usersChecked: report.usersChecked,
        findingCount: findings.length,
        ok: report.ok,
      },
    },
  });
  for (const f of findings) {
    await prisma.auditLog.create({
      data: {
        userId: f.userId,
        action: "recon.ledger_mismatch",
        entity: "User",
        entityId: f.userId,
        meta: { check: f.check, book: f.book ?? null, expected: f.expected, actual: f.actual, ranAt },
      },
    });
  }

  if (findings.length > 0) {
    await sendOpsAlert({
      title: "Ledger integrity audit found mismatches",
      severity: "critical",
      details: {
        usersChecked: report.usersChecked,
        mismatches: findings.length,
        affectedUsers: Array.from(new Set(findings.map((f) => f.userId))).length,
        firstCheckFailed: findings[0].check,
      },
    });
  } else {
    logger.info({
      action: "recon.ledger_audit_ok",
      usersChecked: report.usersChecked,
    });
  }

  return report;
}
