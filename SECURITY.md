# Paybridgex — Security Controls

This document maps each of the six security goals to the concrete controls
implemented in this codebase, lists the primitives, and provides the API route
guard checklist. It is the single reference for "how is X protected and where".

> TL;DR for reviewers: auth/abuse controls live in `src/lib/security/*`,
> the per-request CSP nonce + request-size limit live in `src/middleware.ts`,
> and every privileged action is recorded via `logSecurityEvent` → `AuditLog`
> (surfaced in **Dashboard → Admin → Audit log**, filter = "Security events").

---

## Goal → Control mapping

### 1. Stop account takeover
| Control | Where |
| --- | --- |
| Account lockout with **exponential backoff** keyed on the login identifier (5 strikes → 30s lock, doubling up to 1h) | `src/lib/security/lockout.ts`, wired in `src/app/api/auth/login/route.ts` and the NextAuth `credentials` provider (`src/lib/auth-server.ts`) |
| Per-IP **and** per-identifier rate limiting on login | `RATE_LIMITS.login` in `src/lib/security/rateLimit.ts` |
| Mandatory **2FA (TOTP)** for all users; backup codes; temp-token challenge | `src/lib/two-factor.ts`, `src/app/api/auth/2fa/*` |
| **Step-up 2FA** re-verification on sensitive actions (payout approve/reject, scheme change/delete, AePS withdrawal) | `src/lib/security/stepUp.ts` (flag `SECURITY_STEPUP_ENABLED`) |
| **Breached-password** rejection at signup (HIBP k-anonymity) | `src/lib/security/breachedPassword.ts` |
| **Login-anomaly detection**: impossible travel (haversine vs `lastLoginLat/Lng/At`), new-device fingerprint, repeated-failure context | `src/lib/security/audit.ts` → `detectLoginAnomalies` |
| `bcrypt` cost 12 for password hashing | `src/app/api/auth/register/route.ts` |

### 2. Protect data access (authorization)
| Control | Where |
| --- | --- |
| Object-level authorization (anti-IDOR/BOLA): owner / downline / admin checks | `src/lib/security/ownership.ts` → `assertOwner`, `assertCanAccessUser`, `scopeUserIdFilter`, `getDescendantIds` |
| Role-based access (RBAC) on admin surfaces | `requireRole(...)` in `src/lib/auth-server.ts`; route-prefix gate in `src/middleware.ts` |
| Maker-checker separation on payouts | `src/app/api/payout/[id]/route.ts` |
| **PII encrypted at rest** (AES-256-GCM): bank account/IFSC, TOTP secret | `src/lib/crypto.ts`, `src/lib/crypto/fieldEncryption.ts` |
| Signed Cloudinary delivery for KYC docs (never public) | `src/lib/cloudinary.ts`, `Document.isSensitive` |

