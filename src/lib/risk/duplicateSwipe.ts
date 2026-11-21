import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { istBusinessDate } from "@/lib/pos/cardFingerprint";
import { placeWalletLien, releaseWalletLien } from "@/lib/wallet/lien";
import { dec, toNumber, add } from "@/lib/money";
import { sendOpsAlert } from "@/lib/monitoring/alerts";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "risk/duplicateSwipe" });

// ─── Types ──────────────────────────────────────────────────────────────────

export type DetectInput = {
  transactionRef: string;
  terminalId: string;
  cardFingerprint: string;
  txnTime: string; // ISO string
  grossAmount: number;
  maskedPan?: string | null;
  cardBrand?: string | null;
  cardType?: string | null;
  issuingBank?: string | null;
};

export type DetectResult = {
  detected: boolean;
  caseId?: string;
  entriesHeld?: number;
  entriesLiened?: number;
};

export type DuplicateSwipeStats = {
  openCases: number;
  totalHeldAmount: number;
  totalLienAmount: number;
  pendingLienAmount: number;
  casesToday: number;
  transactionCount: number;
};

export type RiskCaseFilters = {
  status?: string;
  dateFrom?: Date;
  dateTo?: Date;
  terminalId?: string;
  userId?: string;
  cardFingerprint?: string;
  transactionRef?: string;
  page?: number;
  pageSize?: number;
};

// ─── Detection Engine ───────────────────────────────────────────────────────

