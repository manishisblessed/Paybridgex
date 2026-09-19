import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth-server";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { runLedgerIntegrityAudit } from "@/lib/recon/integrity";
import { runDailyPayoutReconciliation } from "@/lib/recon/payouts";
import { enqueue, QUEUES } from "@/lib/queue";

/**
 * Admin reconciliation console.
 *
 * GET  — recent reconciliation runs + open mismatch findings (from AuditLog).
 * POST — trigger a run now: { job: "ledger" | "payout" }. Runs inline (both
 *        are read-only / idempotent) so the admin sees the result immediately.
 */

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN");

    const [runs, mismatches] = await Promise.all([
      prisma.auditLog.findMany({
        where: { action: { in: ["recon.ledger_audit", "recon.payout_recon"] } },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { id: true, action: true, meta: true, createdAt: true },
      }),
      prisma.auditLog.findMany({
        where: { action: { in: ["recon.ledger_mismatch", "recon.payout_mismatch"] } },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          action: true,
          entityId: true,
          meta: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    return NextResponse.json({
      runs: runs.map((r) => ({
        id: r.id,
        job: r.action === "recon.ledger_audit" ? "ledger" : "payout",
        meta: r.meta,
        at: r.createdAt.toISOString(),
      })),
      mismatches: mismatches.map((m) => ({
        id: m.id,
        kind: m.action === "recon.ledger_mismatch" ? "ledger" : "payout",
        entityId: m.entityId,
        user: m.user,
        meta: m.meta,
        at: m.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}

const PostBody = z
  .object({ job: z.enum(["ledger", "payout", "bbps", "rechargekit"]) })
  .strict();

export async function POST(req: Request) {
  try {
    const user = await requireAdminActivity(req, {
      action: "recon.triggered",
      roles: ["MASTER_ADMIN", "ADMIN"],
      entity: "System",
    });
    await enforceRateLimit(`recon:trigger:${user.id}`, RATE_LIMITS.sensitiveWrite);

    const parsed = PostBody.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "recon.triggered",
        entity: "System",
        meta: { job: parsed.data.job },
      },
    });

    if (parsed.data.job === "ledger") {
      const report = await runLedgerIntegrityAudit();
      return NextResponse.json({ job: "ledger", report });
    }

    // BBPS bill payments and RechargeKit CC-2 payments can sit in PROCESSING
    // awaiting an out-of-band terminal state. Their sweeps poll the provider for
    // up to 200 rows serially, so we ENQUEUE them onto the worker (the same */5
    // scheduled queue) instead of running inline — a large backlog would
    // otherwise risk an HTTP/serverless timeout. The singletonKey dedupes rapid
    // double-clicks so at most one manual run is pending at a time. For a single
    // stuck payment, use POST /api/admin/transactions/reconcile (runs inline,
    // one provider call).
    if (parsed.data.job === "bbps" || parsed.data.job === "rechargekit") {
      const queue =
        parsed.data.job === "bbps" ? QUEUES.BBPS_RECONCILE : QUEUES.RECHARGEKIT_RECONCILE;
      const jobId = await enqueue(queue, {}, { singletonKey: `${parsed.data.job}-reconcile:manual` });
      return NextResponse.json({
        job: parsed.data.job,
        queued: jobId !== null,
        jobId,
        note:
          jobId === null
            ? "A reconciliation run is already queued — it will process shortly."
            : "Reconciliation queued; the worker will drain PROCESSING rows within moments.",
      });
    }

    const summary = await runDailyPayoutReconciliation();
    return NextResponse.json({ job: "payout", summary });
  } catch (e) {
    return toErrorResponse(e);
  }
}
