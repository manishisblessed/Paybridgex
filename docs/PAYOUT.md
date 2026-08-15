# Payout (BulkPe)

End-to-end bank/UPI disbursal built on the Phase 0 foundation (ledger holds,
field encryption, idempotency, rate limiting, queue worker, partner factory).

## 1. Charge model — service charge is ON TOP

The beneficiary receives the **full** payout `amount`. The user pays:

```
serviceCharge = flat fee by mode/slab        (see src/lib/payout/charges.ts)
gst           = percentOf(serviceCharge, 18) (money.ts, rounded at money scale)
totalDebit    = amount + serviceCharge + gst
```

All math uses `Prisma.Decimal` via `src/lib/money.ts` (`add`, `percentOf`,
`round`). Never `Number()` for money. `quotePayout(amount, mode)` is the single
source of truth, used by the quote endpoint, the submit route, and the UI
preview — the client value is never trusted.

Default service-charge slabs (tune in `charges.ts`):

| Mode | Band (₹)        | Charge |
|------|-----------------|--------|
| IMPS | ≤1,000          | ₹5     |
| IMPS | ≤25,000         | ₹10    |
| IMPS | >25,000         | ₹15    |
| UPI  | ≤1,000          | ₹3     |
| UPI  | ≤25,000         | ₹6     |
| UPI  | >25,000         | ₹10    |
| NEFT | ≤10,000         | ₹5     |
| NEFT | >10,000         | ₹10    |
| RTGS | any             | ₹20    |

## 2. Ledger model (authorization-hold)

- **Submit** → `holdFunds(totalDebit)` reserves funds (no `WalletTxn`).
  `spendable = walletBalance − heldBalance`.
- **Terminal success** → `captureHold(totalDebit, reason PAYOUT)` posts the real
  DEBIT and reduces the hold.
- **Failure / rejection** → `releaseHold(totalDebit)` returns funds to spendable.
- **Post-settlement reversal** → `creditWallet(totalDebit, reason REVERSAL)`.

Idempotency keys: `payout:<id>:capture` and `payout:<id>:reversal` on
`WalletTxn`. Releases are guarded by single-winner conditional status claims.

## 3. State machine

```
PENDING_APPROVAL ──approve──▶ APPROVED ──worker──▶ PROCESSING
       │                                                │
       └──reject──▶ REJECTED (releaseHold)              ├─ success ─▶ SUCCESS (captureHold)
                                                        ├─ failure ─▶ FAILED  (releaseHold)
                                                        └─ (later) ─▶ REVERSED (creditWallet)
```

Every terminal transition uses a conditional `updateMany` claim so exactly one
caller (worker, webhook, or poller) finalizes. All paths are idempotent and
retry-safe.

## 4. Flow

1. **Submit (maker)** — `POST /api/payout`
   - `requireAuth` → `enforceRateLimit(RATE_LIMITS.payoutCreate)` → zod validate.
   - `withIdempotency` on the `Idempotency-Key` header (scope `payout.create`).
   - `quotePayout` computes charge + GST.
   - In one transaction: `holdFunds(totalDebit)` + create `PayoutRequest`
     `PENDING_APPROVAL`. Account/IFSC encrypted (`encryptField`), `accountLast4`
     stored plain for display. Raw PII is never logged.
   - Audit `payout.submitted`.
2. **Approve / Reject (checker)** — `PATCH /api/payout/:id`
   - `assertCanAccessUser(ownerId)` (parent/admin), **maker ≠ checker**.
   - Approve → claim `PENDING_APPROVAL → APPROVED`, enqueue
     `QUEUES.PAYOUT_INITIATE`, audit `payout.approved`.
   - Reject → claim `→ REJECTED` + `releaseHold`, audit `payout.rejected`.
3. **Worker (PM2)** — `scripts/worker.ts`, queue `payout.initiate`
   - Claim `APPROVED → PROCESSING`, call BulkPe with
     `reference_id = bulkpeReferenceId`, persist response + `bulkpeTxnId`.
   - Terminal success → `finalizePayoutSuccess` (capture + UTR); terminal
     failure → `finalizePayoutFailure` (release). PROCESSING is left for the
     webhook/poller. Retry-safe: if already sent, it reconciles instead.