export async function detectDuplicateSwipe(input: DetectInput): Promise<DetectResult> {
  const cfg = await getSetting("risk.duplicate_swipe");
  if (!cfg.enabled) return { detected: false };

  const txnTime = new Date(input.txnTime);
  if (Number.isNaN(txnTime.getTime())) return { detected: false };

  const businessDate = istBusinessDate(txnTime);

  const captured = await prisma.posTransactionMirror.findMany({
    where: {
      cardFingerprint: input.cardFingerprint,
      terminalId: input.terminalId,
      status: "CAPTURED",
      txnTime: {
        gte: businessDate,
        lt: new Date(businessDate.getTime() + 24 * 60 * 60 * 1000),
      },
    },
    orderBy: { txnTime: "asc" },
    select: {
      transactionRef: true,
      amount: true,
      txnTime: true,
      rrn: true,
      authCode: true,
      cardNumber: true,
      cardBrand: true,
      cardType: true,
      issuingBank: true,
      mid: true,
    },
  });

  if (captured.length < 2) return { detected: false };

  return prisma.$transaction(async (tx) => {
    let riskCase = await tx.duplicateSwipeRiskCase.findUnique({
      where: {
        cardFingerprint_terminalId_businessDate: {
          cardFingerprint: input.cardFingerprint,
          terminalId: input.terminalId,
          businessDate,
        },
      },
      include: { entries: true },
    });

    const isNewCase = !riskCase;

    if (!riskCase) {
      const firstTxn = captured[0];
      const holderMachine = await tx.posMachine.findFirst({
        where: { tid: input.terminalId },
        select: { assignedUserId: true, mid: true },
      });

      riskCase = await tx.duplicateSwipeRiskCase.create({
        data: {
          cardFingerprint: input.cardFingerprint,
          terminalId: input.terminalId,
          businessDate,
          maskedPan: input.maskedPan ?? firstTxn.cardNumber,
          cardBrand: input.cardBrand ?? firstTxn.cardBrand,
          cardType: input.cardType ?? firstTxn.cardType,
          issuingBank: input.issuingBank ?? firstTxn.issuingBank,
          userId: holderMachine?.assignedUserId ?? null,
          mid: holderMachine?.mid ?? firstTxn.mid,
          status: "OPEN",
        },
        include: { entries: true },
      });
    }

    const existingRefs = new Set(riskCase.entries.map((e) => e.transactionRef));
    let entriesHeld = 0;
    let entriesLiened = 0;
    let totalGross = riskCase.entries.reduce(
      (s, e) => add(s, e.grossAmount),
      dec(0)
    );
    let totalHeld = dec(riskCase.totalHeldAmount);
    let totalLien = dec(riskCase.totalLienAmount);
    let totalNetSettled = dec(riskCase.totalNetSettled);
    let pendingLien = dec(riskCase.pendingLienAmount);

    for (const txn of captured) {
      if (existingRefs.has(txn.transactionRef)) continue;

      const gross = toNumber(txn.amount);
      totalGross = add(totalGross, gross);

      const settlementEntry = await tx.posSettlementEntry.findUnique({
        where: { transactionRef: txn.transactionRef },
        select: { id: true, status: true, netAmount: true, userId: true, walletTxnId: true },
      });

      let action = "HELD";
      let lienId: string | null = null;
      let settlementEntryId: string | null = null;
      let netAmount: Prisma.Decimal | null = null;

      if (settlementEntry) {
        settlementEntryId = settlementEntry.id;

        if (settlementEntry.status === "SETTLED" && settlementEntry.walletTxnId) {
          netAmount = settlementEntry.netAmount as Prisma.Decimal;
          const lienAmount = toNumber(netAmount);
          totalNetSettled = add(totalNetSettled, lienAmount);

          try {
            const lien = await placeWalletLien({
              actorId: riskCase.userId ?? "SYSTEM",
              targetUserId: settlementEntry.userId,
              amount: lienAmount,
              reasonCode: "DUPLICATE_SWIPE",
              remarks: `Potential duplicate card swipe on terminal ${input.terminalId}. Case #${riskCase.id}`,
              refType: "DuplicateSwipeRiskCase",
              refId: riskCase.id,
            });
            lienId = lien.id;
            action = "LIENED";
            totalLien = add(totalLien, lienAmount);
            entriesLiened++;

            await tx.duplicateSwipeAuditEvent.create({
              data: {
                riskCaseId: riskCase.id,
                event: "entry_liened",
                newStatus: "LIENED",
                amount: dec(lienAmount),
                reason: `Settlement already completed. Lien placed for ₹${lienAmount.toFixed(2)}`,
                settlementRef: settlementEntry.id,
              },
            });
          } catch (e) {
            action = "PENDING_LIEN";
            pendingLien = add(pendingLien, toNumber(netAmount));
            log.warn({ err: e, txnRef: txn.transactionRef, caseId: riskCase.id }, "lien placement failed");

            await tx.duplicateSwipeAuditEvent.create({
              data: {
                riskCaseId: riskCase.id,
                event: "lien_failed",
                amount: netAmount,
                reason: `Lien placement failed: ${(e as Error).message}`,
                settlementRef: settlementEntry.id,
              },
            });
          }
        } else if (settlementEntry.status === "PENDING") {
          await tx.posSettlementEntry.update({
            where: { id: settlementEntry.id },
            data: { riskHoldId: riskCase.id },
          });
          action = "HELD";
          totalHeld = add(totalHeld, gross);
          entriesHeld++;

          await tx.duplicateSwipeAuditEvent.create({
            data: {
              riskCaseId: riskCase.id,
              event: "entry_held",
              newStatus: "HELD",
              amount: dec(gross),
              reason: "Settlement entry placed on risk hold",
              settlementRef: settlementEntry.id,
            },
          });
        } else if (settlementEntry.status === "REVERSED") {
          action = "REVERSED";
        }
      } else {
        action = "HELD";
        totalHeld = add(totalHeld, gross);
        entriesHeld++;
      }

      await tx.duplicateSwipeRiskEntry.create({
        data: {
          riskCaseId: riskCase.id,
          transactionRef: txn.transactionRef,
          grossAmount: txn.amount,
          netAmount: netAmount ?? undefined,
          txnTime: txn.txnTime,
          rrn: txn.rrn,
          authCode: txn.authCode,
          action,
          settlementEntryId,
          lienId,
        },
      });
    }

    const totalCount = existingRefs.size + captured.filter((t) => !existingRefs.has(t.transactionRef)).length;

    await tx.duplicateSwipeRiskCase.update({
      where: { id: riskCase.id },
      data: {
        totalGrossAmount: totalGross,
        totalNetSettled,
        totalHeldAmount: totalHeld,
        totalLienAmount: totalLien,
        pendingLienAmount: pendingLien,
        transactionCount: totalCount,
      },
    });

    if (isNewCase) {
      await tx.duplicateSwipeAuditEvent.create({
        data: {
          riskCaseId: riskCase.id,
          event: "detected",
          newStatus: "OPEN",
          amount: totalGross,
          reason: `Duplicate swipe detected: ${totalCount} transactions on terminal ${input.terminalId}`,
          meta: {
            transactionCount: totalCount,
            entriesHeld,
            entriesLiened,
            cardFingerprint: input.cardFingerprint,
          },
        },
      });
    }

    return {
      detected: true,
      caseId: riskCase.id,
      entriesHeld,
      entriesLiened,
    };
  }).then(async (result) => {
    if (result.detected && result.caseId) {
      try {
        await sendOpsAlert({
          title: "Duplicate card swipe detected",
          severity: "warning",
          details: {
            caseId: result.caseId,
            terminal: input.terminalId,
            card: input.maskedPan ?? "masked",
            swipes: captured.length,
            held: result.entriesHeld ?? 0,
            liened: result.entriesLiened ?? 0,
          },
        });
      } catch {
        // alerting is best-effort
      }
    }
    return result;
  });
}

