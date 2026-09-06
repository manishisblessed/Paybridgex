import { NextResponse } from "next/server";

/**
 * DEPRECATED: Legacy mock bill-fetch route.
 * Use POST /api/services/bbps/fetch instead (live BBPS integration).
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      error: "This endpoint is deprecated. Use POST /api/services/bbps/fetch instead.",
      redirect: "/api/services/bbps/fetch",
    },
    { status: 410 }
  );
}
