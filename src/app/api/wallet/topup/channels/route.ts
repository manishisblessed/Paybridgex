/**
 * GET /api/wallet/topup/channels
 *
 * Returns the list of available top-up channels (Chagans Comet + Star) for
 * the wallet "Add Money" selector.
 *
 * Each channel has:
 *   id        — "<provider>:<gateway>" string sent back in the POST body
 *   provider  — internal provider name ("CHAGANS_PG")
 *   label     — human-friendly name shown in the selector
 *   maxAmount — gateway-specific rupee cap
 *   primary   — true for the default / recommended gateway
 *   available — false when the gateway is known-failing (circuit open)
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { chagansChannelHealth, chagansConfigured, chagansScopeForGateway } from "@/lib/partners/chagans-pg";
import { getEffectiveServiceKeys } from "@/lib/services/guard";
import { pgServiceKeyForScope } from "@/lib/services/catalog";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET() {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    return toErrorResponse(e);
  }

  // Only offer gateways the user is actually granted. Comet is gated by
  // pg_razorpay, Star by pg_chagans_star — each independently assignable.
  const effective = new Set(await getEffectiveServiceKeys(user.id, user.role));

  const channels: Array<{
    id: string;
    provider: string;
    label: string;
    maxAmount?: number;
    primary?: boolean;
    available: boolean;
  }> = [];

  // Chagans channels (Comet + Star)
  if (chagansConfigured()) {
    for (const g of chagansChannelHealth()) {
      const svcKey = pgServiceKeyForScope(chagansScopeForGateway(g.id));
      if (!effective.has(svcKey)) continue; // user not granted this gateway
      channels.push({
        id: `chagans:${g.id}`,
        provider: "CHAGANS_PG",
        label: g.label,
        maxAmount: g.maxAmount,
        primary: g.primary,
        available: g.healthy,
      });
    }
  }

  return NextResponse.json({ channels });
}
