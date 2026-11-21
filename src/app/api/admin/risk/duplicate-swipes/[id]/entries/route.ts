import { NextRequest, NextResponse } from "next/server";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { releaseRiskEntry } from "@/lib/risk/duplicateSwipe";
import { z } from "zod";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const PatchBody = z.object({
  entryId: z.string().min(1),
  action: z.enum(["release"]),
  note: z.string().min(1, "Note is required"),
});

export async function PATCH(req: NextRequest) {
  let admin;
  try {
    admin = await requireAdminActivity(req, {
      action: "risk.duplicate_swipe.release_entry",
      roles: ["MASTER_ADMIN"],
      entity: "DuplicateSwipeRiskEntry",
    });
  } catch (e) {
    return toErrorResponse(e);
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid or empty request body" }, { status: 400 });
  }

  const parsed = PatchBody.safeParse(rawBody);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { entryId, note } = parsed.data;

  try {
    await releaseRiskEntry(entryId, admin.id, note);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
