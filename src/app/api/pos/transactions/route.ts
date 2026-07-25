import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-server";
import { getPosTransactions } from "@/lib/partners/sameday-pos";
import { lookupBin, classificationFromBin } from "@/lib/pos/binLookup";
import { prisma } from "@/lib/db";
import { flags } from "@/lib/env";
import { scopePosTerminals } from "@/lib/pos/assignments";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";

export const fetchCache = "force-no-store";

export const dynamic = "force-dynamic";

const schema = z.object({
  date_from: z.string().min(1, "date_from is required"),
  date_to: z.string().min(1, "date_to is required"),
  status: z.enum(["AUTHORIZED", "CAPTURED", "FAILED", "REFUNDED", "VOIDED"]).nullable().optional(),
  terminal_id: z.string().nullable().optional(),
  payment_mode: z.enum(["CARD", "UPI", "NFC", "CASH", "WALLET", "NETBANKING", "BHARATQR"]).nullable().optional(),
  page: z.number().int().positive().optional().default(1),
  page_size: z.number().int().min(1).max(100).optional().default(50),
});

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    // Admin kill-switch + per-user allowlist (default-disabled) for this rail.
    await assertServiceEnabled(SERVICE_KEYS.POS, { name: "POS Terminals", userId: user.id, role: user.role });
    await enforceRateLimit(`pos:txn:${user.id}`, RATE_LIMITS.default);
  } catch (e) {
    return toErrorResponse(e);
  }

  if (!flags.pos) {
    return NextResponse.json(
      { error: "POS service is not enabled" },
      { status: 503 }
    );
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  // Ownership: non-admins may only query terminals assigned to them/their
  // downline. Prevents pulling the tenant-wide partner transaction feed.
  const scope = await scopePosTerminals(user);
  if (!scope.all) {
    if (scope.tids.length === 0)
      return NextResponse.json({ error: "No POS terminals are assigned to your account" }, { status: 403 });
    if (parsed.data.terminal_id) {
      if (!scope.tids.includes(parsed.data.terminal_id))
        return NextResponse.json({ error: "You do not have access to that terminal" }, { status: 403 });
    } else if (scope.tids.length === 1) {
      parsed.data.terminal_id = scope.tids[0];
    } else {
      return NextResponse.json(
        { error: "Select one of your terminals to view its transactions", terminals: scope.tids },
        { status: 400 }
      );
    }

    // Clamp date_from so users only see transactions from after the terminal
    // was assigned to them (or their downline). Prevents viewing the previous
    // holder's transactions.
    const match = scope.terminals.find((t) => t.tid === parsed.data.terminal_id);
    if (match?.assignedAt) {
      const assignedIso = match.assignedAt.toISOString();
      if (parsed.data.date_from < assignedIso) {
        parsed.data.date_from = assignedIso;
      }
    }
  }

  try {
    const result = await getPosTransactions(parsed.data);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error.error?.message ?? "Failed to fetch POS transactions" },
        { status: result.status >= 400 ? result.status : 502 }
      );
    }

    // Enrich each transaction with the retailer who ACTUALLY HELD the terminal
    // at the moment of the swipe, resolved from the assignment history
    // (`PosAssignmentLog`). Each `assign` entry defines a holding window
    // [assignedDate, returnedDate) — non-overlapping, since reassigning closes
    // the previous window. So a swipe is attributed to whoever owned the machine
    // then: never a later holder, and never anyone for pre-assignment swipes.
    const tids = [...new Set(result.data.data.map((t) => t.terminal_id).filter(Boolean))];
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

    // tid -> chronological holding periods { userId, start, end (null = open) }.
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
      // Fallback for assignments not captured in the log (e.g. legacy rows):
      // synthesize an open period from the machine's current assignment so
      // post-assignment swipes are still attributed to the current holder.
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

    // Resolve the holder of `tid` at instant `at`. Iterates newest-first so an
    // exact reassignment-boundary timestamp resolves to the newer holder.
    const resolveHolderId = (tid: string, at: Date): string | null => {
      const periods = periodsByTid.get(tid);
      if (!periods) return null;
      for (let i = periods.length - 1; i >= 0; i--) {
        const p = periods[i];
        if (at >= p.start && (p.end === null || at <= p.end)) return p.userId;
      }
      return null;
    };

    const enriched = result.data.data.map((txn) => {
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

    // Classification fallback: some acquirers (e.g. Teachway terminals) return a
    // card number but no `card_classification`, while others (e.g. Avika) return
    // the classification directly. For the rows still missing it, derive it from
    // the card BIN so every card transaction shows a classification. Lookups are
    // batched by unique 6-digit BIN and cache-first (CardBinCache), so repeats
    // are cheap DB hits and only true misses reach the BIN provider.
    const binOf = (cardNumber: string | null | undefined) =>
      (cardNumber ?? "").replace(/\D/g, "").slice(0, 6);

    const missingBins = new Set<string>();
    for (const txn of enriched) {
      if (!txn.card_classification && txn.payment_mode === "CARD") {
        const bin = binOf(txn.card_number);
        if (bin.length === 6) missingBins.add(bin);
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

    return NextResponse.json({ ...result.data, data: enriched });
  } catch (e) {
    return toErrorResponse(e);
  }
}