### 3. Prevent credential theft
| Control | Where |
| --- | --- |
| **Nonce-based CSP** — dropped `script-src 'unsafe-inline'`; per-request nonce | `src/middleware.ts` (`buildCsp`), `next.config.mjs` (static CSP removed) |
| `HSTS` (2y, preload, subdomains), `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `upgrade-insecure-requests` | `next.config.mjs` + CSP in middleware |
| Secrets pulled from **AWS SSM / Secrets Manager** at deploy — never in git or the AMI | `deploy/load-secrets.sh`, `deploy/setup-ec2.sh`; `.gitignore` excludes `.env*` |
| Constant-time HMAC comparison for session-grant / temp / mobile tokens | `src/lib/auth-server.ts`, `src/lib/two-factor.ts` |
| Structured logger **redacts** passwords/tokens/secrets/PII | `src/lib/logger.ts` |

### 4. Own-data-only access
| Control | Where |
| --- | --- |
| List endpoints scoped to self + downline (or all, for admins) | `scopeUserIdFilter` usage across list routes |
| Detail/mutation endpoints assert access to the specific resource owner | `assertCanAccessUser` (e.g. `src/app/api/payout/[id]/route.ts`, `fund-request/[id]`) |
| Every privileged mutation writes an `AuditLog` row | routes + `logSecurityEvent` |

### 5. Stop bot spam / overload
| Control | Where |
| --- | --- |
| **CAPTCHA (Cloudflare Turnstile)** on login, register, OTP-send (server-verified) | `src/lib/security/captcha.ts`, client `src/components/security/Turnstile.tsx`, flag `SECURITY_CAPTCHA_ENABLED` |
| DB-backed **rate limits** per route/IP/identifier/user (shared across PM2) | `src/lib/security/rateLimit.ts` (`RATE_LIMITS`) |
| **Request body size limit** (default 1 MiB) on all mutating API calls | `src/middleware.ts` (413 on oversize) |
| OTP-bombing guard: per-target **and** per-IP throttle; CSPRNG OTP | `src/app/api/auth/otp/send/route.ts` |
| Account lockout (also a brute-force/credential-stuffing control) | `src/lib/security/lockout.ts` |
| **Cloudflare / AWS WAF in front of EC2** (recommended edge layer) | see *Network edge* below |

### 6. Protect data in transit + detect anomalies
| Control | Where |
| --- | --- |
| TLS everywhere; `HSTS` + `upgrade-insecure-requests` | `next.config.mjs`, Nginx (`deploy/nginx-paybridgex.conf`) |
| Secure session cookies (NextAuth `__Secure-`/`httpOnly`/`sameSite` in prod over HTTPS) | NextAuth defaults under HTTPS; JWT session strategy |
| **Structured security logging** (pino JSON → stdout → CloudWatch/SIEM) | `src/lib/logger.ts`, `src/lib/security/audit.ts` |
| **Anomaly flags surfaced to admins** (impossible-travel / new-device / repeated-failures) | `src/app/api/admin/audit/route.ts`, `src/app/dashboard/admin/audit/page.tsx` |

---

## Network edge (operations)

Put a managed edge in front of the EC2 origin and never expose Node directly:

- **Cloudflare** (proxy/orange-cloud) **or AWS CloudFront + AWS WAF**:
  - Managed rule sets (OWASP core), rate-based rules, bot management.
  - Turnstile is issued/validated by Cloudflare; siteverify runs server-side.
- **Nginx** terminates/forwards TLS to `127.0.0.1:3000`; security group allows
  inbound 80/443 only from the edge, and `:3000` only from localhost.
- Egress to BulkPe is from a **static Elastic IP** (IP-allowlisted) — see
  `docs/PAYOUT.md`.

## Secrets management (operations)

- Prod secrets live in **AWS SSM Parameter Store (SecureString)** or **Secrets
  Manager**; the EC2 **instance role** grants read + `kms:Decrypt` (no static
  AWS keys on the box).
- `deploy/load-secrets.sh` writes a root-only (`chmod 600`) `.env.production`
  at deploy time. `APP_ENCRYPTION_KEY`, `NEXTAUTH_SECRET`, `JWT_SECRET`,
  `BULKPE_*` are **never** committed (verified: only `.env.example` is tracked).
- Rotate `APP_ENCRYPTION_KEY` carefully — it decrypts PII at rest (envelope/
  re-encrypt migration required; do not rotate blindly).

## Configuration flags (see `.env.example`)

| Flag | Default | Effect |
| --- | --- | --- |
| `SECURITY_CAPTCHA_ENABLED` | `false` | Require Turnstile on login/register/OTP (needs `TURNSTILE_SECRET_KEY` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY`) |
| `SECURITY_HIBP_ENABLED` | `true` | Reject breached passwords at signup |
| `SECURITY_STEPUP_ENABLED` | `false` | Require fresh 2FA on payout approve / scheme change / withdrawal |
| `SECURITY_MAX_BODY_BYTES` | `1048576` | Max API request body size |

> Roll-out note: `SECURITY_STEPUP_ENABLED` is off by default. The server-side
> enforcement is wired in; enable it once the client step-up prompt (sending
> `x-2fa-code` / `stepUpCode`) is attached to the payout-approval, scheme and
> withdrawal UIs.

---

## API route guard checklist

Legend: **Auth** = `requireAuth`/`requireRole` (or public-by-design);
**Scope** = object-level/ownership or role gate; **Zod** = input validation;
**RL** = rate limited; **Audit** = writes `AuditLog`.

