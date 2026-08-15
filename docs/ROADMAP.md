# Paybridgex — Build Roadmap

A compact summary of the 11 delivery phases (0–10). All phases are **COMPLETE**
and production-ready. Each phase built on the Phase 0 primitives — money math,
ledger, encryption, idempotency, rate limiting, the queue worker, and the partner
factory — which the later phases reuse rather than re-implement.

---

### Phase 0 — Foundation · COMPLETE
The money-safe core. Decimal money math (`src/lib/money.ts`), the atomic
row-locked idempotent ledger (`src/lib/ledger.ts`, spendable = walletBalance −
heldBalance with holds/captures), AES-256-GCM field encryption
(`src/lib/crypto/fieldEncryption.ts`), IDOR/ownership guards
(`src/lib/security/ownership.ts`), DB-backed rate limiting, API idempotency, the
pg-boss queue worker, NextAuth auth + role nav, and the lazy Prisma client.
Migration: `20260627000000_phase0_foundation`.

### Phase 1 — Wallet & Fund Requests · COMPLETE
Self-service wallet (balance, transactions) and the maker→approver fund-request
flow. Approvals move money atomically through the ledger with deterministic
idempotency keys; submissions are rate-limited and audited.

### Phase 2 — Hierarchy & Onboarding · COMPLETE
Multi-level distribution tree (RETAILER → DISTRIBUTOR → MASTER_DISTRIBUTOR →
SUPER_DISTRIBUTOR) with recursive-CTE downline scoping, token-based invite
onboarding, and `canOnboard` role gating. Migration:
`20260627170000_add_super_distributor`.

### Phase 3 — KYC & Verification · COMPLETE
KYC submission/review queue, document uploads (Cloudinary signed), and live
PAN/Aadhaar/bank/GST verification via the eKYC Hub partner adapter, gated by the
service catalog.

### Phase 4 — Service Rails & Partner Factory · COMPLETE
Partner-agnostic adapter registry (`src/lib/partners/`) with per-vertical feature
flags, the On/Off Services catalog (`ServiceRoute` + `assertServiceEnabled` admin
kill-switch), and the money-safe transaction orchestrator
(`src/lib/services/transaction.ts`) powering AePS, DMT, recharge, BBPS, PAN, UPI
collect, and travel.

### Phase 5 — Payouts (BulkPe) · COMPLETE
Bank/UPI disbursals on BulkPe with maker-checker approval, fund holds, the PM2
worker performing the IP-whitelisted external call, idempotent `reference_id`,
HMAC webhook verification, and a polling reconciler (`/fetchStatus`) for stuck
payouts. Live vendor float surfaces on the admin dashboard via `fetchBalance`.
Migration: `20260627120000_add_payout_request`. See `docs/PAYOUT.md`.

### Phase 6 — Scheme & Commission Manager · COMPLETE
Scheme-based pricing with slabs, per-user assignment, and a scheme-aware resolver
(`getEffectiveRate` / `quotePayoutForUser`) so the UI preview matches the
server-enforced quote, falling back to static SLABS. Migration:
`20260627130000_add_scheme_manager`.

### Phase 7 — POS Terminals · COMPLETE
Same Day Solution POS fleet onboarding, machine assignment with ownership
scoping, terminal-scoped transaction queries, and async CSV/PDF export via the
queue worker. Migration: `20260627140000_add_pos_machine`.

### Phase 8 — Reports & Analytics · COMPLETE
Role-scoped report registry (`src/lib/reports/`) with CSV/PDF export, downline
scoping via `getDescendantIds`, export audit logging, and the admin dashboard
KPIs (GMV, payout success rate, vendor balances, service health).

### Phase 9 — Security Hardening · COMPLETE
Account lockout with backoff, HIBP breached-password rejection, step-up 2FA on
sensitive actions, Cloudflare Turnstile CAPTCHA, login anomaly detection
(impossible travel / new device / repeated failures), structured redacting
logger, security headers (HSTS/CSP/etc.), and this `docs/SECURITY.md` 6-goal
mapping + route guard audit. Migration: `20260627160000_security_hardening`.

### Phase 10 — CMS Sliders & Admin Console · COMPLETE
Audience-targeted promotional sliders (active-window + role filter), admin CRUD
with Cloudinary uploads, and the consolidated admin console (users, sub-admins,
admins, schemes, services, commissions, settlements, audit). Migration:
`20260627150000_add_slider`.

