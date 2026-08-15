# Security Controls — Paybridgex

This document maps each security goal to the concrete control that implements it,
and provides a route-by-route guard audit for every API endpoint. It is the
Phase 9 deliverable and is kept in sync with the code.

---

## 1. Stop attackers from taking over accounts

- **Account lockout with exponential backoff** — `src/lib/security/lockout.ts`
  (`assertNotLocked`, `recordFailedLogin`, `recordSuccessfulLogin`). Wired into
  `/api/auth/login` and the NextAuth `credentials` provider.
- **Breached-password check** via HIBP k-anonymity — `src/lib/security/breachedPassword.ts`
  (`assertPasswordNotBreached`). Enforced on `/api/auth/register` and
  `/api/onboard/[token]/register`.
- **Step-up 2FA on sensitive actions** — `src/lib/security/stepUp.ts`
  (`requireStepUp`, no-op unless `SECURITY_STEPUP_ENABLED`). Wired into payout
  approve/reject, AePS withdraw, and scheme mutations.
- **Login anomaly detection** — `src/lib/security/audit.ts`
  (`detectLoginAnomalies`): impossible travel (haversine speed), new device
  (sha256 fingerprint), repeated failures. Flags attached to the login audit meta.
- **Rate limiting on login/OTP** — `src/lib/security/rateLimit.ts`
  (`RATE_LIMITS.login` 5/5min per id + per ip; `RATE_LIMITS.otp` / `.otpIp`).

## 2. Protect user data access

- **Object-level ownership checks** — `src/lib/security/ownership.ts`
  (`assertOwner`, `assertCanAccessUser`, `scopeUserIdFilter`).
- **Recursive-CTE downline scoping** — `getDescendantIds` (self + full downline
  for network roles; everything for admins).
- **Role-based access control** — `requireAuth`, `requireRole` (`src/lib/auth-server.ts`)
  plus `isAdminRole` defense-in-depth on admin mutations.
- **Field-level PII encryption at rest** — `src/lib/crypto/fieldEncryption.ts`
  (`encryptField`/`decryptField`/`maskTail`, AES-256-GCM, `APP_ENCRYPTION_KEY`).
  Used for payout account numbers / IFSC and other PII.

## 3. Prevent attackers from stealing credentials

- **Passwords**: bcrypt hash (cost 12) on registration + breached-password rejection.
- **2FA secrets**: AES-256-GCM encrypted (`src/lib/two-factor.ts` → `encryptSecret`);
  backup codes bcrypt-hashed.
- **Sensitive env vars**: `APP_ENCRYPTION_KEY`, `NEXTAUTH_SECRET`, `BULKPE_TOKEN`,
  `BULKPE_WEBHOOK_SECRET` are server-only — never imported into client code; loaded
  via `src/lib/env.ts` with `requireEnv()` at the call site.
- **Structured logger redaction** — `src/lib/logger.ts` redacts passwords, tokens,
  OTPs, and account numbers; PII (phone/email) is masked before it reaches the
  audit log (e.g. OTP send/verify).

## 4. Ensure users can only access their own data

- **Every API route**: `requireAuth` → ownership/role guard → zod validation.
- **`scopeUserIdFilter`** for list queries (self + downline for network roles; all
  for admins) — used by payout list, POS, reports.
- **`assertOwner` / `assertCanAccessUser`** for single-resource access — used by
  payout detail/decision and fund-request decisions.
- **Middleware** (`src/middleware.ts`) enforces `/dashboard/admin/*` role gates and
  a request body-size cap.

## 5. Stop bots from spamming and overloading the application

- **Cloudflare Turnstile CAPTCHA** on login/register/OTP — `src/lib/security/captcha.ts`
  (`assertCaptcha`, no-op unless `SECURITY_CAPTCHA_ENABLED`).
- **DB-backed per-IP/user rate limiting** — `src/lib/security/rateLimit.ts`
  (atomic Postgres `INSERT … ON CONFLICT … RETURNING`, shared across PM2 workers).
- **Request body size limit** — `MAX_BODY_BYTES` (`src/lib/env.ts`), enforced in
  middleware (413 on oversize).
- **Per-route rate-limit presets** — login 5/5min, register 5/hr, OTP 5/10min
  (+20/10min per ip), payout 10/min, txn 30/min, fund-request 10/min,
  reports 120/min, sensitiveWrite 30/min.

