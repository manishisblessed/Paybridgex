import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { getCardClassificationSetting } from "@/lib/settings";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/** GET — all brands with rate/machine counts. */
export async function GET() {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT", "FINANCE");
    const [brands, cardClassification] = await Promise.all([
      prisma.brand.findMany({
        orderBy: [{ active: "desc" }, { name: "asc" }],
        include: { _count: { select: { rates: true, machines: true } } },
      }),
      getCardClassificationSetting(),
    ]);
    return NextResponse.json({
      brands: brands.map((b) => ({
        id: b.id,
        key: b.key,
        name: b.name,
        description: b.description,
        active: b.active,
        settlementMode: b.settlementMode,
        rates: b._count.rates,
        machines: b._count.machines,
        createdAt: b.createdAt.toISOString(),
      })),
      // Whether card classification (tier) pricing is active — the rate editor
      // hides the Classification field when off (MDR uses Card Category).
      cardClassificationEnabled: cardClassification.enabled,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/brands] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const CreateBody = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "key must be a lowercase slug (a-z, 0-9, -)"),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
  settlementMode: z.enum(["INSTANT", "T1", "BOTH"]).default("T1"),
});

/** POST — create a brand. */
export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const key = parsed.data.key.toLowerCase();
  const exists = await prisma.brand.findUnique({ where: { key } });
  if (exists)
    return NextResponse.json(
      { error: `A brand with key "${key}" already exists` },
      { status: 409 }
    );

  const created = await prisma.brand.create({
    data: {
      key,
      name: parsed.data.name,
      description: parsed.data.description,
      settlementMode: parsed.data.settlementMode,
      createdById: admin.id,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "brand.created",
      entity: "Brand",
      entityId: created.id,
      meta: { key: created.key, name: created.name, settlementMode: created.settlementMode },
      ip: clientIp(req),
    },
  });

  return NextResponse.json({ ok: true, brand: { id: created.id } }, { status: 201 });
}
