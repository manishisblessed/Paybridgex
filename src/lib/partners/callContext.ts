import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Async call context for partner API calls.
 *
 * `runTransaction` runs the partner `call()` inside this context carrying the
 * Transaction `refId`. The shared transport (`samedayRequest`) reads it when it
 * writes a `PartnerApiLog` row, so every money-moving provider call is durably
 * correlated to the exact Transaction — even when the process later dies before
 * the response is stored on the Transaction itself. Propagates transparently
 * across `await` boundaries (fetch, JSON parse), so no adapter signature needs
 * to change.
 */
export type PartnerCallStore = {
  /** Transaction.refId this partner call belongs to (e.g. "TXN8K2X9P..."). */
  txnRefId?: string;
};

export const partnerCallContext = new AsyncLocalStorage<PartnerCallStore>();

/** Current transaction refId for the in-flight partner call, if any. */
export function currentTxnRefId(): string | undefined {
  return partnerCallContext.getStore()?.txnRefId;
}
