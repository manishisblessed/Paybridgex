import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth-server";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { prisma } from "@/lib/db";
import { serializeProfile, serviceCapsSchema } from "./shared";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const CreateBody = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Z0-9_]+$/, "Key must be UPPER_SNAKE_CASE (A–Z, 0–9, underscore)"),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).nullable().optional(),
  active: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  dailyAmountCap: z.number().positive().max(1_000_000_000).nullable().optional(),
  dailyCountCap: z.number().int().positive().max(100_000).nullable().optional(),
  nightFactor: z.number().gt(0).max(1).nullable().optional(),
  serviceCaps: serviceCapsSchema.optional(),
});

/** GET — list every tier (with assigned-user counts) for the admin editor. */
export async function GET() {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT", "FINANCE");
    const profiles = await prisma.limitProfile.findMany({
      orderBy: [{ isDefault: "desc" }, { dailyAmountCap: "asc" }, { createdAt: "asc" }],
      include: { _count: { select: { users: true } } },
    });
    return NextResponse.json({ profiles: profiles.map(serializeProfile) });
  } catch (e) {
    return toErrorResponse(e);
  }
}

/** POST — create a new tier. */
export async function POST(req: Request) {
  let body: z.infer<typeof CreateBody>;
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = CreateBody.safeParse(raw);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    body = parsed.data;
    await requireAdminActivity(req, {
      action: "limits.tier.create",
      roles: ["MASTER_ADMIN", "ADMIN"],
      entity: "LimitProfile",
      body: raw,
      meta: { key: body.key },
    });
  } catch (e) {
    return toErrorResponse(e);
  }

  const existing = await prisma.limitProfile.findUnique({ where: { key: body.key } });
  if (existing)
    return NextResponse.json({ error: `A tier with key "${body.key}" already exists` }, { status: 409 });

  const created = await prisma.$transaction(async (tx) => {
    if (body.isDefault) {
      await tx.limitProfile.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    }
    return tx.limitProfile.create({
      data: {
        key: body.key,
        name: body.name,
        description: body.description ?? null,
        active: body.active ?? true,
        isDefault: body.isDefault ?? false,
        dailyAmountCap: body.dailyAmountCap ?? null,
        dailyCountCap: body.dailyCountCap ?? null,
        nightFactor: body.nightFactor ?? null,
        serviceCaps: body.serviceCaps ?? {},
      },
      include: { _count: { select: { users: true } } },
    });
  });

  return NextResponse.json({ profile: serializeProfile(created) }, { status: 201 });
}
