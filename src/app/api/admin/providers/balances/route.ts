import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth-server";
import {
  samedaySettlementConfigured,
  settlementBalance,
} from "@/lib/partners/sameday-settlement";
import { checkBalance, ekychubConfigured } from "@/lib/partners/ekychub";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const PROBE_TIMEOUT_MS = 8_000;

export type ProviderBalance = {
  key: string;
  name: string;
  provider: string;
  configured: boolean;
  balance: number | null;
  detail?: string | null;
  error?: string | null;
};

/**
 * GET /api/admin/providers/balances — live float balances at every provider
 * with credentials on file (Same Day settlement wallet, eKYC Hub). Feature
 * flags gate traffic, not visibility — ops still need float even when a rail
 * is temporarily disabled. Each probe is best-effort and timed out so one dead
 * partner never blanks the panel.
 */
export async function GET() {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "FINANCE");

    const [sameday, ekychub] = await Promise.all([
      withTimeout(probeSameday(), {
        key: "sameday_settlement",
        name: "Same Day wallet",
        provider: "SAMEDAY",
        configured: samedaySettlementConfigured(),
        balance: null,
        error: "timed out",
      }),
      withTimeout(probeEkychub(), {
        key: "ekychub",
        name: "eKYC Hub credits",
        provider: "EKYCHUB",
        configured: ekychubConfigured(),
        balance: null,
        error: "timed out",
      }),
    ]);

    return NextResponse.json({
      providers: [sameday, ekychub],
      asOf: new Date().toISOString(),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/providers/balances] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function withTimeout(
  probe: Promise<ProviderBalance>,
  onTimeout: ProviderBalance
): Promise<ProviderBalance> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      probe,
      new Promise<ProviderBalance>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout), PROBE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function probeSameday(): Promise<ProviderBalance> {
  const base: ProviderBalance = {
    key: "sameday_settlement",
    name: "Same Day wallet",
    provider: "SAMEDAY",
    configured: samedaySettlementConfigured(),
    balance: null,
  };
  if (!base.configured) return base;
  try {
    const r = await settlementBalance();
    if (!r.ok) return { ...base, error: r.message };
    return {
      ...base,
      balance: r.data.balance,
      detail: r.data.isFrozen ? `FROZEN: ${r.data.freezeReason ?? "unknown"}` : null,
    };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : "probe failed" };
  }
}

async function probeEkychub(): Promise<ProviderBalance> {
  const base: ProviderBalance = {
    key: "ekychub",
    name: "eKYC Hub credits",
    provider: "EKYCHUB",
    configured: ekychubConfigured(),
    balance: null,
  };
  if (!base.configured) return base;
  try {
    const r = await checkBalance();
    if (!r.ok) return { ...base, error: r.message };
    const n = Number(r.data.balance);
    return { ...base, balance: Number.isFinite(n) ? n : null };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : "probe failed" };
  }
}