4. **Webhook** — `POST /api/payout/webhook`
   - Verify HMAC (`BULKPE_WEBHOOK_SECRET`) over the **raw** body, match by
     `reference_id`/`transcation_id`, reconcile to terminal ledger state, audit
     `payout.webhook`. Idempotent; unknown refs are 200-acked.
5. **Poller** — scheduled `payout.reconcile` (cron `*/5 * * * *`)
   - Sweeps `PROCESSING` rows older than 120s, polls BulkPe, finalizes. Fallback
     for missed webhooks.

## 5. Provider — BulkPe

- Adapter: `src/lib/partners/bulkpe.ts`, implements `PayoutProvider`. Business
  code only ever calls `getPartner("payout")` — never the adapter directly.
- Factory order (`src/lib/partners/index.ts`): BulkPe (if configured) →
  RazorpayX (fallback) → MOCK. Gated by `flags.payout`
  (`PARTNER_PAYOUT_ENABLED`).
- Bearer auth (`BULKPE_TOKEN`). Unique `reference_id` per payout =
  idempotency + reconciliation key.
- Endpoints used: `POST /initiatePayout`, `POST /fetchTransactionDetails`.

### Env (`.env` / hosting secrets)

```
PARTNER_PAYOUT_ENABLED="true"
BULKPE_BASE_URL="https://api.bulkpe.in/client"
BULKPE_TOKEN="..."
BULKPE_WEBHOOK_SECRET="..."
APP_ENCRYPTION_KEY="..."   # required for PII encryption (Phase 0)
```

## 6. ⚠️ EC2 static Elastic IP (BulkPe IP-whitelisting)

BulkPe only accepts API calls from **pre-registered source IPs**. The worker
calls BulkPe, so the EC2 instance must egress from a **static Elastic IP**:

1. Allocate an Elastic IP and associate it with the EC2 instance (or the NAT
   Gateway if the instance is in a private subnet — whitelist the NAT's EIP).
2. Register that EIP in the BulkPe dashboard (IP allowlist).
3. Configure the webhook URL `https://<app-domain>/api/payout/webhook` in BulkPe
   and copy the signing secret into `BULKPE_WEBHOOK_SECRET`.
4. Keep the EIP stable across redeploys (it stays associated through PM2
   restarts; only detach intentionally).

Outbound payout calls run **only** from the worker process, so the whitelisted
IP is the box (or NAT) the `paybridgex-worker` PM2 app runs on.

## 7. Run / deploy

```powershell
# Local worker (loads .env via Node's built-in loader)
npm run worker

# Apply the migration (ask before running against a shared DB)
npx prisma migrate deploy
```

PM2 (EC2): `ecosystem.config.js` defines two apps — `paybridgex` (web,
cluster) and `paybridgex-worker` (fork, single instance: pg-boss handles
concurrency and a single scheduler avoids duplicate cron fan-out).

```bash
pm2 start ecosystem.config.js
pm2 logs paybridgex-worker
```

## 8. UI

- **`/dashboard/payout`** (maker): spendable/wallet/held cards, beneficiary form
  (IMPS/NEFT/RTGS/UPI), live charge+GST+total preview, submit, and a list of
  the user's payouts with status chips + UTR.
- **`/dashboard/payout-approvals`** (checker/admin): pending queue scoped via
  `scopeUserIdFilter`, approve/reject with remarks, and a detail drawer showing
  the **masked** account (`maskTail`).

## 9. Security checklist

- `requireAuth` + object-level ownership (`scopeUserIdFilter` /
  `assertCanAccessUser`) on every read/write.
- zod validation; rate limit on submit.
- Audit logs: `payout.submitted`, `payout.approved`, `payout.rejected`,
  `payout.success`, `payout.failed`, `payout.reversed`, `payout.webhook`.
- PII (account number, IFSC, UPI VPA) encrypted at rest (AES-256-GCM);
  `accountLast4` only for display; raw values never logged.
- Maker-checker separation enforced server-side.
- No secrets reach the client; BulkPe is called only from the worker.
