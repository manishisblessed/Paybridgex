import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, AuthError } from "@/lib/auth-server";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { isAdminRole } from "@/lib/security/ownership";
import { prisma } from "@/lib/db";
import { seedServiceRoutes } from "@/lib/services/catalog";

export const fetchCache = "force-no-store";

export const dynamic = "force-dynamic";

const KIND = z.enum([
  "PG",
  "POS",
  "BBPS",
  "PAYOUT",
  "QR",
  "UPI",
  "RECHARGE",
  "AEPS",
  "DMT",
  "TRAVEL",
  "OTHER",
]);
const TYPE = z.enum(["SERVICE", "CONFIG", "SETTING"]);

function serialize(r: {
  id: string;
  key: string;
  name: string;
  type: string;
  kind: string;
  provider: string | null;
  enabled: boolean;
  note: string | null;
  balance: unknown;
  sortOrder: number;
  meta: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    type: r.type,
    kind: r.kind,
    provider: r.provider,
    enabled: r.enabled,
    note: r.note,
    balance: r.balance == null ? null : Number(r.balance),
    sortOrder: r.sortOrder,
    meta: r.meta ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function GET() {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT");

    const rows = await prisma.serviceRoute.findMany({
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    });

    return NextResponse.json({ services: rows.map(serialize) });
  } catch (e: unknown) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/services] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const CreateBody = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9_]+$/, "Key must be lowercase letters, numbers and underscores"),
  name: z.string().trim().min(2).max(120),
  type: TYPE.default("SERVICE"),
  kind: KIND.default("OTHER"),
  provider: z.string().trim().max(60).optional().nullable(),
  enabled: z.boolean().default(true),
  note: z.string().trim().max(500).optional().nullable(),
  sortOrder: z.number().int().min(0).max(100000).default(0),
});

const SeedBody = z.object({ action: z.literal("seed") });

export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireAdminActivity(req, {
      action: "service.write",
      roles: ["MASTER_ADMIN", "ADMIN", "SUPPORT"],
      entity: "ServiceRoute",
    });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }

  // Defense in depth: explicit admin-role gate (SUPPORT included).
  if (!isAdminRole(admin.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const json = await req.json().catch(() => ({}));

  // Branch 1: seed the known catalog rows.
  const seed = SeedBody.safeParse(json);
  if (seed.success) {
    const result = await seedServiceRoutes(prisma);
    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "service.seed",
        entity: "ServiceRoute",
        meta: result,
      },
    });
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  }

  // Branch 2: create a new custom route.
  const parsed = CreateBody.safeParse(json);
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;

  const exists = await prisma.serviceRoute.findUnique({ where: { key: body.key } });
  if (exists)
    return NextResponse.json(
      { error: `A service with key "${body.key}" already exists` },
      { status: 409 }
    );

  const created = await prisma.serviceRoute.create({
    data: {
      key: body.key,
      name: body.name,
      type: body.type,
      kind: body.kind,
      provider: body.provider ?? null,
      enabled: body.enabled,
      note: body.note ?? null,
      sortOrder: body.sortOrder,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "service.create",
      entity: "ServiceRoute",
      entityId: created.id,
      meta: { key: created.key, name: created.name, enabled: created.enabled },
    },
  });

  return NextResponse.json({ ok: true, service: serialize(created) }, { status: 201 });
}
