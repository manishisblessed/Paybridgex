import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth-server";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { dec, add, toNumber } from "@/lib/money";
import {
  fyStartYearOf,
  fyWindow,
  generateCommissionCertificatePdf,
} from "@/lib/statements/commissionCertificate";

/**
 * GET /api/commissions/certificate?fy=2025
 *
 * Financial-year commission certificate (Apr–Mar) for the authenticated
 * user, built from COMMISSION credits in the WalletTxn ledger.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  let user;
  try {
    user = await requireAuth();
    await enforceRateLimit(`commissions:certificate:${user.id}`, RATE_LIMITS.reportQuery);
  } catch (e) {
    return toErrorResponse(e);
  }

  const url = new URL(req.url);
  const fyParam = url.searchParams.get("fy");
  const startYear = fyParam ? Number(fyParam) : fyStartYearOf(new Date());
  if (!Number.isInteger(startYear) || startYear < 2020 || startYear > 2100) {
    return NextResponse.json({ error: "Invalid financial year" }, { status: 400 });
  }
  const { from, to, label } = fyWindow(startYear);

  const [txns, me] = await Promise.all([
    prisma.walletTxn.findMany({
      where: {
        userId: user.id,
        reason: "COMMISSION",
        direction: "CREDIT",
        createdAt: { gte: from, lte: to },
      },
      select: { amount: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findUnique({
      where: { id: user.id },
      select: { name: true, phone: true, role: true },
    }),
  ]);

  // Group by IST month across the FY (always render all 12 rows).
  const monthKeys: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(startYear, 3 + i, 1));
    monthKeys.push(
      d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "Asia/Kolkata" })
    );
  }
  const byMonth = new Map<string, ReturnType<typeof dec>>(monthKeys.map((k) => [k, dec(0)]));
  let total = dec(0);
  for (const t of txns) {
    const key = t.createdAt.toLocaleDateString("en-IN", {
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    });
    byMonth.set(key, add(byMonth.get(key) ?? dec(0), t.amount));
    total = add(total, t.amount);
  }

  const pdf = await generateCommissionCertificatePdf({
    certificateNo: `NGP-CC-${startYear}-${user.id.slice(-6).toUpperCase()}`,
    accountName: me?.name ?? "—",
    accountPhone: me?.phone ?? "—",
    role: me?.role ?? "",
    periodLabel: label,
    from,
    to,
    monthly: monthKeys.map((k) => ({ label: k, amount: toNumber(byMonth.get(k) ?? dec(0)) })),
    total: toNumber(total),
  });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="commission-certificate-${label.replace(/\s/g, "-")}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