### Authentication & onboarding (intentionally unauthenticated)
| Route · method | Auth | Scope | Zod | RL | Audit | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/auth/login` POST | public | — | ✅ | ✅ ip+id | ✅ | OK (lockout + CAPTCHA + anomaly) |
| `/api/auth/register` POST | public | — | ✅ | ✅ ip | ✅ | OK (HIBP + CAPTCHA) |
| `/api/auth/otp/send` POST | public | — | ✅ | ✅ target+ip | — | OK (CAPTCHA + OTP-bomb guard) |
| `/api/auth/otp/verify` POST | public | OTP hash + attempts | ✅ | (attempts) | — | PUBLIC-OK |
| `/api/auth/2fa/verify` POST | temp-token | per-token attempts | ✅ | ✅ ip | ✅ | OK |
| `/api/auth/2fa/verify-session` POST | temp-token | per-token attempts | ✅ | ✅ ip | ✅ | OK |
| `/api/auth/2fa/setup`/`confirm` POST | session | self | ✅ | — | ✅ | OK |
| `/api/auth/[...nextauth]` | NextAuth | — | — | — | — | PUBLIC-OK |
| `/api/onboard/[token]*` | invite token | token scope | ✅ | — | — | PUBLIC-OK (token-bound) |
| `/api/healthz` GET | public | — | — | — | — | PUBLIC-OK |

### Webhooks (signature-authenticated)
| Route · method | Auth | Verdict |
| --- | --- | --- |
| `/api/payout/webhook` POST | HMAC (BulkPe) verified on raw body | PUBLIC-OK |
| `/api/webhooks/razorpay` POST | HMAC verified | PUBLIC-OK (verify signature present) |

### Money-moving / services (require auth; step-up on withdrawals)
| Route · method | Auth | Scope | Zod | RL | Audit | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/payout` POST | ✅ | self (owner) | ✅ | ✅ | ✅ | OK |
| `/api/payout/[id]` GET/PATCH | ✅ | `assertCanAccessUser` + maker-checker | ✅ | — | ✅ | OK (+ step-up on PATCH) |
| `/api/payout/quote` POST | ✅ | self | ✅ | — | — | OK |
| `/api/services/aeps/withdraw` POST | ✅ | self | ✅ | ✅ txn | ✅(txn) | OK (+ step-up) |
| `/api/services/dmt/transfer` POST | ✅ | self | ✅ | ✅ | ✅(txn) | OK |
| `/api/services/bbps/pay` POST | ✅ | self | ✅ | ✅ | ✅(txn) | OK |
| `/api/services/recharge` POST | ✅ | self | ✅ | ✅ | ✅(txn) | OK |
| `/api/services/pan/apply` POST | ✅ | self | ✅ | ✅ | ✅ | OK |
| `/api/services/bbps/fetch` POST | ✅ | self | ✅ | — | — | OK |
| `/api/services/upi/collect` POST | ✅ | self | ✅ | — | — | OK |
| `/api/services/travel/search` POST | ✅ | self | ✅ | ✅ | — | **FIXED** (was public) |
| `/api/fund-request` GET/POST | ✅ | `scopeUserIdFilter` | ✅ | ✅ | ✅ | OK |
| `/api/fund-request/[id]` PATCH | ✅ | ownership/approver | ✅ | — | ✅ | OK |
| `/api/wallet` / `/api/wallet/transactions` GET | ✅ | self | — | — | — | OK |

### Admin / config (RBAC; step-up on scheme writes)
| Route · method | Auth | Scope | Verdict |
| --- | --- | --- | --- |
| `/api/admin/schemes` (+`/[id]`, `/slabs`, `/assign`) | `requireRole` | admin | OK (+ step-up + RL on `/[id]` PATCH/DELETE) |
| `/api/admin/users` (+`/[id]`) | `requireRole` | admin | OK |
| `/api/admin/admins`/`sub-admins` (+`/[id]`) | `requireRole` | admin/master | OK |
| `/api/admin/commissions` (+`/[id]`) | `requireRole` | admin | OK |
| `/api/admin/pos/machines` (+`/assign`,`/sync`) | `requireRole` | admin | OK |
| `/api/admin/services` (+`/[id]`) | `requireRole` | admin | OK |
| `/api/admin/sliders` (+`/[id]`,`/upload`) | `requireRole` | admin | OK |
| `/api/admin/invite` (+`/[id]`) | `requireRole` | admin | OK |
| `/api/admin/billers` / `settlements` / `stats` / `audit` | `requireRole` | admin | OK |
| `/api/kyc` / `kyc/queue` / `kyc/[id]` | ✅ / `requireRole` | self / admin | OK |
| `/api/network` (+`/onboard`) | ✅ | downline scope | OK |
| `/api/pos/*` (my-machines, transactions, export, machines) | ✅ | self/assignment | OK |
| `/api/documents` / `/api/uploads/sign` | ✅ | self | OK |
| `/api/dashboard/performance` | ✅ | self/scope | OK |

