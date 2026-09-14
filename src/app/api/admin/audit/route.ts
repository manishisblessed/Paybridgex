import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { formatIST } from "@/lib/utils";

export const fetchCache = "force-no-store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT");
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") ?? "";
    const severity = searchParams.get("severity");
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(100, Math.max(10, Number(searchParams.get("pageSize") ?? 50)));

    const where: Record<string, unknown> = {};

    if (q) {
      where.OR = [
        { action: { contains: q, mode: "insensitive" } },
        { entity: { contains: q, mode: "insensitive" } },
        { entityId: { contains: q, mode: "insensitive" } },
        { user: { email: { contains: q, mode: "insensitive" } } },
      ];
    }

    if (severity && severity !== "all") {
      if (severity === "security") {
        // Security category: every auth/authorization/anomaly/step-up event.
        where.OR = [
          ...((where.OR as unknown[]) ?? []),
          { action: { startsWith: "auth." } },
          { action: { startsWith: "stepup." } },
          { action: { startsWith: "2fa." } },
        ];
      } else {
        const severityActions: Record<string, string[]> = {
          danger: ["user.suspend", "user.close", "kyc.reject", "auth.account_locked", "auth.login_blocked"],
          warn: ["commission.update", "commission.deactivate", "fund_request.reject", "auth.login_failed", "stepup.failed"],
          info: ["kyc.approve", "fund_request.approve", "user.activate", "commission.create", "auth.login", "auth.register"],
        };
        if (severityActions[severity]) {
          where.action = { in: severityActions[severity] };
        }
      }
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: where as any,
        include: { user: { select: { email: true, name: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.auditLog.count({ where: where as any }),
    ]);

    const dangerActions = ["user.suspend", "user.close", "kyc.reject", "auth.account_locked", "auth.login_blocked"];
    const warnActions = ["commission.update", "commission.deactivate", "fund_request.reject", "auth.login_failed", "stepup.failed"];

    const severityMap = (action: string, meta: unknown): "info" | "warn" | "danger" => {
      // Prefer the severity stamped by logSecurityEvent when present.
      const metaSeverity = (meta as { severity?: string } | null)?.severity;
      if (metaSeverity === "danger" || metaSeverity === "warn" || metaSeverity === "info") return metaSeverity;
      if (dangerActions.includes(action)) return "danger";
      if (warnActions.includes(action)) return "warn";
      return "info";
    };

    // Summarize anomaly flags (impossible travel / new device / repeated failures).
    const flagSummary = (meta: unknown): string[] => {
      const a = (meta as { anomalies?: Record<string, boolean> } | null)?.anomalies;
      if (!a) return [];
      const flags: string[] = [];
      if (a.impossibleTravel) flags.push("impossible-travel");
      if (a.newDevice) flags.push("new-device");
      if (a.repeatedFailures) flags.push("repeated-failures");
      return flags;
    };

    const mapped = logs.map((l) => ({
      id: l.id,
      actor: l.user?.email ?? "system",
      action: l.action,
      target: [l.entity, l.entityId].filter(Boolean).join(" · ") || "—",
      ip: l.ip ?? "n/a",
      severity: severityMap(l.action, l.meta),
      flags: flagSummary(l.meta),
      ts: formatIST(l.createdAt, {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }),
      meta: l.meta,
    }));

    return NextResponse.json({ events: mapped, total, page, pageSize });
  } catch (e: any) {
    if (e?.name === "AuthError") return NextResponse.json({ error: e.message }, { status: 401 });
    console.error("[admin/audit] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
