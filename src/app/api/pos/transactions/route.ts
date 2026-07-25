import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-server";
import { getPosTransactions } from "@/lib/partners/sameday-pos";
import { enrichPosTransactions } from "@/lib/pos/enrich";
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
      const upstreamStatus = result.status;
      const clientStatus = upstreamStatus === 429 ? 429 : (upstreamStatus === 404 || upstreamStatus >= 500) ? 502 : upstreamStatus;
      return NextResponse.json(
        { error: result.error.error?.message ?? "Failed to fetch POS transactions" },
        { status: clientStatus }
      );
    }

    const enriched = await enrichPosTransactions(result.data.data);

    return NextResponse.json({ ...result.data, data: enriched });
  } catch (e) {
    return toErrorResponse(e);
  }
}
