# Go-Live Checklist — what YOU need to do

All five build phases are code-complete, tested (121/121) and migrated. What
remains is credentials, infrastructure and a handful of business decisions —
things only you (the operator) can do. Work top to bottom; each section says
why it matters and exactly which env keys or dashboards are involved.

---

## 1. Rotate and harden secrets (do this FIRST)

Your current `.env` contains real credentials (Supabase password, Twilio auth
token, eKYC Hub token, Resend key). Before anything else:

- [ ] Confirm `.env` is in `.gitignore` and has never been committed. If it
      ever leaked into git history or a chat/screenshot, **rotate those keys**.
- [ ] Generate fresh production values (do not reuse dev values):
      `NEXTAUTH_SECRET`, `JWT_SECRET`, `APP_ENCRYPTION_KEY` — 32+ chars each
      (`openssl rand -base64 32`).
      ⚠️ `APP_ENCRYPTION_KEY` encrypts PII at rest (account numbers, S3 keys,
      baselines). Once production data exists it can NEVER be casually rotated
      — pick the final value now and store it in a vault.
- [ ] Create a **separate production database** (new Supabase project or RDS).
      Don't point production at the current dev DB. Run
      `npx prisma migrate deploy` against it (all 19 migrations apply cleanly).
- [ ] Set `NODE_ENV="production"`, `NEXT_PUBLIC_APP_URL` and `NEXTAUTH_URL`
      to your real domain (e.g. `https://nxtgpay.com`).
- [ ] Set `ALERT_WEBHOOK_URL` (Slack/Google Chat/Discord webhook). Without it,
      ledger-mismatch and AML alerts land only in logs that nobody watches.

The worker audits all of this at startup (`productionSecretIssues`) and will
ops-alert anything weak — but don't wait for it to tell you.

## 2. Partner credentials (the rails are built; they need keys)

Each rail is dark until its flag is on AND its credentials are set:

| Rail | Env keys | Also required |
|---|---|---|
| Payouts (BulkPe) | `BULKPE_TOKEN`, `BULKPE_WEBHOOK_SECRET`, `PARTNER_PAYOUT_ENABLED=true` | Whitelist your server's static IP with BulkPe; register webhook URL `https://<domain>/api/payout/webhook` |
| Wallet top-up / UPI (BulkPe Simple PG) | same token, `PARTNER_UPI_ENABLED=true` | Register PG webhook `https://<domain>/api/webhooks/bulkpe-pg` |
| BBPS credit-card bills (Same Day Pay2New) | `SAMEDAY_BBPS_API_KEY`, `SAMEDAY_BBPS_API_SECRET`, `PARTNER_BBPS_ENABLED=true` | IP whitelist with Same Day |
| Settlement (Same Day) | `SAMEDAY_SETTLEMENT_API_KEY`, `SAMEDAY_SETTLEMENT_API_SECRET`, `PARTNER_SETTLEMENT_ENABLED=true` | Add + penny-verify a bank account in Dashboard → Settlements → Bank transfers |
| eSign agreements (Leegality) | `LEEGALITY_AUTH_TOKEN`, `LEEGALITY_PROFILE_ID`, `LEEGALITY_BASE_URL=https://app1.leegality.com/api`, `PARTNER_ESIGN_ENABLED=true` | Register webhook `https://<domain>/api/webhooks/leegality` |
| POS (Same Day) | `SAMEDAY_POS_API_KEY`, `SAMEDAY_POS_API_SECRET`, `PARTNER_POS_ENABLED=true` | — |
| KYC video storage | `S3_KYC_BUCKET`, `S3_KMS_KEY_ID`, `AWS_REGION` | Private S3 bucket: Block Public Access ON, SSE-KMS, versioning, TLS-only policy; prefer an EC2 IAM role over access keys |
| Verification (eKYC Hub) | already set ✔ | move to a production account/token if the current one is sandbox |
| OTP (Twilio Verify) | already set ✔ | confirm sender/DLT compliance for India traffic at volume |
| Email (Resend) | already set ✔ | verify the `nxtgpay.com` domain (SPF/DKIM) in Resend |

