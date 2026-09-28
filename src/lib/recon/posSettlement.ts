import { prisma } from "@/lib/db";
import { dec, toFixedString } from "@/lib/money";
import { sendOpsAlert } from "@/lib/monitoring/alerts";
import { logger } from "@/lib/logger";

/**
 * POS settlement integrity tripwire — proves that no money-active settlement
 * entry is sitting on a transaction that is NOT a genuine capture.
 *
 * A `PosSettlementEntry` that is SETTLED (money already credited) or PENDING
 * (about to be credited by the T+1 cron) MUST correspond to a
 * `PosTransactionMirror` row whose status is CAPTURED. Two ways that invariant
 * can break, both of which mean the retailer is paid for a non-sale:
 *
 *   • NON_CAPTURED — the mirror flipped to FAILED / VOIDED / REFUNDED /
 *     AUTHORIZED but the entry was never cancelled (the class of bug behind the
 *     28-Sep ROHIT SONI ₹1,19,989 overpayment).
 *   • ORPHAN       — the entry has no mirror row at all (deleted / key drift).
 *
 * A REVERSED entry on a non-captured mirror is the CORRECT resolved state and is
 * intentionally NOT flagged. Read-only: this NEVER mutates money or entries —
 * remediation (reversal + clawback) is a deliberate human action.
 *
 * Findings are persisted to AuditLog (recon.pos_settlement_audit summary +
 * recon.pos_settlement_mismatch per finding) and pushed to the ops alert webhook
 * so an operator hears about it the morning after, not weeks later.
 */

export type PosSettlementFindingKind = "NON_CAPTURED" | "ORPHAN";

export type PosSettlementFinding = {
  transactionRef: string;
  kind: PosSettlementFindingKind;
  entryStatus: string;
  mirrorStatus: string | null;
  netAmount: string;
  userId: string;
};

export type PosSettlementAuditReport = {
  ranAt: string;
  entriesChecked: number;
  findings: PosSettlementFinding[];
  ok: boolean;
};

/**
 * Classify one settlement-entry / mirror pair. Pure + exported so the money rule
 * is unit-tested in isolation. Returns the finding kind, or null when the pair
 * is healthy or not money-active.
 */
export function classifyPosSettlementFinding(
  entryStatus: string | null | undefined,
  mirrorStatus: string | null | undefined
): PosSettlementFindingKind | null {
  const entry = (entryStatus ?? "").trim().toUpperCase();
  if (entry !== "SETTLED" && entry !== "PENDING") return null; // not money-active
  const mirror = (mirrorStatus ?? "").trim().toUpperCase();
  if (!mirror) return "ORPHAN"; // no mirror row backing a paid/queued entry
  if (mirror !== "CAPTURED") return "NON_CAPTURED"; // paid on a failed/void/refund
  return null;
}

type RawRow = {
  transactionRef: string;
  entryStatus: string;
  mirrorStatus: string | null;
  grossAmount: string;
  mdrAmount: string;
  userId: string;
};

/**
 * Run the POS settlement integrity audit. Read-only; safe to run any time. A
 * single indexed LEFT JOIN (both tables key on the unique `transactionRef`)
 * returns only the offending rows, so the cost is bounded regardless of history.
 */
export async function runPosSettlementIntegrityAudit(): Promise<PosSettlementAuditReport> {
  const ranAt = new Date().toISOString();

  // Only the bad rows: money-active entries whose mirror is missing or not a
  // genuine capture. The DB does the filtering; the result set is tiny.
  const rows = await prisma.$queryRaw<RawRow[]>`
    SELECT e."transactionRef" AS "transactionRef",
           e."status"         AS "entryStatus",
           m."status"         AS "mirrorStatus",
           e."grossAmount"    AS "grossAmount",
           e."mdrAmount"      AS "mdrAmount",
           e."userId"         AS "userId"
    FROM "PosSettlementEntry" e
    LEFT JOIN "PosTransactionMirror" m ON m."transactionRef" = e."transactionRef"
    WHERE e."status" IN ('SETTLED', 'PENDING')
      AND (m."transactionRef" IS NULL OR UPPER(m."status") <> 'CAPTURED')
  `;

  const entriesChecked = await prisma.posSettlementEntry.count({
    where: { status: { in: ["SETTLED", "PENDING"] } },
  });

  const findings: PosSettlementFinding[] = [];
  for (const r of rows) {
    const kind = classifyPosSettlementFinding(r.entryStatus, r.mirrorStatus);
    if (!kind) continue; // defensive — the SQL should only return offenders
    const net = dec(String(r.grossAmount)).sub(dec(String(r.mdrAmount)));
    findings.push({
      transactionRef: r.transactionRef,
      kind,
      entryStatus: r.entryStatus,
      mirrorStatus: r.mirrorStatus,
      netAmount: toFixedString(net),
      userId: r.userId,
    });
  }

  const report: PosSettlementAuditReport = {
    ranAt,
    entriesChecked,
    findings,
    ok: findings.length === 0,
  };

  // Persist: one summary row always, one detail row per finding.
  await prisma.auditLog.create({
    data: {
      action: "recon.pos_settlement_audit",
      entity: "System",
      meta: { ranAt, entriesChecked, findingCount: findings.length, ok: report.ok },
    },
  });
  for (const f of findings) {
    await prisma.auditLog.create({
      data: {
        userId: f.userId,
        action: "recon.pos_settlement_mismatch",
        entity: "PosSettlementEntry",
        entityId: f.transactionRef,
        meta: {
          kind: f.kind,
          entryStatus: f.entryStatus,
          mirrorStatus: f.mirrorStatus,
          netAmount: f.netAmount,
          ranAt,
        },
      },
    });
  }

  if (findings.length > 0) {
    const exposure = findings.reduce((sum, f) => sum.add(dec(f.netAmount)), dec(0));
    await sendOpsAlert({
      title: "POS settlement integrity audit found paid/queued entries on non-captured transactions",
      severity: "critical",
      details: {
        entriesChecked,
        findings: findings.length,
        nonCaptured: findings.filter((f) => f.kind === "NON_CAPTURED").length,
        orphans: findings.filter((f) => f.kind === "ORPHAN").length,
        affectedUsers: new Set(findings.map((f) => f.userId)).size,
        netExposure: toFixedString(exposure),
        firstRef: findings[0].transactionRef,
      },
    });
  } else {
    logger.info({ action: "recon.pos_settlement_audit_ok", entriesChecked });
  }

  return report;
}