## 6. Protect data in transit and detect suspicious activities

- **TLS / HSTS** — `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  (`next.config.mjs`).
- **Security headers** — CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `Permissions-Policy` (`next.config.mjs`).
- **Structured security logging** to stdout/CloudWatch — pino (`src/lib/logger.ts`),
  persisted to `AuditLog` for the admin audit view.
- **Login anomaly flags** — impossible travel, new device, repeated failures.
- **Webhook signature verification** — HMAC-SHA256, constant-time compare:
  `verifyBulkpeWebhook` (`src/lib/partners/bulkpe.ts`) and `verifyRazorpayWebhook`
  (`src/lib/partners/razorpay.ts`).

---

## Route Guard Audit Checklist

Legend: ✅ present · ❌ missing · — not applicable · 🔓 intentionally public.

Columns: **Auth** (`requireAuth`/`requireRole`) · **Role/Own** (role or ownership
scope) · **Zod** (body/query validation) · **Audit** (`AuditLog` on mutation) ·
**Rate** (rate limit on sensitive op).

### Auth & public surfaces

| Route | Method | Auth | Role/Own | Zod | Audit | Rate | Notes |
|-------|--------|------|----------|-----|-------|------|-------|
| `auth/login` | POST | 🔓 | — | ✅ | ✅ | ✅ | lockout + captcha + anomaly |
| `auth/register` | POST | 🔓 | — | ✅ | ✅ | ✅ | breached-pwd + captcha |
| `auth/otp/send` | POST | 🔓 | — | ✅ | ✅ | ✅ | captcha + per-target/ip RL |
| `auth/otp/verify` | POST | 🔓 | — | ✅ | ✅ | ✅ | per-target/ip RL + audit |
| `auth/2fa/setup` | POST | ✅ | self | — | ✅ | — | audit on secret gen |
| `auth/2fa/confirm` | POST | ✅ | self | ✅ | ✅ | — | |
| `auth/2fa/verify` | POST | 🔓 | temp-token | ✅ | ✅ | ✅ | `RATE_LIMITS.twoFactor` |
| `auth/2fa/verify-session` | POST | 🔓 | temp-token | ✅ | ✅ | ✅ | HMAC grant |
| `auth/[...nextauth]` | GET/POST | 🔓 | — | — | — | — | lockout in credentials provider |
| `onboard/[token]` | GET | 🔓 | token | — | — | — | invite lookup |
| `onboard/[token]/register` | POST | 🔓 | token | ✅ | ✅ | — | breached-pwd enforced |
| `onboard/[token]/verify` | POST | 🔓 | token | ✅ | ❌ | ❌ | eKYC; rate limit recommended |
| `healthz` | GET | 🔓 | — | — | — | — | probe |
| `webhooks/razorpay` | POST | 🔓 | HMAC sig | — | ✅ | — | signature verified |
| `payout/webhook` | POST | 🔓 | HMAC sig | — | ✅ | — | signature verified |

### Money & service routes

| Route | Method | Auth | Role/Own | Zod | Audit | Rate | Notes |
|-------|--------|------|----------|-----|-------|------|-------|
| `payout` | GET | ✅ | scopeUserIdFilter | — | — | — | scoped list |
| `payout` | POST | ✅ | self | ✅ | ✅ | ✅ | holdFunds + idempotency + service guard + **re-KYC gate** |
| `payout/[id]` | GET | ✅ | assertCanAccessUser | — | — | — | masked account |
| `payout/[id]` | PATCH | ✅ | assertCanAccessUser + maker≠checker | ✅ | ✅ | ✅ | step-up 2FA + **re-KYC gate on approve** |
| `payout/quote` | GET | ✅ | self (quotePayoutForUser) | ✅ | — | — | scheme-aware quote + **re-KYC gate** |
| `fund-request` | GET | ✅ | role/parent scope | — | — | — | |
| `fund-request` | POST | ✅ | self | ✅ | ✅ | ✅ | audit + **re-KYC gate** |
| `fund-request/[id]` | PATCH | ✅ | isAdminRole or parent | ✅ | ✅ | ✅ | ledger transfer + **re-KYC gate on approve** |
| `rekyc/status` | GET | ✅ | self | — | — | — | drives dashboard gate banner |
| `rekyc/initiate` | POST | ✅ | self (network tier) | ✅ | ✅ | ✅ | idempotent; per-user+IP RL; eKYC Hub OTP |
| `rekyc/verify` | POST | ✅ | self (network tier) | ✅ | ✅ | ✅ | step-up 2FA; idempotent; PII field-encrypted |
| `services/aeps/withdraw` | POST | ✅ | self | ✅ | ✅ | ✅ | step-up + ledger |
| `services/bbps/fetch` | POST | ✅ | self | ✅ | — | ✅ | read-only partner call |
| `services/bbps/pay` | POST | ✅ | self | ✅ | ✅ | ✅ | ledger via runTransaction |
| `services/dmt/transfer` | POST | ✅ | self | ✅ | ✅ | ✅ | ledger via runTransaction |
| `services/recharge` | POST | ✅ | self | ✅ | ✅ | ✅ | ledger via runTransaction |
| `services/pan/apply` | POST | ✅ | self | ✅ | ✅ | ✅ | ledger via runTransaction |
| `services/upi/collect` | POST | ✅ | self | ✅ | ✅ | ✅ | service guard + audit added |
| `services/travel/search` | POST | ✅ | — | ✅ | — | ✅ | read-only search |
| `wallet` | GET | ✅ | self | — | — | — | |
| `wallet/transactions` | GET | ✅ | self | — | — | — | |
| `transactions` | GET/POST | ✅ | self | ✅ | ✅ | ✅ | demo stub, now guarded |
| `bills/fetch` | POST | ✅ | self | ✅ | — | ✅ | demo stub, now guarded |

### Network, POS, KYC, reports, uploads

| Route | Method | Auth | Role/Own | Zod | Audit | Rate | Notes |
|-------|--------|------|----------|-----|-------|------|-------|
| `network` | GET | ✅ | parent scope | — | — | — | direct downline |
| `network/onboard` | POST | ✅ | canOnboard | ✅ | ✅ | ❌ | RL recommended |
| `pos/machines` | GET | ✅ | requireRole admin | — | — | — | fleet feed |
| `pos/my-machines` | GET | ✅ | scopeUserIdFilter | — | — | — | |
| `pos/transactions` | POST | ✅ | scopePosTerminals | ✅ | — | ✅ | partner read |
| `pos/export` | POST | ✅ | scopePosTerminals | ✅ | ✅ | ✅ | |
| `pos/export-status/[jobId]` | GET | ✅ | audit-row ownership | — | — | — | IDOR-safe |
| `sliders` | GET | ✅ | audienceRoles filter | — | — | — | active-window + role filter |
| `reports/[type]` | GET | ✅ | getDescendantIds | ✅ | ✅* | ✅ | *audit on export only |
| `dashboard/performance` | GET | ✅ | self | — | — | — | |
| `kyc` | GET/POST | ✅ | self | ✅ | ✅ | — | |
| `kyc/queue` | GET | ✅ | requireRole admin | — | — | — | global queue |
| `kyc/[id]` | PATCH | ✅ | requireRole admin | ✅ | ✅ | — | |
| `documents` | GET/POST | ✅ | self | ✅ | ✅ | — | |
| `uploads/sign` | POST | ✅ | self | ✅ | — | ❌ | RL recommended |

### Admin routes (all `requireRole`, admin-gated)

| Route | Method | Auth | Role/Own | Zod | Audit | Rate | Notes |
|-------|--------|------|----------|-----|-------|------|-------|
| `admin/stats` | GET | ✅ | requireRole | — | — | — | |
| `admin/services` | GET/POST | ✅ | requireRole + isAdminRole | ✅ | ✅ | — | |
| `admin/services/[id]` | PATCH | ✅ | requireRole + isAdminRole | ✅ | ✅ | — | |
| `admin/services/bulkpe-balance` | GET | ✅ | requireRole + isAdminRole | — | ✅ | ✅ | live balance refresh |
| `admin/users` | GET/POST | ✅ | requireRole | ✅ | ✅ | — | admins access all |
| `admin/users/[id]` | PATCH | ✅ | requireRole | ✅ | ✅ | — | |
| `admin/schemes` | GET/POST | ✅ | requireRole + isAdminRole | ✅ | ✅ | ✅ | |
| `admin/schemes/[id]` | GET/PATCH/DELETE | ✅ | requireRole + isAdminRole | ✅ | ✅ | ✅ | step-up |
| `admin/schemes/assign` | POST | ✅ | requireRole + isAdminRole | ✅ | ✅ | ✅ | |
| `admin/schemes/[id]/slabs` | POST | ✅ | requireRole + isAdminRole | ✅ | ✅ | — | |
| `admin/schemes/[id]/slabs/[slabId]` | PATCH/DELETE | ✅ | requireRole + isAdminRole | ✅ | ✅ | — | |
| `admin/invite` | GET/POST | ✅ | requireAuth + role array | ✅ | ✅ | — | |
| `admin/invite/[id]` | GET/PATCH | ✅ | requireAuth + role array | ✅ | ✅ | — | |
| `admin/audit` | GET | ✅ | requireRole | — | — | — | |
| `admin/sliders` | GET/POST | ✅ | requireRole + isAdminRole | ✅ | ✅ | ✅ | |
| `admin/sliders/[id]` | PATCH/DELETE | ✅ | requireRole + isAdminRole | ✅ | ✅ | — | |
| `admin/sliders/upload` | POST | ✅ | requireRole + isAdminRole | ✅ | ✅ | ✅ | audit added |
| `admin/pos/machines` | GET | ✅ | requireRole + isAdminRole | — | — | — | |
| `admin/pos/machines/assign` | POST | ✅ | requireRole + assertCanAccessUser | ✅ | ✅ | ✅ | |
| `admin/pos/machines/sync` | POST | ✅ | requireRole + isAdminRole | — | ✅ | ✅ | |
| `admin/sub-admins` | GET/POST | ✅ | requireRole | ✅ | ✅ | — | |
| `admin/sub-admins/[id]` | PATCH/DELETE | ✅ | requireRole + target guard | ✅ | ✅ | — | |
| `admin/commissions` | GET/POST | ✅ | requireRole | ✅ | ✅ | — | |
| `admin/commissions/[id]` | PATCH/DELETE | ✅ | requireRole | ✅ | ✅ | — | |
| `admin/settlements` | GET | ✅ | requireRole | — | — | — | |
| `admin/billers` | GET | ✅ | requireRole | — | — | — | |
| `admin/admins` | GET/POST | ✅ | requireRole(MASTER_ADMIN) | ✅ | ✅ | — | |
| `admin/admins/[id]` | PATCH/DELETE | ✅ | requireRole(MASTER_ADMIN) | ✅ | ✅ | — | |

**Notes on remaining `❌`/`—` rate-limit cells on admin routes:** these endpoints
are already gated behind `requireRole` (an authenticated admin/support session),
so they are not anonymous-abuse vectors. A `RATE_LIMITS.sensitiveWrite` preset
(30/min) exists and can be layered onto admin config mutations as defense-in-depth
hardening if desired. The genuinely public / pre-auth and money-moving surfaces
are all rate-limited.

---

## Cache Controls (Phase 12 — anti web-cache deception / poisoning / replay)

Defense-in-depth so that **no cache (browser, nginx, or CDN) ever stores an
authenticated HTML or API response**, no client-supplied money/identity value is
trusted, and every state-changing request is replay-safe. The nonce-based CSP and
`/_next/static` immutable caching are deliberately left untouched.

### 1. No-store on all authenticated responses (`src/middleware.ts`)

For any request whose path starts with `/dashboard` or `/api`, the middleware
(alongside the existing per-request CSP nonce) sets:

```
Cache-Control: no-store, no-cache, must-revalidate, private
Pragma: no-cache
Expires: 0
Vary: Cookie
```

The matcher still excludes `/_next/static`, `/_next/image`, `favicon.ico`,
`robots.txt`, `sitemap.xml` and all static file extensions, so static-asset
caching is unaffected.

### 2. Per-route belt-and-suspenders

Every handler under `src/app/api/**/route.ts` exports
`dynamic = "force-dynamic"` and `fetchCache = "force-no-store"`. Server-component
dashboard pages export `dynamic = "force-dynamic"`. (Client-component pages
cannot carry route-segment config and are covered by the middleware no-store +
the fact that they render no authenticated data on the server.)

### 3. nginx (`deploy/nginx-paybridgex.conf`)

- `location /` and `location /api/`: `proxy_no_cache 1; proxy_cache_bypass 1;`
  and `/api/` additionally emits `Cache-Control: no-store always`.
- The **only** cached location is `/_next/static/` (immutable, content-hashed).
- `Host` is pinned to `$host` and any client-supplied `X-Forwarded-Host` is
  overwritten with `$host`, so it cannot be used for cache poisoning or
  link/redirect spoofing.
- TLS terminates on 443; port 80 redirects to 443 so the app's HSTS header is
  honored. Cert paths are certbot-managed (comment in the file shows how to mint).

### 4. Untrusted forwarded headers (`src/lib/security/audit.ts`)

`clientIp()` / `clientIpFromHeaders()` no longer take the left-most (fully
client-controlled) `X-Forwarded-For` value. They take the entry our trusted
nginx hop appended — `TRUSTED_PROXY_HOPS` (default `1`) counted from the right —
falling back to `X-Real-IP`. `X-Forwarded-Host` / `Host` are never read to build
URLs, links, or cache keys. All previously-inline `x-forwarded-for` reads across
the API routes now go through this helper. Set `TRUSTED_PROXY_HOPS=2` if a CDN is
later placed in front of nginx.

### 5. Never trust client-sent money / identity

Money-moving and state-changing routes recompute amount/fee/GST/commission and
`balanceAfter` server-side via `Prisma.Decimal` + `src/lib/money.ts` and the
ledger (`src/lib/ledger.ts`), derive the actor from the session token, use
`.strict()` Zod schemas, and enforce ownership. Audit table:

Legend: **Client amount?** = does the body carry the *order amount* (the
inherently user-chosen value, e.g. how much to recharge)? **Fee/comm/GST server?**
= are fee, commission and tax computed server-side (never from the body)?

| Route | Method | Client amount? | Fee/comm/GST server-side? | Ownership / actor from token | `.strict()` | Fix applied |
|-------|--------|----------------|---------------------------|------------------------------|-------------|-------------|
| `payout` | POST | order amount only | charges via `quotePayoutForUser` (scheme + 18% GST) | `requireAuth` self, `holdFunds` | ✅ | `.strict()` + submit-nonce added |
| `payout/[id]` | PATCH | — (no amount) | held `totalDebit` reused from DB row | `assertCanAccessUser` + maker≠checker | ✅ | `.strict()` added |
| `payout/quote` | GET | order amount only | server quote (`quotePayoutForUser`) | self | ✅ (existing) | none needed |
| `fund-request` | POST | order amount only | no fee at create; money moves on approve | `requireAuth` self | ✅ | `.strict()` + idempotency + nonce added |
| `fund-request/[id]` | PATCH | — | ledger transfer, amount from DB row | admin or parent | ✅ | `.strict()` added |
| `services/recharge` | POST | order amount only | commission server-side (Decimal 3%) | self | ✅ | `.strict()` + float→`money.ts` |
| `services/bbps/pay` | POST | order amount only | commission server-side (Decimal 0.8% cap ₹15) | self | ✅ | `.strict()` + float→`money.ts` |
| `services/dmt/transfer` | POST | order amount only | fee + commission server-side (Decimal) | self | ✅ | `.strict()` + float→`money.ts` |
| `services/aeps/withdraw` | POST | order amount only | ledger via `runTransaction`, step-up 2FA | self | ✅ | `.strict()` added |
| `services/upi/collect` | POST | order amount only | ledger via `runTransaction` | self + service guard | ✅ | `.strict()` added |
| `services/pan/apply` | POST | — (fixed fee) | fee server-side via `runTransaction` | self | ✅ | `.strict()` added |
| `admin/schemes/assign` | POST | — | rates from DB scheme | `requireRole` + `isAdminRole` | ✅ | `.strict()` added |
| `admin/services/[id]` | PATCH | — | enable/disable flags only | `requireRole` + `isAdminRole` | ✅ | `.strict()` added |
| `admin/pos/machines/assign` | POST | — | assignment only | `requireRole` + `assertCanAccessUser` | ✅ | `.strict()` added |
| `admin/users/[id]` | PATCH | — | status only | `requireRole` | ✅ | `.strict()` + tokenVersion bump |
| `admin/admins/[id]` | PATCH/DELETE | — | role/status/tabs | `requireRole(MASTER_ADMIN)` | ✅ | `.strict()` + tokenVersion bump |
| `admin/sub-admins/[id]` | PATCH/DELETE | — | status only | `requireRole` + target guard | ✅ | `.strict()` + tokenVersion bump |

In every case the actor's `userId` / `role` / hierarchy comes from the session
token (`requireAuth`/`requireRole`), never from the request body, and
`balanceAfter` is written by the ledger — not by the caller.

### 6. Replay / idempotency on all state changes

- Money/critical POSTs accept an `Idempotency-Key` (ledger uses
  `WalletTxn.idempotencyKey`; non-ledger ops use `src/lib/idempotency.ts`). A
  replay returns the **cached original result** instead of re-executing.
  `fund-request` POST gained idempotency in this phase (it previously had none).
- **Submit nonce** (`src/lib/security/submitNonce.ts`, minted at
  `GET /api/security/nonce`): a short-TTL (10 min) **single-use** token. Sensitive
  web forms (payout, fund-request) fetch one and send it as `x-submit-nonce`; the
  server **consumes it atomically** on first use, so a captured/cached POST
  replayed later carries an already-spent nonce and is rejected. Bearer/mobile
  callers are exempt and rely on their `Idempotency-Key`.

### 7. Session invalidation on logout / privilege change

- `User.tokenVersion` (additive migration `20260628000000_add_token_version`):
  every JWT embeds the version it was minted with. The NextAuth `jwt` callback
  re-reads the DB on each request and **rejects any token whose version ≠
  `User.tokenVersion`** (and any `CLOSED` user), dropping the session.
- `bumpTokenVersion()` (`src/lib/security/session.ts`) increments it — wired into
  the NextAuth `signOut` event (logout invalidates all outstanding sessions) and
  into status/role/permission changes (`admin/users/[id]`, `admin/admins/[id]`,
  `admin/sub-admins/[id]`). Role/status are also refreshed into the token on
  every request, so a privilege change takes effect immediately.
- JWT lifetime shortened to **8 hours** (`session.maxAge`) to bound the window of
  any leaked/replayed cookie.

#### One-time global session invalidation (`scripts/forceGlobalLogout.ts`)

A one-shot kill-switch that runs a single statement:

```sql
UPDATE "User" SET "tokenVersion" = "tokenVersion" + 1;
```

Because every JWT embeds the `tokenVersion` it was minted with and the auth
callbacks reject mismatches, bumping it for **every** user instantly invalidates
**all** outstanding sessions across all roles — anyone with a session cookie that
pre-dates the run is forced to log in again.

**When to run:**

- **Right after deploying the cache-hardening fix**, to evict any sessions whose
  cookies were minted before the fix (e.g. during/around a breach).
- **During post-incident response**, any time session/cookie compromise is
  suspected.

**How to run** (PowerShell, from repo root, with `DATABASE_URL` set; on the
server run it from the deployed app directory):

```powershell
npm run force-logout
# or directly:
npx tsx scripts/forceGlobalLogout.ts
```

It moves no money, touches only `User.tokenVersion`, prints the affected user
count, and is safe to run repeatedly (each run re-evicts everyone).

## Monthly Re-KYC Gate (Phase 13 — identity re-verification)

Guarantees that only the registered person operates a NETWORK account: every
network-tier user (RT / DT / MD / SD — never staff/admin) must re-verify their
identity on the 1st of every month before they can transact.

- **Scheduler** (`scripts/worker.ts` + `src/lib/rekyc/sweep.ts`): a pg-boss
  scheduled job `rekyc.monthly` runs `0 0 1 * *` in **Asia/Kolkata (IST)** and
  batches `reKycRequired=true` + `reKycDueAt=1st of month` onto every **ACTIVE**
  network user. The sweep is idempotent (only flags users whose `reKycDueAt` is
  missing/older than this cycle) and processes in bounded `updateMany` batches.
- **Enforcement** (`src/lib/security/kycGate.ts` → `assertKycCurrent`): throws a
  typed **403 `REKYC_REQUIRED`** before any ledger op in payout (quote / create /
  approve) and fund-request (create / approve). Network membership is decided by
  `NETWORK_TIERS` in `src/lib/hierarchy.ts`. Staff roles short-circuit with no DB
  read; login stays open so a gated user can complete re-KYC.
- **Flow** (`/api/rekyc/{status,initiate,verify}`, `/dashboard/rekyc`): reuses the
  eKYC Hub for **Aadhaar OTP eKYC** (+ optional liveness **face match** vs. the
  onboarding baseline). On success: `reKycRequired=false`, `lastReKycAt=now`,
  `reKycDueAt=1st of next month`, `ReKycLog → PASSED`, AuditLog + securityLogger.
  On failure: `ReKycLog → FAILED`, gate stays closed.
- **Abuse controls**: per-user **and** per-IP rate limits (`RATE_LIMITS.rekyc`),
  idempotency on initiate/verify (so retries never double-charge the provider),
  and **step-up 2FA** required before verify submit.
- **PII**: only **masked** identity (`maskTail`) + opaque provider references are
  persisted; raw Aadhaar / biometrics never touch our DB. Any stored face
  baseline reference is field-encrypted (AES-256-GCM).
- **Legacy fallback** (Task 7): users with no onboarding baseline ENROLL their
  fresh liveness capture as the baseline on the first cycle, then MATCH every
  subsequent month — **no user is ever locked out for lacking a legacy baseline**.
- **Config**: `REKYC_METHOD` (`aadhaar_otp` | `face_match` | `aadhaar_otp+face`,
  default `aadhaar_otp`) and `REKYC_FACE_MATCH_THRESHOLD`. Migration:
  `20260628010000_add_rekyc_gate` (additive: `User.reKycRequired/lastReKycAt/
  reKycDueAt` + `ReKycLog`).

### Manual test matrix

1. **No-store present** — `curl -sI https://<host>/api/wallet -H "Cookie: <auth>"`
   and `curl -sI https://<host>/dashboard` → both must show
   `Cache-Control: no-store, no-cache, must-revalidate, private`.
