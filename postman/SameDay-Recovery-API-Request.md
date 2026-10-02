# SameDay — Incident report & API change request

**To:** SameDay Solution — Integration / Technical team
**From:** PaybridgeX integration team
**Rails affected:** BBPS-2 / Pay2New (Credit Card bill payment) and RechargeKit CC-2
**Severity:** High — causes direct, silent financial loss on our side and leaves
customer funds in limbo.

---

## 1. Summary

When a `bill/pay` call to your API does not return a clean response to us (network
drop, HTTP 5xx, or gateway timeout), the payment can still **complete on your side
and charge the customer**, while we never receive the pay-step reference
(`order_id` / `request_id`). With the current API surface we then have **no way to
learn the real outcome programmatically** — so a payment that actually **succeeded**
looks failed to us.

We have already fixed our side so these payments are now **held, not refunded** (so
we no longer lose money automatically). But to *resolve* them without a human
logging into your portal, we need one of the API capabilities requested in
section 4.

---

## 2. What happened (concrete incident)

- **Transaction:** Credit Card Bill Payment of **₹50,027.50** via BBPS-2 / Pay2New.
- On **your portal**, when we log into our SameDay account, this payment shows
  **SUCCESS** (the customer's card bill was paid).
- On **our side**, the `bill/pay` HTTP response never reached us (lost in transit /
  gateway error). We therefore never captured the **pay-step** `order_id`
  (`P2N_PAY_…`) or `request_id` (`SDS…`).
- The only reference we still hold is the **bill-fetch** `order_id` (the
  `P2N_ORD_…` / `SMPHMK…` token returned earlier by `bill/fetch`).
- When we call `bill/status` with that bill-fetch token, your API returns
  **`ORDER_NOT_FOUND`** — because `bill/status` only accepts the **pay-step**
  reference, which we lost in the dropped response.
- There is **no list / search endpoint** that would let us find the payment by the
  bill-fetch reference, amount, biller, or time window.

Net result: your system has SUCCESS + a real customer charge; our system has no
programmatic way to see it. Previously our software auto-marked such a payment as
failed and refunded our retailer — so we paid you (via the real card charge) **and**
refunded the retailer: a double loss. We have now changed our software to **hold**
these instead, pending resolution.

---

## 3. Why the current API cannot resolve it

| Reference we have | Works with `bill/status`? | Result |
|---|---|---|
| Bill-fetch `order_id` (`P2N_ORD_…`) | No | `ORDER_NOT_FOUND` |
| Pay-step `order_id` (`P2N_PAY_…`) | Yes | — but we lost it in the dropped response |
| Pay-step `request_id` (`SDS…`) | Yes | — but we lost it in the dropped response |

- `bill/status` is keyed only on the pay-step reference.
- No endpoint maps a **bill-fetch** reference → its **pay-step** outcome.
- No list/search endpoint exists to recover the pay-step reference after the fact.

So after a lost pay response, the payment is **unreachable** through the API.

---

## 4. What we are asking for (any ONE of these unblocks full automation)

### Option A — Preferred: `bill/status` (or a new endpoint) keyed by bill-fetch reference
Let us query by the **bill-fetch** `order_id` / `bill_fetch_ref` and return the
latest **pay-step** state:

```
POST /bbps2/bill/status
{ "bill_fetch_ref": "P2N_ORD_XXXXXXXX" }

200 OK
{
  "bill_fetch_ref": "P2N_ORD_XXXXXXXX",
  "pay_order_id":   "P2N_PAY_YYYYYYYY",   // null if a payment was never attempted
  "request_id":     "SDS...",
  "status":         "SUCCESS | PENDING | FAILED | REFUNDED | NOT_ATTEMPTED",
  "amount":         50027.50,
  "operator_ref":   "…",
  "paid_at":        "2026-10-01T12:34:56Z"
}
```

### Option B — A list / search endpoint
A paginated search of payments for a date range, filterable by `bill_fetch_ref`,
biller, amount, and status — so we can correlate a lost payment to its pay-step
reference and then poll `bill/status` as normal.

### Option C — Documented idempotency on `bill/pay`
Confirm **in writing** that re-calling `bill/pay` with the **same**
`bill_fetch_ref` (and/or the same client idempotency key) is **idempotent** — it
returns the **original** payment's result and **never** creates a second charge.

> We have already built this recovery path on our side but it is **disabled by
> default**. We will not enable it until you confirm Option C in writing, because
> without that guarantee a retry could double-charge the customer.

### Option D — Webhooks / callbacks (complementary to the above)
If you can push a terminal pay-state callback to us, most lost-response cases would
self-heal. Please tell us how to subscribe, the payload format, and the signature
scheme (we already use HMAC-SHA256 with you).

---

## 5. Specific questions for your team

1. Can `bill/status` accept the **bill-fetch** reference (Option A)? If not, can you
   add a search/list endpoint (Option B)?
2. Is `bill/pay` idempotent on `bill_fetch_ref` or on a client idempotency key
   (Option C)? If yes, for how long is the original result retained for replay?
3. For a payment whose pay response was lost, what is the **authoritative API way**
   to retrieve its final state (no portal login)?
4. Do you emit **webhooks / callbacks** on terminal pay state for BBPS-2 / Pay2New?
   If so, how do we subscribe and what is the payload + signature scheme?
5. For reconciliation, is there any batch/EOD settlement file that lists terminal
   payments with both the bill-fetch and pay-step references?

---

## 6. What we need right now for this specific case

Please look up and confirm the **terminal status and pay-step reference**
(`P2N_PAY_…` / `request_id`) for the following payment so we can reconcile it:

- **Service:** Credit Card Bill Payment (BBPS-2 / Pay2New)
- **Amount:** ₹50,027.50
- **Bill-fetch reference (what we hold):** `<insert the P2N_ORD_… token from our record>`
- **Approx. date/time:** `<insert date/time>`
- **Our account:** `<insert SameDay merchant/account id>`

Once you confirm the pay-step reference, our system verifies the outcome through
your `bill/status` API and finalizes the transaction automatically.

Thank you — resolving this (especially Option A or C) removes an entire class of
reconciliation failures for both of us.