// ─── Settlement Guard ───────────────────────────────────────────────────────

/**
 * Check if an OPEN risk case exists for this card/terminal/date and stamp
 * riskHoldId on the settlement entry if so. Called from handlePosCapture()
 * as a synchronous pre-check for the common case where the risk case was
 * created by an earlier swipe's webhook.
 */
export async function applyRiskHoldIfNeeded(
  transactionRef: string,
  terminalId: string,
  capturedAt: Date
): Promise<string | null> {
  const cfg = await getSetting("risk.duplicate_swipe");
  if (!cfg.enabled) return null;

  const mirror = await prisma.posTransactionMirror.findUnique({
    where: { transactionRef },
    select: { cardFingerprint: true },
  });
  if (!mirror?.cardFingerprint) return null;

  const businessDate = istBusinessDate(capturedAt);

  const riskCase = await prisma.duplicateSwipeRiskCase.findUnique({
    where: {
      cardFingerprint_terminalId_businessDate: {
        cardFingerprint: mirror.cardFingerprint,
        terminalId,
        businessDate,
      },
    },
    select: { id: true, status: true },
  });

  if (!riskCase || riskCase.status !== "OPEN") return null;

  await prisma.posSettlementEntry.updateMany({
    where: { transactionRef, status: "PENDING", riskHoldId: null },
    data: { riskHoldId: riskCase.id },
  });

  return riskCase.id;
}

// ─── Case Management ────────────────────────────────────────────────────────

export async function getRiskCases(filters: RiskCaseFilters) {
  const page = filters.page ?? 1;
  const pageSize = Math.min(filters.pageSize ?? 25, 100);

  const where: Prisma.DuplicateSwipeRiskCaseWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.terminalId) where.terminalId = filters.terminalId;
  if (filters.userId) where.userId = filters.userId;
  if (filters.cardFingerprint) where.cardFingerprint = filters.cardFingerprint;
  if (filters.dateFrom || filters.dateTo) {
    where.businessDate = {};
    if (filters.dateFrom) where.businessDate.gte = filters.dateFrom;
    if (filters.dateTo) where.businessDate.lte = filters.dateTo;
  }
  if (filters.transactionRef) {
    where.entries = { some: { transactionRef: filters.transactionRef } };
  }

  const [cases, total] = await Promise.all([
    prisma.duplicateSwipeRiskCase.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { id: true, name: true, shopName: true, phone: true } },
      },
    }),
    prisma.duplicateSwipeRiskCase.count({ where }),
  ]);

  return {
    cases: cases.map(serializeCase),
    total,
    page,
    pageSize,
  };
}

