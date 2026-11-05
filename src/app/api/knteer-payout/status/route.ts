/**
 * GET /api/knteer-payout/status
 *
 * Status of Bank Transfer (Knteer) transfers. Since every transfer now rides
 * the shared PayoutRequest lifecycle (rail="KNTEER"), this reads from
 * PayoutRequest — NOT a separate table — so the status, UTR, and failure reason
 * are always the authoritative lifecycle values.
 *
 * Query params:
 *   id      — reconcile + return a single transfer (by PayoutRequest id)
 *   list    — "1" (default) to list the caller's recent Bank Transfers
 *
 * Account numbers are NEVER returned — only the masked last-4.
 */
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { flags } from "@/lib/env";
import { toNumber } from "@/lib/money";
import { reconcilePayout } from "@/lib/payout/service";
import { scopeUserIdFilter } from "@/lib/security/ownership";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set([
  "RETAILER",
  "DISTRIBUTOR",
  "MASTER_DISTRIBUTOR",
  "SUPER_DISTRIBUTOR",
  "ADMIN",
  "MASTER_ADMIN",
  "FINANCE",
  "SUPPORT",
]);

const ADMIN_VIEW_ROLES = new Set(["MASTER_ADMIN", "ADMIN", "FINANCE", "SUPPORT"]);

function mapRow(r: {
  id: string;
  beneficiaryName: string;
  accountLast4: string;
  mode: string;
  amount: Prisma.Decimal;
  serviceCharge: Prisma.Decimal;
  gst: Prisma.Decimal;
  totalDebit: Prisma.Decimal;
  vendorCharge: Prisma.Decimal;
  status: string;
  utr: string | null;
  failureReason: string | null;
  providerReferenceId: string | null;
  providerTxnId: string | null;
  createdAt: Date;
  completedAt: Date | null;
  knteerBeneficiary?: { bankName: string; ifscCode: string } | null;
}, isAdminView: boolean) {
  return {
    id: r.id,
    beneficiaryName: r.beneficiaryName,
    accountLast4: r.accountLast4,
    bankName: r.knteerBeneficiary?.bankName ?? null,
    ifscCode: r.knteerBeneficiary?.ifscCode ?? null,
    mode: r.mode,
    amount: toNumber(r.amount),
    serviceCharge: toNumber(r.serviceCharge),
    gst: toNumber(r.gst),
    totalDebit: toNumber(r.totalDebit),
    ...(isAdminView
      ? {
          vendorCharge: toNumber(r.vendorCharge),
          revenue: Math.max(toNumber(r.serviceCharge) - toNumber(r.vendorCharge), 0),
        }
      : {}),
    status: r.status,
    utr: r.utr,
    failureReason: r.failureReason,
    referenceId: r.providerReferenceId,
    transactionId: r.providerTxnId,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  };
}

const SELECT = {
  id: true,
  beneficiaryName: true,
  accountLast4: true,
  mode: true,
  amount: true,
  serviceCharge: true,
  gst: true,
  totalDebit: true,
  vendorCharge: true,
  status: true,
  utr: true,
  failureReason: true,
  providerReferenceId: true,
  providerTxnId: true,
  createdAt: true,
  completedAt: true,
  knteerBeneficiary: { select: { bankName: true, ifscCode: true } },
} as const;

export async function GET(req: Request) {
  let user;
  try {
    user = await requireAuth();
    if (!ALLOWED_ROLES.has(user.role))
      throw new AuthError("Bank Transfer is available for network users only", 403);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  if (!flags.knteerPayout) {
    return NextResponse.json({ error: "Bank Transfer is not enabled" }, { status: 503 });
  }

  const isAdminView = ADMIN_VIEW_ROLES.has(user.role);
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? undefined;

  // Ownership scope — network users see only their own rows; admins see all.
  const ownScope = await scopeUserIdFilter(user);

  // ---- Single transfer (reconcile live, then return) ----
  if (id) {
    const owned = await prisma.payoutRequest.findFirst({
      where: { id, rail: "KNTEER", ...ownScope },
      select: { id: true },
    });
    if (!owned) return NextResponse.json({ error: "Transfer not found" }, { status: 404 });

    // Pull the latest partner status for still-open rows (no-op if settled).
    await reconcilePayout(id).catch(() => null);

    const row = await prisma.payoutRequest.findUnique({ where: { id }, select: SELECT });
    if (!row) return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
    return NextResponse.json({ transfer: mapRow(row, isAdminView) });
  }

  // ---- List caller's recent Bank Transfers ----
  const rows = await prisma.payoutRequest.findMany({
    where: { rail: "KNTEER", ...ownScope },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: SELECT,
  });
  return NextResponse.json({ transfers: rows.map((r) => mapRow(r, isAdminView)) });
}
