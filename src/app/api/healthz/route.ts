import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { partnerStatus, moneyRailsOnMock } from "@/lib/partners";
import { isProd } from "@/lib/env";

export const fetchCache = "force-no-store";

export const dynamic = "force-dynamic";

export async function GET() {
  let db = "down";
  try {
    await prisma.$queryRaw`select 1`;
    db = "up";
  } catch {
    db = "down";
  }

  // Money rails (upi/payout/aeps/dmt/bbps) must never run on a mock in prod —
  // that is how phantom wallet balance got minted. Surface it here so uptime
  // monitors alert on it, and fail `ok` in production if any are on mock.
  const railsOnMock = moneyRailsOnMock();
  const moneyRailsMisconfigured = isProd && railsOnMock.length > 0;

  return NextResponse.json({
    ok: db === "up" && !moneyRailsMisconfigured,
    db,
    // Presence booleans only (never values) — lets ops verify the runtime
    // actually received critical env vars (Amplify bakes them in at build).
    config: {
      nextauthSecret: Boolean(process.env.NEXTAUTH_SECRET),
      nextauthUrl: Boolean(process.env.NEXTAUTH_URL),
      databaseUrl: Boolean(process.env.DATABASE_URL),
      encryptionKey: Boolean(process.env.APP_ENCRYPTION_KEY),
    },
    partners: partnerStatus(),
    moneyRailsOnMock: railsOnMock,
    time: new Date().toISOString()
  });
}
