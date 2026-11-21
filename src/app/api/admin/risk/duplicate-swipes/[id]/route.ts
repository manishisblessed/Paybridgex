import { NextRequest, NextResponse } from "next/server";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { isAdminRole } from "@/lib/security/ownership";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { getRiskCaseDetail, releaseAllEntries, closeCase } from "@/lib/risk/duplicateSwipe";
import { z } from "zod";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteParams) {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }
  if (!isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const detail = await getRiskCaseDetail(id);
  if (!detail) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  return NextResponse.json(detail);
}

const PatchBody = z.object({
  action: z.enum(["release_all", "close"]),
  resolution: z.string().min(1, "Resolution is required"),
  note: z.string().min(1, "Note is required"),
});

export async function PATCH(req: NextRequest, ctx: RouteParams) {
  let admin;
  try {
    admin = await requireAdminActivity(req, {
      action: "risk.duplicate_swipe.resolve",
      roles: ["MASTER_ADMIN"],
      entity: "DuplicateSwipeRiskCase",
    });
  } catch (e) {
    return toErrorResponse(e);
  }

  const { id } = await ctx.params;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid or empty request body" }, { status: 400 });
  }

  const parsed = PatchBody.safeParse(rawBody);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { action, resolution, note } = parsed.data;

  try {
    if (action === "release_all") {
      const result = await releaseAllEntries(id, admin.id, resolution, note);
      return NextResponse.json({ ok: true, released: result.released });
    }
    await closeCase(id, admin.id, resolution, note);
    return NextResponse.json({ ok: true, action: "closed" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