Sandbox first: run each rail against the partner's sandbox, then flip base
URLs/keys to production. Do a ₹10 "penny test" per rail on day one.

## 3. Infrastructure

- [ ] **Server**: EC2 (or similar) with a **static Elastic IP** — BulkPe and
      Same Day authorize by IP. Install Node 20+, nginx (TLS via certbot),
      `ffmpeg` (`apt install ffmpeg` — required by the KYC video pipeline).
- [ ] **Two processes under PM2**: the Next.js app AND the worker
      (`npm run worker`). ⚠️ The worker is not optional — payouts, webhooks,
      reconciliation, re-KYC, dispute SLAs, settlement autosweep, AML sweeps,
      audit anchoring and video purging all run there.
- [ ] Set `TRUSTED_PROXY_HOPS` (1 for nginx alone, 2 if Cloudflare in front).
- [ ] DNS: apex + `www` → server. For white-label subdomains add a wildcard
      record (`*.nxtgpay.com`) and a wildcard/SAN certificate.
- [ ] Database: enable automated backups / PITR on the production DB. pg-boss
      creates its own `pgboss` schema on first worker start — no action needed.
- [ ] Optional but recommended: `SENTRY_DSN` for error tracking,
      `SECURITY_CAPTCHA_ENABLED=true` + Turnstile keys for login/register.

## 4. Operational decisions (defaults are safe; decide when ready)

- [ ] **Settlement autosweep** — off by default. To enable: verify a bank
      account (Dashboard → Settlements), put its id in
      `SETTLEMENT_AUTOSWEEP_ACCOUNT_ID`, set `SETTLEMENT_AUTOSWEEP_ENABLED=true`
      and choose `KEEP_BALANCE` (float to leave in the partner wallet).
- [ ] **KYC-video retention purger** — off by default (destructive). Enable
      with `KYC_VIDEO_RETENTION_ENABLED=true` once you're comfortable;
      default window 180 days.
- [ ] **Risk & AML thresholds** — review `RISK_*` and `AML_*` defaults
      (daily cap ₹5L, CTR line ₹10L, structuring line ₹50k…) against your
      actual agent profile after the first weeks of data.
- [ ] **Step-up 2FA** — `SECURITY_STEPUP_ENABLED` is off; turn on after
      admins have enrolled 2FA.

## 5. Seed the business

- [ ] Create the MASTER_ADMIN account, then set up commission schemes
      (Scheme Manager), service toggles (On/Off Services) and slab charges
      before onboarding the first agent.
- [ ] Onboard one friendly retailer end-to-end: invite → Aadhaar/PAN KYC →
      liveness video → declaration + Leegality eSign → first top-up → first
      transaction. This exercises every gate in order.
- [ ] White-label / API partners: issue API keys from Dashboard → API Keys
      (they'll need the one-time secret and your API docs), and have them
      register webhook endpoints there too.

## 6. Compliance & legal (outside the codebase)

- [ ] Execute agreements with BulkPe / Same Day / Leegality for production.
- [ ] If operating under PMLA reporting obligations, register with FIU-IND;
      the STR worksheet / CTR CSV exports (Dashboard → AML Monitoring) are
      built to feed those filings.
- [ ] Publish real Privacy Policy / Terms / Refunds content (the `/legal/*`
      pages exist — review their text with counsel, esp. biometric consent
      and the DPDP retention story, which the purger implements).

## 7. Launch-day verification (30 minutes)

1. `npx prisma migrate status` → "up to date" against prod DB.
2. Both PM2 processes green; worker log shows
   `ready · handlers: … aml.sweep … audit.anchor … kyc.video.retention`.
3. No "SECRETS WARNING" in the worker startup log.
4. Login, wallet top-up ₹10, payout ₹10 (approve via maker-checker), BBPS
   bill fetch — one pass each.
5. Trigger a test ops alert (temporarily set a bogus `SETTLEMENT_AUTOSWEEP_ACCOUNT_ID`
   and run the sweep, or just verify the webhook URL with curl) — confirm it
   reaches your Slack channel.
6. Next morning: check Dashboard → AML Monitoring shows the first audit
   anchor (created 00:20 IST) and Verify returns green.