2. **Fake static under an authed path** — request
   `https://<host>/dashboard/account.css` → must NOT be cached and must NOT
   return account data (404 / no-store HTML); the `.css` matcher exclusion only
   applies to real `/_next/static` assets, and nginx only caches `/_next/static/`.
3. **Back button after logout** — log in, log out, press Back → no account data
   is shown (no-store + `tokenVersion` bump means the cookie is dead server-side).
4. **Payout replay** — capture a payout `POST` and resend it: the second attempt
   returns the original result (same `Idempotency-Key`) and the one-time
   `x-submit-nonce` is already consumed → no double-spend.
5. **Tampered body** — add `fee`, `role`, `balance`, or an inflated
   `serviceCharge` to a payout/recharge body → rejected by `.strict()` Zod, and
   amounts/fees/GST are recomputed server-side regardless.
6. **Re-KYC gate** — set a network user's `reKycRequired=true`
   (`UPDATE "User" SET "reKycRequired"=true WHERE id='…';`): payout/fund-request
   `POST` returns **403 `REKYC_REQUIRED`**; complete `/dashboard/rekyc` (dev OTP
   `123456` when the eKYC Hub is unconfigured) → flag clears, `reKycDueAt` moves
   to the 1st of next month, and transactions succeed again. Confirm an ADMIN /
   SUPPORT / MASTER_ADMIN user is **never** flagged by the sweep or gated.