export async function getRiskCaseDetail(caseId: string) {
  const riskCase = await prisma.duplicateSwipeRiskCase.findUnique({
    where: { id: caseId },
    include: {
      user: { select: { id: true, name: true, shopName: true, phone: true, email: true } },
      entries: { orderBy: { txnTime: "asc" } },
      auditEvents: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!riskCase) return null;

  return {
    ...serializeCase(riskCase),
    entries: riskCase.entries.map((e) => ({
      id: e.id,
      transactionRef: e.transactionRef,
      grossAmount: toNumber(e.grossAmount),
      netAmount: e.netAmount ? toNumber(e.netAmount) : null,
      txnTime: e.txnTime.toISOString(),
      rrn: e.rrn,
      authCode: e.authCode,
      action: e.action,
      settlementEntryId: e.settlementEntryId,
      lienId: e.lienId,
      releaseNote: e.releaseNote,
      releasedById: e.releasedById,
      releasedAt: e.releasedAt?.toISOString() ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
    auditEvents: riskCase.auditEvents.map((e) => ({
      id: e.id,
      event: e.event,
      previousStatus: e.previousStatus,
      newStatus: e.newStatus,
      amount: e.amount ? toNumber(e.amount) : null,
      actorId: e.actorId,
      reason: e.reason,
      providerRef: e.providerRef,
      settlementRef: e.settlementRef,
      meta: e.meta,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

function serializeCase(c: {
  id: string;
  cardFingerprint: string;
  terminalId: string;
  businessDate: Date;
  maskedPan: string | null;
  cardBrand: string | null;
  cardType: string | null;
  issuingBank: string | null;
  userId: string | null;
  mid: string | null;
  totalGrossAmount: Prisma.Decimal;
  totalNetSettled: Prisma.Decimal;
  totalHeldAmount: Prisma.Decimal;
  totalLienAmount: Prisma.Decimal;
  pendingLienAmount: Prisma.Decimal;
  transactionCount: number;
  status: string;
  resolvedById: string | null;
  resolvedAt: Date | null;
  resolution: string | null;
  resolutionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  user?: { id: string; name: string; shopName: string | null; phone: string } | null;
}) {
  return {
    id: c.id,
    cardFingerprint: c.cardFingerprint,
    terminalId: c.terminalId,
    businessDate: c.businessDate.toISOString().split("T")[0],
    maskedPan: c.maskedPan,
    cardBrand: c.cardBrand,
    cardType: c.cardType,
    issuingBank: c.issuingBank,
    userId: c.userId,
    mid: c.mid,
    totalGrossAmount: toNumber(c.totalGrossAmount),
    totalNetSettled: toNumber(c.totalNetSettled),
    totalHeldAmount: toNumber(c.totalHeldAmount),
    totalLienAmount: toNumber(c.totalLienAmount),
    pendingLienAmount: toNumber(c.pendingLienAmount),
    transactionCount: c.transactionCount,
    status: c.status,
    resolvedById: c.resolvedById,
    resolvedAt: c.resolvedAt?.toISOString() ?? null,
    resolution: c.resolution,
    resolutionNote: c.resolutionNote,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    retailer: c.user ? { id: c.user.id, name: c.user.name, shopName: c.user.shopName, phone: c.user.phone } : null,
  };
}

// ─── Release Workflow ───────────────────────────────────────────────────────

export async function releaseRiskEntry(
  entryId: string,
  actorId: string,
  note: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const entry = await tx.duplicateSwipeRiskEntry.findUnique({
      where: { id: entryId },
      include: { riskCase: true },
    });
    if (!entry) throw new Error("Entry not found");
    if (entry.riskCase.status !== "OPEN") throw new Error("Case is not OPEN");
    if (entry.action === "RELEASED") throw new Error("Entry already released");
    if (entry.action === "REVERSED") throw new Error("Entry was reversed upstream");

    const prevAction = entry.action;

    if (entry.action === "HELD" && entry.settlementEntryId) {
      await tx.posSettlementEntry.updateMany({
        where: { id: entry.settlementEntryId, riskHoldId: entry.riskCaseId },
        data: { riskHoldId: null },
      });
    } else if (entry.action === "HELD" && !entry.settlementEntryId) {
      // No settlement entry yet — just mark as released; when handlePosCapture
      // runs it will proceed normally since no OPEN case entry blocks it.
    }

    if (entry.action === "LIENED" && entry.lienId) {
      await releaseWalletLien(entry.lienId, actorId, note);
    }

    if (entry.action === "PENDING_LIEN") {
      // No lien was placed — just clear the flag.
    }

    await tx.duplicateSwipeRiskEntry.update({
      where: { id: entryId },
      data: {
        action: "RELEASED",
        releaseNote: note,
        releasedById: actorId,
        releasedAt: new Date(),
      },
    });

    // Recalculate case aggregates
    await recalculateCaseAggregates(tx, entry.riskCaseId);

    await tx.duplicateSwipeAuditEvent.create({
      data: {
        riskCaseId: entry.riskCaseId,
        entryId: entry.id,
        event: prevAction === "LIENED" ? "lien_released" : "entry_released",
        previousStatus: prevAction,
        newStatus: "RELEASED",
        amount: entry.grossAmount,
        actorId,
        reason: note,
        settlementRef: entry.settlementEntryId,
      },
    });

    // Send notification to retailer
    if (entry.riskCase.userId) {
      await tx.notification.create({
        data: {
          userId: entry.riskCase.userId,
          title: "A duplicate-swipe hold was released",
          body: `A hold on transaction ${entry.transactionRef} (₹${toNumber(entry.grossAmount).toFixed(2)}) has been released by admin review.`,
          channel: "INAPP",
          href: "/dashboard/wallet",
        },
      });
    }
  });
}

export async function releaseAllEntries(
  caseId: string,
  actorId: string,
  resolution: string,
  note: string
): Promise<{ released: number }> {
  return prisma.$transaction(async (tx) => {
    const riskCase = await tx.duplicateSwipeRiskCase.findUnique({
      where: { id: caseId },
      include: { entries: true },
    });
    if (!riskCase) throw new Error("Case not found");
    if (riskCase.status !== "OPEN") throw new Error("Case is not OPEN");

    let released = 0;

    for (const entry of riskCase.entries) {
      if (entry.action === "RELEASED" || entry.action === "REVERSED") continue;

      if (entry.action === "HELD" && entry.settlementEntryId) {
        await tx.posSettlementEntry.updateMany({
          where: { id: entry.settlementEntryId, riskHoldId: caseId },
          data: { riskHoldId: null },
        });
      }

      if (entry.action === "LIENED" && entry.lienId) {
        await releaseWalletLien(entry.lienId, actorId, note);
      }

      await tx.duplicateSwipeRiskEntry.update({
        where: { id: entry.id },
        data: {
          action: "RELEASED",
          releaseNote: note,
          releasedById: actorId,
          releasedAt: new Date(),
        },
      });

      released++;
    }

    await tx.duplicateSwipeRiskCase.update({
      where: { id: caseId },
      data: {
        status: "RELEASED",
        resolvedById: actorId,
        resolvedAt: new Date(),
        resolution,
        resolutionNote: note,
        totalHeldAmount: 0,
        totalLienAmount: 0,
        pendingLienAmount: 0,
      },
    });

    await tx.duplicateSwipeAuditEvent.create({
      data: {
        riskCaseId: caseId,
        event: "case_released",
        previousStatus: "OPEN",
        newStatus: "RELEASED",
        actorId,
        reason: note,
        meta: { resolution, entriesReleased: released },
      },
    });

    if (riskCase.userId) {
      await tx.notification.create({
        data: {
          userId: riskCase.userId,
          title: "Duplicate-swipe case resolved",
          body: `All holds and liens from a duplicate card swipe investigation on terminal ${riskCase.terminalId} have been released.`,
          channel: "INAPP",
          href: "/dashboard/wallet",
        },
      });
    }

    return { released };
  });
}

export async function closeCase(
  caseId: string,
  actorId: string,
  resolution: string,
  note: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const riskCase = await tx.duplicateSwipeRiskCase.findUnique({
      where: { id: caseId },
    });
    if (!riskCase) throw new Error("Case not found");
    if (riskCase.status !== "OPEN") throw new Error("Case is not OPEN");

    await tx.duplicateSwipeRiskCase.update({
      where: { id: caseId },
      data: {
        status: "CLOSED",
        resolvedById: actorId,
        resolvedAt: new Date(),
        resolution,
        resolutionNote: note,
      },
    });

    await tx.duplicateSwipeAuditEvent.create({
      data: {
        riskCaseId: caseId,
        event: "case_closed",
        previousStatus: "OPEN",
        newStatus: "CLOSED",
        actorId,
        reason: note,
        meta: { resolution },
      },
    });
  });
}

// ─── Stats ──────────────────────────────────────────────────────────────────

export async function getDuplicateSwipeStats(): Promise<DuplicateSwipeStats> {
  const todayStart = istBusinessDate(new Date());

  const [openAgg, todayCount] = await Promise.all([
    prisma.duplicateSwipeRiskCase.aggregate({
      where: { status: "OPEN" },
      _count: true,
      _sum: {
        totalHeldAmount: true,
        totalLienAmount: true,
        pendingLienAmount: true,
        transactionCount: true,
      },
    }),
    prisma.duplicateSwipeRiskCase.count({
      where: { createdAt: { gte: todayStart } },
    }),
  ]);

  return {
    openCases: openAgg._count,
    totalHeldAmount: toNumber(openAgg._sum.totalHeldAmount ?? 0),
    totalLienAmount: toNumber(openAgg._sum.totalLienAmount ?? 0),
    pendingLienAmount: toNumber(openAgg._sum.pendingLienAmount ?? 0),
    casesToday: todayCount,
    transactionCount: openAgg._sum.transactionCount ?? 0,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function recalculateCaseAggregates(
  tx: Prisma.TransactionClient,
  caseId: string
): Promise<void> {
  const entries = await tx.duplicateSwipeRiskEntry.findMany({
    where: { riskCaseId: caseId },
  });

  let totalGross = dec(0);
  let totalHeld = dec(0);
  let totalLien = dec(0);
  let totalNetSettled = dec(0);
  let pending = dec(0);

  for (const e of entries) {
    totalGross = add(totalGross, e.grossAmount);
    if (e.action === "HELD") totalHeld = add(totalHeld, e.grossAmount);
    if (e.action === "LIENED" && e.netAmount) totalLien = add(totalLien, e.netAmount);
    if (e.action === "PENDING_LIEN" && e.netAmount) pending = add(pending, e.netAmount);
    if (e.netAmount && (e.action === "LIENED" || e.action === "RELEASED")) {
      totalNetSettled = add(totalNetSettled, e.netAmount);
    }
  }

  await tx.duplicateSwipeRiskCase.update({
    where: { id: caseId },
    data: {
      totalGrossAmount: totalGross,
      totalHeldAmount: totalHeld,
      totalLienAmount: totalLien,
      totalNetSettled,
      pendingLienAmount: pending,
      transactionCount: entries.length,
    },
  });
}
