import { prisma } from "../db";
import { requireRole, type SessionUser } from "../auth-server";
import { requireStepUp, readStepUpCode } from "./stepUp";
import { clientIp } from "./audit";
import { securityLogger } from "../logger";

/**
 * Admin activity control.
 *
 * Every state-changing admin action must (1) re-authenticate the operator with
 * a fresh 2FA step-up code (no grace window — verified on EVERY write) and
 * (2) be recorded to the AuditLog with a durable snapshot of WHO did it (name +
 * role, so the record survives a later rename/deletion), WHERE (browser
 * geolocation, falling back to the operator's last-login location) and WHAT.
 *
 * Sensitive read access (admin page views) is recorded too, but without a
 * step-up prompt — use {@link recordAdminActivity} directly with kind:"read".
 */

const DEFAULT_ADMIN_ROLES = ["MASTER_ADMIN", "ADMIN", "SUPPORT"] as const;

export type ActionLocation = {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
};

/**
 * Read the live per-action geolocation the client attaches to a write request.
 * Preferred transport is headers (x-geo-lat / x-geo-lng / x-geo-acc); the JSON
 * body (geoLat / geoLng / geoAccuracy) is accepted as a fallback. Returns nulls
 * when unavailable — the caller fills in the last-login location instead.
 */
export function readActionLocation(
  req: Request,
  body?: Record<string, unknown>
): ActionLocation {
  const num = (v: unknown): number | null => {
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const lat = num(req.headers.get("x-geo-lat")) ?? num(body?.geoLat);
  const lng = num(req.headers.get("x-geo-lng")) ?? num(body?.geoLng);
  const accuracy = num(req.headers.get("x-geo-acc")) ?? num(body?.geoAccuracy);
  return { lat, lng, accuracy };
}

export type RecordAdminActivityInput = {
  actor: Pick<SessionUser, "id" | "name" | "role">;
  req: Request;
  action: string; // e.g. "qr.update", "admin.page.view"
  kind: "write" | "read";
  entity?: string;
  entityId?: string | null;
  location?: ActionLocation;
  meta?: Record<string, unknown>;
};

/**
 * Persist an admin activity row. Best-effort: a logging failure must never break
 * the underlying action. Falls back to the actor's last-login location when no
 * live geolocation was supplied.
 */
export async function recordAdminActivity(input: RecordAdminActivityInput): Promise<void> {
  try {
    let { lat = null, lng = null, accuracy = null } = input.location ?? {};

    if (lat == null || lng == null) {
      const dbUser = await prisma.user.findUnique({
        where: { id: input.actor.id },
        select: { lastLoginLat: true, lastLoginLng: true },
      });
      if (lat == null) lat = dbUser?.lastLoginLat ?? null;
      if (lng == null) lng = dbUser?.lastLoginLng ?? null;
    }

    await prisma.auditLog.create({
      data: {
        userId: input.actor.id,
        action: input.action,
        entity: input.entity ?? "Admin",
        entityId: input.entityId ?? null,
        ip: clientIp(input.req),
        userAgent: input.req.headers.get("user-agent"),
        actorName: input.actor.name,
        actorRole: input.actor.role,
        lat,
        lng,
        locationAccuracy: accuracy,
        kind: input.kind,
        meta: input.meta ? (input.meta as object) : undefined,
      },
    });
  } catch (err) {
    securityLogger.error({
      action: "admin_activity.persist_failed",
      err: String(err),
      attemptedAction: input.action,
    });
  }
}

export type RequireAdminActivityOptions = {
  action: string;
  roles?: readonly string[];
  entity?: string;
  entityId?: string | null;
  /** Parsed request body (so the step-up code / geo can be read from it). */
  body?: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

/**
 * Single choke-point for every admin WRITE action:
 *   1. Enforce role (defaults to the admin roles).
 *   2. Re-verify a fresh 2FA step-up code (throws StepUpError → 401/412).
 *   3. Record the activity (actor snapshot + geo) to the AuditLog.
 *
 * Returns the authenticated admin. Call this at the top of every mutating admin
 * route, passing the parsed body so the step-up code and live location can be
 * read from headers or body.
 */
export async function requireAdminActivity(
  req: Request,
  opts: RequireAdminActivityOptions
): Promise<SessionUser> {
  const admin = await requireRole(...(opts.roles ?? DEFAULT_ADMIN_ROLES));

  const { code, type } = readStepUpCode(req, opts.body);
  await requireStepUp(admin, {
    action: opts.action,
    code,
    type,
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent"),
  });

  await recordAdminActivity({
    actor: admin,
    req,
    action: opts.action,
    kind: "write",
    entity: opts.entity,
    entityId: opts.entityId,
    location: readActionLocation(req, opts.body),
    meta: opts.meta,
  });

  return admin;
}