7. **Liveness gate** — a network user with `hasLivenessVideo=false`
   (`UPDATE "User" SET "hasLivenessVideo"=false WHERE id='…';`): any money route
   (payout/fund-request create+approve, recharge, BBPS, DMT, AePS, PAN, UPI
   collect) `POST` returns **403 `LIVENESS_REQUIRED`** and the dashboard shows a
   blocking modal routing to `/dashboard/liveness`. Record a video → object lands
   in the private S3 bucket → `KycVideo` row (status `UPLOADED`) → worker reaches
   `BASELINE_READY` → `hasLivenessVideo=true` → transactions succeed. Confirm an
   ADMIN / SUPPORT / MASTER_ADMIN user is **never** prompted or gated.

Quick header check (PowerShell):

```powershell
curl.exe -sI https://api.paybridgex.in/api/healthz | Select-String -Pattern "cache-control"
```

---

## Biometric Liveness Video (Phase 14)

The onboarding liveness video is **sensitive biometric personal data**. It is
handled under the principles of the **Digital Personal Data Protection Act, 2023
(DPDP)** and **RBI KYC / Master Directions** (purpose limitation, storage
limitation, security safeguards, and auditable access).

### Data handling

- **Consent**: capture requires explicit, affirmative consent (`consent: true`
  at `/api/kyc/video/initiate`, surfaced as a checkbox in the UI). The consent
  timestamp is persisted as `KycVideo.consentAt`. No video is recorded or stored
  without it.
