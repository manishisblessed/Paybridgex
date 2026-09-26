/**
 * Provider poll-reference recovery — shared by every service reconciliation
 * rail (BBPS/Pay2New, RechargeKit CC-2) and the targeted one-off reconciler.
 *
 * A stuck transaction can be resolved at the provider by ANY reference it ever
 * exchanged with us: the stored `partnerTxnId`, plus any order_id / request_id /
 * txn_id / bill_fetch_ref buried in the pay `request` or `response` JSON.
 *
 * Why mine BOTH request and response:
 *   `runTransaction` persists the `request` JSON and reserves funds in ONE
 *   committed DB transaction, THEN calls the partner and only afterwards writes
 *   `response` + `partnerTxnId`. If the process dies in between (deploy/restart/
 *   timeout mid-call), the row is left PROCESSING with a BLANK partnerTxnId and
 *   a NULL response — invisible to any recon that keys off partnerTxnId. But the
 *   pollable provider reference often survives in the request payload (e.g.
 *   Pay2New's `bill_fetch_ref`, the fetch-step order_id). Mining the request is
 *   what makes such a row pollable again instead of stranded forever.
 *
 * The returned list is de-duped and priority-ordered (partnerTxnId first, then
 * request, then response) so callers try the most authoritative handle first.
 *
 * NOTE: This function only DISCOVERS references. It never touches money. All
 * finalization still flows through `finalizeServiceTransaction`, which is the
 * single idempotent settle/refund path (status-claim + keyed ledger), so a row
 * can never be double-credited or double-refunded no matter how many refs match.
 */

/** JSON keys that carry a provider-resolvable transaction reference. */
const REF_KEYS: ReadonlySet<string> = new Set([
  "order_id", "orderId",
  "request_id", "requestId",
  "txn_id", "txnId", "transaction_id", "transactionId",
  "bill_fetch_ref", "billFetchRef",
  "operator_reference", "operatorReference",
  "reference_id", "referenceId",
]);

/** Bound the recursion so a pathological payload can't blow the stack/CPU. */
const MAX_DEPTH = 5;

function walk(node: unknown, depth: number, out: string[]): void {
  if (node == null || depth > MAX_DEPTH) return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, depth + 1, out);
    return;
  }
  if (typeof node !== "object") return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (REF_KEYS.has(k) && typeof v === "string" && v.trim().length > 0) {
      out.push(v.trim());
    } else if (v && typeof v === "object") {
      walk(v, depth + 1, out);
    }
  }
}

export type TxnRefSource = {
  partnerTxnId?: string | null;
  request?: unknown;
  response?: unknown;
};

/**
 * Collect every candidate provider reference for a transaction, in priority
 * order: stored partnerTxnId → refs mined from the request JSON → refs mined
 * from the response JSON. De-duped; empty strings dropped.
 */
export function deriveTxnRefs(txn: TxnRefSource): string[] {
  const out: string[] = [];
  const pt = typeof txn.partnerTxnId === "string" ? txn.partnerTxnId.trim() : "";
  if (pt) out.push(pt);
  walk(txn.request, 0, out);
  walk(txn.response, 0, out);
  return Array.from(new Set(out));
}
