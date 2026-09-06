import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-server";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { verifyAuditDay, anchorAuditDay } from "@/lib/audit/anchor";

/**
 * Audit hash-chain anchors (Phase 5).
 *   GET                    — list recent anchors
 *   GET ?verify=YYYY-MM-DD — re-hash that day and compare against its anchor
 *   POST                   — manually anchor yesterday (normally the cron does)
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN");
    await enforceRateLimit(`audit:anchors:${admin.id}`, RATE_LIMITS.reportQuery);
  } catch (e) {
    return toErrorResponse(e);
  }

  const verify = new URL(req.url).searchParams.get("verify");
  if (verify) {
    if (!DATE_RE.test(verify)) {
      return NextResponse.json({ error: "verify must be YYYY-MM-DD" }, { status: 400 });
    }
    const result = await verifyAuditDay(verify);
    return NextResponse.json({ verification: result });
  }

  const anchors = await prisma.auditAnchor.findMany({
    orderBy: { dateKey: "desc" },
    take: 60,
  });

  return NextResponse.json({
    anchors: anchors.map((a) => ({
      dateKey: a.dateKey,
      rowCount: a.rowCount,
      rootHash: a.rootHash,
      chainHash: a.chainHash,
      createdAt: a.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireAdminActivity(req, {
      action: "audit.anchor_run",
      roles: ["MASTER_ADMIN", "ADMIN"],
      entity: "AuditAnchor",
    });
    await enforceRateLimit(`audit:anchor-run:${admin.id}`, RATE_LIMITS.sensitiveWrite);
  } catch (e) {
    return toErrorResponse(e);
  }

  const result = await anchorAuditDay();
  return NextResponse.json(result, { status: result.anchored ? 201 : 200 });
}
