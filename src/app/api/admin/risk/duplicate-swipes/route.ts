import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { isAdminRole } from "@/lib/security/ownership";
import { getRiskCases } from "@/lib/risk/duplicateSwipe";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }
  if (!isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const data = await getRiskCases({
    status: sp.get("status") ?? undefined,
    dateFrom: sp.get("dateFrom") ? new Date(sp.get("dateFrom")!) : undefined,
    dateTo: sp.get("dateTo") ? new Date(sp.get("dateTo")!) : undefined,
    terminalId: sp.get("terminalId") ?? undefined,
    userId: sp.get("userId") ?? undefined,
    cardFingerprint: sp.get("cardFingerprint") ?? undefined,
    transactionRef: sp.get("transactionRef") ?? undefined,
    page: sp.get("page") ? Number(sp.get("page")) : undefined,
    pageSize: sp.get("pageSize") ? Number(sp.get("pageSize")) : undefined,
  });

  return NextResponse.json(data);
}
