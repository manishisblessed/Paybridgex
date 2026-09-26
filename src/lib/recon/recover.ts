import { prisma } from "@/lib/db";
import { deriveTxnRefs } from "./refs";

/**
 * Recover provider poll references for a transaction from the durable
 * `PartnerApiLog` — the crash-proof fallback when neither the stored
 * `partnerTxnId` nor anything mined from the Transaction's own request/response
 * resolves at the provider.
 *
 * The transport (`samedayRequest`) records every money-moving call there,
 * patching in the response (and mined `providerRef`) the instant it returns —
 * BEFORE runTransaction persists it on the Transaction. So even if the process
 * died mid-flight and left the Transaction with a blank partnerTxnId + null
 * response, the provider's durable key (request_id/order_id/txn_id) survives
 * here and this recovers it.
 *
 * Read-only + de-duped; finalization still flows through the single idempotent
 * `finalizeServiceTransaction`, so a recovered ref can never double-settle or
 * double-refund.
 */
export async function recoverRefsFromApiLog(txnRefId: string | null | undefined): Promise<string[]> {
  const ref = (txnRefId ?? "").trim();
  if (!ref) return [];

  const logs = await prisma.partnerApiLog.findMany({
    where: { txnRefId: ref },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { providerRef: true, response: true },
  });

  const out: string[] = [];
  for (const l of logs) {
    if (l.providerRef && l.providerRef.trim()) out.push(l.providerRef.trim());
    // Belt-and-braces: mine the raw response too, in case providerRef was not
    // populated (older rows / mining-key drift).
    for (const r of deriveTxnRefs({ response: l.response })) out.push(r);
  }
  return Array.from(new Set(out.filter(Boolean)));
}
