import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { getSetting, setSetting } from "@/lib/settings";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * GET — the per-tier default service allowlist granted to NEW network users at
 * creation, plus the toggleable service catalog so the UI can render the chips.
 */
export async function GET() {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT");

    const [defaults, services] = await Promise.all([
      getSetting("network.default_services"),
      prisma.serviceRoute.findMany({
        where: { type: "SERVICE" },
        orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
        select: { key: true, name: true, kind: true },
      }),
    ]);

    return NextResponse.json({ defaults, services });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/network/default-services] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const PutBody = z.object({
  role: z.enum(["RETAILER", "DISTRIBUTOR", "MASTER_DISTRIBUTOR", "SUPER_DISTRIBUTOR"]),
  serviceKeys: z.array(z.string()),
});

/**
 * PUT — replace the default service allowlist for ONE tier. Only affects users
 * created afterwards (existing users are untouched; use the tier bulk toggle or
 * the `backfill:network-services` script to apply to current users).
 */
export async function PUT(req: Request) {
  try {
    const admin = await requireRole("MASTER_ADMIN", "ADMIN");

    const parsed = PutBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const { role, serviceKeys } = parsed.data;

    // Only real, toggleable service keys may be stored as a default.
    const known = await prisma.serviceRoute.findMany({
      where: { key: { in: serviceKeys }, type: "SERVICE" },
      select: { key: true },
    });
    const knownKeys = new Set(known.map((r) => r.key));
    const unknown = serviceKeys.filter((k) => !knownKeys.has(k));
    if (unknown.length > 0)
      return NextResponse.json(
        { error: `Unknown service keys: ${unknown.join(", ")}` },
        { status: 400 }
      );

    const current = await getSetting("network.default_services");
    const deduped = Array.from(new Set(serviceKeys));
    const updated = await setSetting(
      "network.default_services",
      { ...current, [role]: deduped },
      admin.id
    );

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "network.default-services.updated",
        entity: "PlatformSetting",
        entityId: "network.default_services",
        meta: { role, serviceKeys: deduped },
        ip: clientIp(req),
      },
    });

    return NextResponse.json({ ok: true, defaults: updated });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/network/default-services] PUT error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