- **Storage**: video bytes live ONLY in a private S3 bucket — **never** in
  Postgres and **never** in Cloudinary. Required bucket configuration:
  - Block Public Access **ON** (account + bucket level).
  - Default **SSE-KMS** encryption (customer-managed key `S3_KMS_KEY_ID`).
  - **Versioning ON** (tamper/restore protection).
  - A **TLS-only** bucket policy (deny `aws:SecureTransport=false`); recommended
    companion policy denying unencrypted PUTs.
- **Object keys**: `kyc-videos/{userId}/{uuid}.mp4`. The key is **field-encrypted**
  (`KycVideo.storageKeyEnc`, AES-256-GCM) at rest; a `sha256` of the bytes is kept
  for integrity. The eKYC Hub face-baseline reference is field-encrypted too
  (`faceBaselineRefEnc`). Raw biometrics never transit our DB.
- **No public URLs, ever.** Uploads use a 120s presigned PUT; downloads use a
  ≤60s presigned GET generated server-side **only** for ADMIN / MASTER_ADMIN.
- **Audited access**: every admin view writes an `AuditLog`
  (`kyc.video.admin_viewed`, severity `warn`) recording **who** (admin id),
  **why** (a mandatory free-text reason), **when**, and **whose** video. The
  capture lifecycle is audited too (`kyc.video.uploaded`,
  `kyc.video.baseline_ready`, `kyc.video.baseline_failed`).
