import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, AuthError } from "@/lib/auth-server";
import { isAdminRole } from "@/lib/security/ownership";
import { prisma } from "@/lib/db";
import { deleteFromCloudinary } from "@/lib/cloudinary";
import {
  SLIDER_ROLES,
  SliderKindEnum,
  SliderRoleEnum,
  serializeSlider,
} from "@/lib/sliders";

export const fetchCache = "force-no-store";

export const dynamic = "force-dynamic";

const UpdateBody = z
  .object({
    title: z.string().trim().min(2).max(120).optional(),
    // Image swap: both must arrive together so we can clean up the old asset.
    imagePublicId: z.string().trim().min(2).max(300).optional(),
    imageUrl: z.string().trim().url().max(1000).optional(),
    linkUrl: z.string().trim().url().max(1000).nullable().optional(),
    kind: SliderKindEnum.optional(),
    audienceRoles: z.array(SliderRoleEnum).max(SLIDER_ROLES.length).optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(100000).optional(),
    startAt: z.string().datetime().nullable().optional(),
    endAt: z.string().datetime().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" })
  .refine(
    (v) =>
      (v.imagePublicId === undefined) === (v.imageUrl === undefined),
    { message: "imagePublicId and imageUrl must be updated together", path: ["imageUrl"] }
  );

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT");
  } catch (e: unknown) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  if (!isAdminRole(admin.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = UpdateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;

  const existing = await prisma.slider.findUnique({ where: { id: params.id } });
  if (!existing)
    return NextResponse.json({ error: "Slider not found" }, { status: 404 });

  // Cross-field schedule validation against the merged (existing + incoming) state.
  const nextStart = body.startAt !== undefined ? body.startAt : existing.startAt?.toISOString() ?? null;
  const nextEnd = body.endAt !== undefined ? body.endAt : existing.endAt?.toISOString() ?? null;
  if (nextStart && nextEnd && new Date(nextStart) > new Date(nextEnd))
    return NextResponse.json(
      { error: "endAt must be on or after startAt" },
      { status: 400 }
    );

  const replacingImage =
    body.imagePublicId !== undefined && body.imagePublicId !== existing.imagePublicId;

  const updated = await prisma.slider.update({
    where: { id: params.id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.imagePublicId !== undefined ? { imagePublicId: body.imagePublicId } : {}),
      ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl } : {}),
      ...(body.linkUrl !== undefined ? { linkUrl: body.linkUrl } : {}),
      ...(body.kind !== undefined ? { kind: body.kind } : {}),
      ...(body.audienceRoles !== undefined
        ? { audienceRoles: Array.from(new Set(body.audienceRoles)) }
        : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      ...(body.startAt !== undefined
        ? { startAt: body.startAt ? new Date(body.startAt) : null }
        : {}),
      ...(body.endAt !== undefined
        ? { endAt: body.endAt ? new Date(body.endAt) : null }
        : {}),
    },
  });

  // Best-effort: remove the orphaned old image from Cloudinary after a swap.
  if (replacingImage) {
    try {
      await deleteFromCloudinary(existing.imagePublicId, { isSensitive: false });
    } catch (err) {
      console.error("[admin/sliders] old image cleanup failed:", err);
    }
  }

  const isToggle = body.active !== undefined && body.active !== existing.active;
  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: isToggle
        ? body.active
          ? "slider.activate"
          : "slider.deactivate"
        : "slider.update",
      entity: "Slider",
      entityId: updated.id,
      meta: {
        title: updated.title,
        imageReplaced: replacingImage,
        before: {
          active: existing.active,
          sortOrder: existing.sortOrder,
          kind: existing.kind,
          audienceRoles: existing.audienceRoles,
        },
        after: {
          active: updated.active,
          sortOrder: updated.sortOrder,
          kind: updated.kind,
          audienceRoles: updated.audienceRoles,
        },
      },
    },
  });

  return NextResponse.json({ ok: true, slider: serializeSlider(updated) });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT");
  } catch (e: unknown) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  if (!isAdminRole(admin.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const existing = await prisma.slider.findUnique({ where: { id: params.id } });
  if (!existing)
    return NextResponse.json({ error: "Slider not found" }, { status: 404 });

  await prisma.slider.delete({ where: { id: params.id } });

  // Best-effort image cleanup — never block the delete on a Cloudinary error.
  try {
    await deleteFromCloudinary(existing.imagePublicId, { isSensitive: false });
  } catch (err) {
    console.error("[admin/sliders] image delete failed:", err);
  }

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "slider.delete",
      entity: "Slider",
      entityId: existing.id,
      meta: { title: existing.title, kind: existing.kind, imagePublicId: existing.imagePublicId },
    },
  });

  return NextResponse.json({ ok: true });
}
