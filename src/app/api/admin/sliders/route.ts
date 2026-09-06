import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, AuthError } from "@/lib/auth-server";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { isAdminRole } from "@/lib/security/ownership";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { prisma } from "@/lib/db";
import {
  SLIDER_ROLES,
  SliderKindEnum,
  SliderRoleEnum,
  serializeSlider,
} from "@/lib/sliders";

export const fetchCache = "force-no-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT");

    const rows = await prisma.slider.findMany({
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
    });

    return NextResponse.json({ sliders: rows.map(serializeSlider) });
  } catch (e: unknown) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/sliders] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const CreateBody = z
  .object({
    title: z.string().trim().min(2).max(120),
    imagePublicId: z.string().trim().min(2).max(300),
    imageUrl: z.string().trim().url().max(1000),
    linkUrl: z.string().trim().url().max(1000).optional().nullable(),
    kind: SliderKindEnum.default("SLIDE"),
    audienceRoles: z.array(SliderRoleEnum).max(SLIDER_ROLES.length).default([]),
    active: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(100000).default(0),
    startAt: z.string().datetime().optional().nullable(),
    endAt: z.string().datetime().optional().nullable(),
  })
  .refine(
    (v) => !v.startAt || !v.endAt || new Date(v.startAt) <= new Date(v.endAt),
    { message: "endAt must be on or after startAt", path: ["endAt"] }
  );

export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireAdminActivity(req, {
      action: "slider.create",
      roles: ["MASTER_ADMIN", "ADMIN", "SUPPORT"],
      entity: "Slider",
    });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }

  if (!isAdminRole(admin.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    await enforceRateLimit(`slider:create:${admin.id}`, RATE_LIMITS.default);

    const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    const body = parsed.data;

    // De-duplicate audience roles.
    const audienceRoles = Array.from(new Set(body.audienceRoles));

    const created = await prisma.slider.create({
      data: {
        title: body.title,
        imagePublicId: body.imagePublicId,
        imageUrl: body.imageUrl,
        linkUrl: body.linkUrl ?? null,
        kind: body.kind,
        audienceRoles,
        active: body.active,
        sortOrder: body.sortOrder,
        startAt: body.startAt ? new Date(body.startAt) : null,
        endAt: body.endAt ? new Date(body.endAt) : null,
        createdById: admin.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "slider.create",
        entity: "Slider",
        entityId: created.id,
        meta: {
          title: created.title,
          kind: created.kind,
          active: created.active,
          audienceRoles: created.audienceRoles,
        },
      },
    });

    return NextResponse.json(
      { ok: true, slider: serializeSlider(created) },
      { status: 201 }
    );
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
}
