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

    // Enrich transactions with the assigned retailer from local PosMachine table.
    const tids = [...new Set(result.data.data.map((t) => t.terminal_id).filter(Boolean))];
    const machines = tids.length
      ? await prisma.posMachine.findMany({
          where: { tid: { in: tids } },
          select: {
            tid: true,
            assignedUser: {
              select: { id: true, name: true, shopName: true, userCode: true, role: true },
            },
          },
        })
      : [];

    const tidToRetailer = new Map(
      machines
        .filter((m) => m.tid && m.assignedUser)
        .map((m) => [
          m.tid!,
          {
            id: m.assignedUser!.id,
            name: m.assignedUser!.name,
            shopName: (m.assignedUser as { shopName?: string | null }).shopName ?? null,
            userCode: (m.assignedUser as { userCode?: string | null }).userCode ?? null,
            role: m.assignedUser!.role,
          },
        ])
    );

    const enriched = result.data.data.map((txn) => ({
      ...txn,
      retailer: tidToRetailer.get(txn.terminal_id) ?? null,
    }));

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
