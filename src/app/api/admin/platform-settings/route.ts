import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, AuthError } from "@/lib/auth-server";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { getAllSettings, isSettingKey, setSetting } from "@/lib/settings";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/** GET — every platform setting with its effective (stored or default) value. */
export async function GET() {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "FINANCE");
    return NextResponse.json({ settings: await getAllSettings() });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/platform-settings] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const PutBody = z.object({
  key: z.string().min(1),
  value: z.unknown(),
});

/** PUT — update one setting (master-admin only; validated by the zod schema). */
export async function PUT(req: Request) {
  let admin;
  try {
    admin = await requireAdminActivity(req, {
      action: "platform_setting.update",
      roles: ["MASTER_ADMIN"],
      entity: "PlatformSetting",
    });
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = PutBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (!isSettingKey(parsed.data.key))
    return NextResponse.json({ error: `Unknown setting key: ${parsed.data.key}` }, { status: 400 });

  try {
    const stored = await setSetting(parsed.data.key, parsed.data.value, admin.id);
    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "platform_setting.updated",
        entity: "PlatformSetting",
        entityId: parsed.data.key,
        meta: { value: stored as object },
        ip: clientIp(req),
      },
    });
    return NextResponse.json({ ok: true, value: stored });
  } catch (e) {
    if (e instanceof z.ZodError)
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    console.error("[admin/platform-settings] PUT error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
