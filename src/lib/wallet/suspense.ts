import crypto from "crypto";
import { prisma } from "@/lib/db";

/**
 * Company Suspense / Recovery account.
 *
 * Recovered lien funds (chargeback / fraud) are swept OUT of the offending
 * user and INTO this internal system account, so every recovery is a true
 * double-entry movement (user DEBIT ↔ suspense CREDIT) that recon can verify.
 *
 * The account is a FINANCE-role system user with a SUSPENDED status (it can
 * never log in) and an unusable random password. FINANCE is excluded from the
 * network-tier liability rollups, so the suspense float never pollutes the
 * user-liability totals.
 *
 * Resolved lazily and cached for the process lifetime.
 */

const SUSPENSE_EMAIL = "suspense@system.paybridgex";
const SUSPENSE_PHONE = "+910000000001";

let cachedSuspenseAccountId: string | null = null;

/** Find (or create once) the Company Suspense account and return its id. */
export async function getSuspenseAccountId(): Promise<string> {
  if (cachedSuspenseAccountId) return cachedSuspenseAccountId;

  const existing = await prisma.user.findUnique({
    where: { email: SUSPENSE_EMAIL },
    select: { id: true },
  });
  if (existing) {
    cachedSuspenseAccountId = existing.id;
    return existing.id;
  }

  const created = await prisma.user.create({
    data: {
      name: "Company Suspense / Recovery",
      email: SUSPENSE_EMAIL,
      phone: SUSPENSE_PHONE,
      // Unusable password — this account is never meant to authenticate.
      passwordHash: `disabled:${crypto.randomBytes(24).toString("hex")}`,
      role: "FINANCE",
      status: "SUSPENDED",
      shopName: "Company Suspense / Recovery",
    },
    select: { id: true },
  });
  cachedSuspenseAccountId = created.id;
  return created.id;
}
