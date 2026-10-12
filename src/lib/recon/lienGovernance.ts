/**
 * Lien lifecycle governance.
 *
 * Liens auto-recover from available funds + future credits (see
 * ledger.sweepLiensForUser), but an ACTIVE lien that never recovers — because the
 * retailer stopped funding — is a quiet, ageing receivable. This sweep gives ops
 * visibility so they can act on policy (chase, escalate, or formally write off).
 *
 * It NEVER writes off or releases a lien automatically — recovery and write-off
 * are deliberate operator/policy decisions. It only reports + alerts.
 */
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { sendOpsAlert } from "@/lib/monitoring/alerts";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "recon/lienGovernance" });

// Env-overridable policy thresholds.
const LIEN_AGING_DAYS = Number(process.env.LIEN_AGING_DAYS ?? 14); // ACTIVE longer than this = ageing
const LIEN_LARGE_AMOUNT = Number(process.env.LIEN_LARGE_AMOUNT ?? 25_000); // single large outstanding

export type LienAgingReport = {
  generatedAt: string;
  totalActive: number;
  totalOutstanding: number;
  agingCount: number;
  agingOutstanding: number;
  largeCount: number;
  largeOutstanding: number;
};

export async function runLienAgingReport(): Promise<LienAgingReport> {
  const cutoff = new Date(Date.now() - LIEN_AGING_DAYS * 24 * 3_600_000);

  const liens = await prisma.walletLien.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, amount: true, recoveredAmount: true, createdAt: true, targetUserId: true },
  });

  let totalOutstanding = 0;
  let agingCount = 0;
  let agingOutstanding = 0;
  let largeCount = 0;
  let largeOutstanding = 0;

  for (const l of liens) {
    const outstanding = Math.max(0, toNumber(l.amount) - toNumber(l.recoveredAmount));
    if (outstanding <= 0) continue;
    totalOutstanding += outstanding;
    if (l.createdAt < cutoff) {
      agingCount++;
      agingOutstanding += outstanding;
    }
    if (outstanding >= LIEN_LARGE_AMOUNT) {
      largeCount++;
      largeOutstanding += outstanding;
    }
  }

  const report: LienAgingReport = {
    generatedAt: new Date().toISOString(),
    totalActive: liens.length,
    totalOutstanding,
    agingCount,
    agingOutstanding,
    largeCount,
    largeOutstanding,
  };

  if (agingCount > 0 || largeCount > 0) {
    void sendOpsAlert({
      title: `Lien governance: ${agingCount} ageing · ${largeCount} large lien(s)`,
      severity: "warning",
      details: {
        agingOlderThanDays: LIEN_AGING_DAYS,
        agingCount,
        agingOutstanding,
        largeThreshold: LIEN_LARGE_AMOUNT,
        largeCount,
        largeOutstanding,
        totalActive: report.totalActive,
        totalOutstanding,
        hint: "Review on Wallet Operations → Liens; chase, escalate, or formally write off per policy. No auto-writeoff.",
      },
    }).catch(() => {});
    log.warn({ agingCount, largeCount, totalOutstanding }, "lien governance thresholds breached");
  }

  await prisma.auditLog.create({
    data: { action: "recon.lien_aging", entity: "System", meta: { ...report } },
  });

  return report;
}
