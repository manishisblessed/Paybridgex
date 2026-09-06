import { NextResponse } from "next/server";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { flags } from "@/lib/env";
import { syncPosMachines } from "@/lib/pos/assignments";

export const fetchCache = "force-no-store";

export const dynamic = "force-dynamic";

export const maxDuration = 120;

/**
 * POST /api/admin/pos/machines/sync
 *
 * Pull the external Same Day inventory and upsert it into the local mirror.
 * This is an admin-triggered read-only provider call (no money movement),
 * mirroring the existing synchronous POS read routes; it preserves all
 * local assignment data. Rate-limited and audit-logged.
 */
export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireAdminActivity(req, {
      action: "pos.machines.sync",
      roles: ["MASTER_ADMIN", "ADMIN"],
      entity: "PosMachine",
    });
    await enforceRateLimit(`pos:sync:${admin.id}`, RATE_LIMITS.default);
  } catch (e) {
    return toErrorResponse(e);
  }

  if (!flags.pos)
    return NextResponse.json(
      { error: "POS service is not enabled" },
      { status: 503 }
    );

  let result;
  try {
    result = await syncPosMachines();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "POS sync failed" },
      { status: 502 }
    );
  }

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "pos.machines.sync",
      entity: "PosMachine",
      meta: {
        scanned: result.scanned,
        created: result.created,
        updated: result.updated,
        removed: result.removed,
        retired: result.retired,
        distinct: result.distinct,
        expected: result.expected,
        complete: result.complete,
        passes: result.passes,
        by: admin.email,
      },
      ip: clientIp(req),
    },
  });

  return NextResponse.json(result);
}
