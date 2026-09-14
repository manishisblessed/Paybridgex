import { z } from "zod";
import { ServiceCode, type Prisma } from "@prisma/client";
import { dec, toNumber } from "@/lib/money";

/**
 * Shared helpers for the Limit-Profiles admin API. Kept OUT of `route.ts` so the
 * route modules export only Next.js route handlers/config — exporting anything
 * else from a `route.ts` breaks Next's generated route type check.
 */

/** Valid keys for the per-service cap matrix: every ServiceCode (incl. PAYOUT). */
const SERVICE_KEYS = new Set<string>(Object.values(ServiceCode));

export const serviceCapsSchema = z
  .record(z.number().nonnegative())
  .refine((m) => Object.keys(m).every((k) => SERVICE_KEYS.has(k)), {
    message: "serviceCaps keys must be valid ServiceCode values",
  });

export type ProfileWithCount = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  active: boolean;
  isDefault: boolean;
  dailyAmountCap: Prisma.Decimal | null;
  dailyCountCap: number | null;
  nightFactor: number | null;
  serviceCaps: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
  _count?: { users: number };
};

export function serializeProfile(p: ProfileWithCount) {
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    description: p.description,
    active: p.active,
    isDefault: p.isDefault,
    dailyAmountCap: p.dailyAmountCap != null ? toNumber(dec(p.dailyAmountCap)) : null,
    dailyCountCap: p.dailyCountCap,
    nightFactor: p.nightFactor,
    serviceCaps: (p.serviceCaps ?? {}) as Record<string, number>,
    assignedUsers: p._count?.users ?? 0,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