### Phase 13 — Monthly Re-KYC Gate · COMPLETE
Network users (RETAILER / DISTRIBUTOR / MASTER_DISTRIBUTOR / SUPER_DISTRIBUTOR)
must re-verify identity on the 1st of every month before they can transact;
staff/admin roles are exempt (`NETWORK_TIERS` from `src/lib/hierarchy.ts` is the
source of truth). A pg-boss scheduled job `rekyc.monthly` (cron `0 0 1 * *`,
Asia/Kolkata) batches `reKycRequired=true` onto every ACTIVE network user
(`src/lib/rekyc/sweep.ts`, idempotent). `assertKycCurrent()`
(`src/lib/security/kycGate.ts`) throws a typed 403 `REKYC_REQUIRED` before any
ledger op in payout (quote/create/approve) and fund-request (create/approve).
The flow (`/api/rekyc/initiate|verify|status`, `/dashboard/rekyc`) reuses the
eKYC Hub for Aadhaar OTP eKYC (+ optional liveness face match vs. the onboarding
baseline), with rate-limiting, idempotency, step-up 2FA, field-encrypted PII and
a full `ReKycLog` audit trail. First-cycle users with no baseline ENROLL on their
first check instead of matching (no one is locked out for lacking a legacy
baseline). Configurable via `REKYC_METHOD`. Migration:
`20260628010000_add_rekyc_gate`.

### Phase 14 — Onboarding Liveness Video + Face Baseline · COMPLETE
Every NETWORK user (RT/DT/MD/SD) records a one-time ~10-second liveness video at
onboarding; a face frame extracted from it becomes the baseline that Phase 13's
monthly face match compares against. Staff/admin are exempt (`NETWORK_TIERS` is
the source of truth).

- **Private S3 storage** (`src/lib/storage/s3Kyc.ts`): video bytes live ONLY in a
  private bucket (Block Public Access, default SSE-KMS, versioning, TLS-only
  policy) — never in Postgres. The browser uploads directly via a 120s presigned
  PUT (content-type pinned); the app stores only a field-encrypted S3 key +
  sha256. Admin downloads use a ≤60s presigned GET and are always audited
  (`/api/admin/kyc/video/[userId]`, requires a reason).
- **Schema**: `KycVideo` (encrypted `storageKeyEnc` / `faceBaselineRefEnc`,
  `sha256`, status `UPLOADED|BASELINE_READY|FAILED`, `consentAt`) + `User.hasLivenessVideo`.
  Migration: `20260628020000_add_kyc_video`.
- **Capture API**: `/api/kyc/video/initiate` (consent required, presigned PUT +
  random liveness prompt + signed upload token, rate-limited + idempotent) and
  `/api/kyc/video/complete` (HEAD verify type/size, sha256, persist, flip
  `hasLivenessVideo=true`, enqueue baseline). The heavy ffmpeg frame extraction +
  eKYC Hub `faceRegister` runs in the PM2 worker (`kyc.video.baseline`); no face
  detected → status `FAILED` + re-block + re-capture prompt.
- **Transaction gate**: `assertLivenessReady()` (`src/lib/security/livenessGate.ts`)
  throws a typed 403 `LIVENESS_REQUIRED` before any ledger op on payout, fund-request
  (create + approve), recharge, BBPS, DMT, AePS, PAN and UPI collect.
- **Frontend**: camera capture with a 10s countdown + on-screen prompt
  (`LivenessVideoCapture`), a `/dashboard/liveness` screen, and a blocking
  `LivenessGate` modal for upline-onboarded users (network tiers only; staff never
  see it). Self-registrants and upline-onboarded users are both created with
  `hasLivenessVideo=false` and gated until capture.

---

## Future Work

These are recommended next hardening / feature steps, not blockers for launch:

- **Nonce-based CSP** — replace the static Content-Security-Policy with a
  per-request nonce on inline scripts.
- **AWS Secrets Manager / SSM** — move secrets off PM2 environment variables for
  rotation and an access audit trail.
- **BulkPe account statement integration** — wire `/client/accountStatement` for
  automated vendor-side reconciliation.
- **Dedicated QR collections data model** — first-class persistence for static /
  dynamic UPI QR collections (currently handled through the generic UPI rail).
- **Defense-in-depth rate limits** — layer `RATE_LIMITS.sensitiveWrite` onto
  admin config mutations.