### POS partner-proxy routes (ownership now enforced)
The SameDay POS partner account is tenant-wide, so these proxies previously
returned the whole fleet/transaction set to any logged-in user. Fixed by scoping
to terminals assigned to the caller (`scopePosTerminals` in `src/lib/pos/assignments.ts`):
| Route · method | Fix |
| --- | --- |
| `/api/pos/machines` GET | Now **admin-only** (`requireRole`) — raw fleet feed. Users use `/api/pos/my-machines` (already `scopeUserIdFilter`-scoped). |
| `/api/pos/transactions` POST | Non-admins constrained to owned `terminal_id`s (403 on others; 400 if multiple and none chosen) + rate limit. |
| `/api/pos/export` POST | Same terminal-ownership constraint; records job ownership in `AuditLog`. |
| `/api/pos/export-status/[jobId]` GET | Non-admins may only poll a job they created (verified against the `pos.export.create` audit row). Closes the job-id IDOR. |

### Flagged (legacy mock endpoints — gate or remove before prod)
| Route · method | Issue | Recommendation |
| --- | --- | --- |
| `/api/transactions` GET/POST | No auth; returns/echoes **mock** data (`@/lib/data`), no DB/money | Remove, or add `requireAuth` if still used by a widget |
| `/api/bills/fetch` POST | No auth; returns **mock** bill data | Remove, or add `requireAuth` + rate limit |

> The two flagged routes do not move money or read real user data (pure mocks),
> so they are not active IDOR vectors today — but they should be authenticated
> or deleted before production to avoid becoming abuse/enumeration surfaces.

### Open items requiring a product decision
| Item | Risk | Note |
| --- | --- | --- |
| `POST /api/auth/register` accepts `role: RETAILER \| DISTRIBUTOR \| MASTER_DISTRIBUTOR` | Self-provisioned elevated hierarchy role | The register UI intentionally offers these. New users are `PENDING_KYC` (no downline, no activation) until an admin approves, so impact is limited — but if elevated roles should be **invite-only**, force `RETAILER` here. *Left as-is pending product confirmation.* |
| `POST /api/admin/users`, `POST /api/admin/invite` accept arbitrary `parentId` | Admin overreach (not retailer IDOR) | An admin could attach a user outside their intended subtree. Admins are high-trust operators; add `assertCanAccessUser(parentId)` if subtree isolation between admins is required. |

---

## How to test (summary)

- `npx prisma validate` / `generate` — schema OK.
- `npx tsc --noEmit` — type-clean.
- `npx next lint` — no new lint errors.
- Lockout: POST `/api/auth/login` with a wrong password 5× for one identifier →
  6th returns `423 Locked` with `Retry-After`.
- HIBP: register with `Password123` → `400` "appeared in known data breaches".
- CAPTCHA: set `SECURITY_CAPTCHA_ENABLED=true` + keys → login/register require a
  Turnstile token (server `siteverify`).
- CSP: load any page → response has `Content-Security-Policy` with a fresh
  `nonce-…` and **no** `script-src 'unsafe-inline'`; check the browser console
  for violations.
- Step-up: set `SECURITY_STEPUP_ENABLED=true`, approve a payout without
  `x-2fa-code` → `401 STEP_UP_REQUIRED`.
- Anomaly: log in from coordinates far from the last login within minutes →
  the `auth.login` audit row is `danger` with `impossible-travel` flag in
  **Admin → Audit log → Security events**.
