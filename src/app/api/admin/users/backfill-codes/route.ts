import { NextResponse } from "next/server";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { backfillUserCodes } from "@/lib/userCode";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await requireAdminActivity(req, {
      action: "user.backfill_codes",
      roles: ["MASTER_ADMIN"],
      entity: "User",
    });
  } catch (e) {
    return toErrorResponse(e);
  }

  const assigned = await backfillUserCodes();
  return NextResponse.json({ ok: true, assigned });
}
