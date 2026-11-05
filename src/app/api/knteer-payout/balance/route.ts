/**
 * GET /api/knteer-payout/balance
 *
 * Returns the CALLER's own Paybridgex wallet balances — this is the money that
 * actually funds a Bank Transfer (amount + slab charge + GST are debited from
 * the retailer's spendable wallet). The company's partner-wallet balance (used
 * for the actual disbursal) is internal finance data and is ONLY included for
 * admin-type roles, never surfaced to the network user.
 */
import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { flags } from "@/lib/env";
import { getBalances } from "@/lib/ledger";
import { toNumber } from "@/lib/money";
import { getKnteerBalance } from "@/lib/knteer-payout/service";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const ADMIN_VIEW_ROLES = new Set(["MASTER_ADMIN", "ADMIN", "FINANCE", "SUPPORT"]);

export async function GET(_req: Request) {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  if (!flags.knteerPayout) {
    return NextResponse.json({ error: "Bank Transfer is not enabled" }, { status: 503 });
  }

  const balances = await getBalances(user.id);
  const wallet = {
    walletBalance: toNumber(balances.walletBalance),
    heldBalance: toNumber(balances.heldBalance),
    spendable: toNumber(balances.spendable),
  };

  // Admins additionally see the company partner-wallet balance (best-effort).
  if (ADMIN_VIEW_ROLES.has(user.role)) {
    const partner = await getKnteerBalance().catch(() => null);
    return NextResponse.json({
      wallet,
      partner: partner && partner.ok ? partner.data : null,
    });
  }

  return NextResponse.json({ wallet });
}