- **Credentials**: production uses the **EC2 IAM instance role** (no static keys).
  `s3:PutObject` / `s3:GetObject` on the bucket and `kms:Encrypt` /
  `kms:Decrypt` / `kms:GenerateDataKey` on the key. Static
  `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` are a local/dev fallback only.

### Retention policy

- Retain the video and its baseline **while the account is ACTIVE** plus a
  defined buffer (default **24 months** after closure, configurable) to satisfy
  RBI record-retention expectations and to support the monthly face match.
- On account closure (`UserStatus.CLOSED`) + buffer expiry, a purge job deletes
  the S3 object (`deleteKycVideoObject`) and nulls `storageKeyEnc` /
  `faceBaselineRefEnc`. The `KycVideo` row may be retained as a (non-biometric)
  audit stub or hard-deleted per the data-retention schedule.
- A `FAILED` baseline (no usable face) re-blocks the user and prompts a
  re-capture; the rejected object is overwritten on the next successful upload.

### Abuse / spoofing controls

- A **random liveness prompt** ("blink twice", "turn head left", "say today's
  date") is issued per attempt to deter replaying a pre-recorded clip; the eKYC
  Hub face check is the authoritative liveness/identity signal.
- All video endpoints are **rate-limited** (per user AND per IP) and
  **idempotent**. A signed **upload token** binds `/complete` to the exact object
  key presigned for that user, and the key is validated to belong to the caller.
- Content-type is pinned on the presigned PUT and re-validated on HEAD; oversized
  objects (> `KYC_VIDEO_MAX_BYTES`, default 15 MiB) and over-length videos
  (> `KYC_VIDEO_MAX_DURATION_SEC`, default 12s, authoritatively via ffprobe) are
  rejected and purged.

---

## Deployment Security Notes

- **EC2 / BulkPe**: an Elastic IP is required so the egress IP is stable and can be
  whitelisted in the BulkPe dashboard (BulkPe rejects non-whitelisted source IPs).
  See `docs/PAYOUT.md`.
- **Secrets**: currently loaded from environment variables (PM2 / `ecosystem.config.js`).
  Migration to AWS Secrets Manager / SSM Parameter Store is recommended for
  production hardening (rotation, audit trail, no plaintext on disk).
- **WAF / DDoS**: recommend Cloudflare in front of the EC2 origin for L7 DDoS
  protection and to complement the in-app DB-backed rate limiter.
- **CSP**: a per-request nonce-based Content-Security-Policy is implemented in
  `src/middleware.ts` (drops `script-src 'unsafe-inline'`); see that file.
- **Proxy hops**: `TRUSTED_PROXY_HOPS` (default `1`) controls how many trusted
  reverse-proxy hops sit in front of the app for safe client-IP resolution. Bump
  to `2` if a CDN (e.g. Cloudflare) is placed in front of nginx.
