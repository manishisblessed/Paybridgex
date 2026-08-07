# NextGenPay — Going to Production

This document covers everything you need to take NextGenPay from the current
prototype state to a live, money-moving, RBI-friendly product.

---

## 0. Honest current state

| Layer            | Status         | Notes                                      |
| ---------------- | -------------- | ------------------------------------------ |
| UI (web)         | ✅ Done        | All dashboards + landing                   |
| UI (mobile)      | ✅ Done        | Expo, biometric, all retailer services     |
| Auth             | ⚠️ Mocked      | Currently localStorage. **Not secure.**    |
| DB               | ⚠️ Mocked      | Hardcoded in `src/lib/data.ts`             |
| File storage     | ⚠️ Missing     | KYC docs not uploaded anywhere yet         |
| Real services    | ❌ Missing     | AePS / DMT / UPI / BBPS / IRCTC need APIs |
| Payments in/out  | ❌ Missing     | Need PG (Razorpay) + payout partner        |
| Compliance       | ❌ Pending     | PA-PG / AD-II / BBPS-AI applications       |

The scaffolding shipped in this repo (Prisma schema, Neon client, Cloudinary
helpers, NextAuth-ready models) is the foundation for everything below.

---

## 1. Neon Postgres (production database)

### 1.1 Create the project
1. Sign up at [console.neon.tech](https://console.neon.tech).
2. Click **New Project** → name it `nextgenpay-prod`.
   - Region: `aws-ap-south-1` (Mumbai) — lowest latency from India.
   - Postgres version: 16.
3. Inside the project create a database named `nextgenpay`.
4. Create **two branches**:
   - `main`  → production
   - `dev`   → development / staging (cheap, branched off main)

### 1.2 Get the connection strings
On the **Connection Details** panel toggle:
- **Pooled connection** → copy as `DATABASE_URL`
  (`...-pooler.aws.neon.tech/nextgenpay?sslmode=require`)
- **Direct connection** → copy as `DIRECT_URL`
  Used only by `prisma migrate`.

Paste both into `.env.local` (see `.env.example`).

### 1.3 Initialise schema
```bash
npm install
npm run db:generate     # generate Prisma Client
npm run db:migrate      # creates the migration + applies to dev branch
npm run db:seed         # inserts demo users (password Demo@1234)
npm run db:studio       # GUI at http://localhost:5555
```

For prod deployments use `npm run db:deploy` (no prompts, applies pending
migrations only).

### 1.4 Use it in the app
```ts
import { prisma } from "@/lib/db";

const txns = await prisma.transaction.findMany({
  where: { userId, status: "SUCCESS" },
  orderBy: { createdAt: "desc" },
  take: 50
});
```

The client uses `@neondatabase/serverless` over WebSockets so it works
inside Vercel Edge / serverless functions without exhausting connections.

### 1.5 Backups & branching strategy
- Neon snapshots automatically (PITR up to 7 days on Free, 30+ on Pro).
- Before risky migrations: `Branches → New branch from main` → migrate on
  branch first → promote.
- Schedule a monthly `pg_dump` to S3 / Cloudinary for offline backups.

---

## 2. Cloudinary (KYC docs, shop photos, logos)

### 2.1 Create the account
1. Sign up at [cloudinary.com](https://cloudinary.com).
2. Settings → **Upload presets** → Add:
   - `nextgenpay_kyc_signed` — Signed, type `private`, max 8 MB, allowed
     formats `jpg,jpeg,png,pdf,webp`, auto moderation off.
3. Settings → **Security**:
   - Restricted media types: `pdf`.
   - **Strict transformations**: ON.
   - **Allowed fetch domains**: `app.nxtgpay.com`, `nxtgpay.com`.
4. Settings → **API Keys** → copy `cloud_name`, `api_key`, `api_secret` into
   `.env.local`.

### 2.2 How uploads flow

**Recommended path (direct browser → Cloudinary):**

```
[Browser]
   │  POST /api/uploads/sign  { type: "AADHAAR_FRONT" }
   ▼
[Next.js API]  ── returns { cloudName, apiKey, timestamp, signature, folder }
   │
   ▼
[Browser]  POST file + signed params to
           https://api.cloudinary.com/v1_1/<cloud>/auto/upload
   │
   ▼
[Browser]  POST /api/documents  { publicId, url, ... }
   │
   ▼
[Next.js API → Neon]  insert into "Document"
```

This avoids re-uploading large files through your server.

**Server-side path** (for OCR pipelines or backend-generated PDFs) is in
`src/lib/cloudinary.ts → uploadToCloudinary()`.

### 2.3 Reading sensitive docs
KYC files are stored as `type=private`. To show them in the admin panel,
generate a 5-minute signed URL on the server:

```ts
import { signedDeliveryUrl } from "@/lib/cloudinary";

const url = signedDeliveryUrl(doc.publicId, { expiresInSec: 300 });
```

Never persist these URLs — generate per request.

### 2.4 Mobile uploads
In Expo:
```ts
import * as ImagePicker from "expo-image-picker";

const r = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true });
// then POST to your /api/uploads/sign + upload to cloudinary
```

---

## 3. Auth — replace the localStorage hack

### 3.1 Use NextAuth (already added to deps)
```bash
# already installed via package.json:
# next-auth @auth/prisma-adapter bcryptjs
```

Create `src/lib/auth-server.ts` exporting `auth()` & `handlers` using the
`PrismaAdapter`. Use `Credentials` provider that:
- looks up user by email/phone,
- compares `passwordHash` with bcrypt,
- checks `status === ACTIVE` and KYC,
- issues JWT with `{ sub, role, parentId }`,
- writes a row in `Session`.

Then **server-render** every protected page using `auth()`, not localStorage.

### 3.2 Add OTP for login + every txn > ₹2,000
Use the `Otp` model. Send via **MSG91** (cheap, DLT-compliant for India).

```ts
await prisma.otp.create({
  data: { channel: "SMS", target: phone, codeHash, purpose: "LOGIN", expiresAt }
});
```

### 3.3 Hash & rotate everything
- Passwords: `bcrypt` with cost 12.
- API keys (`ApiKey.secretHash`): SHA-256.
- PII columns (PAN, Aadhaar) — encrypt at app layer with `APP_ENCRYPTION_KEY`
  (AES-256-GCM) before insert.

---

## 4. Real money rails — partner integrations

You **cannot** build AePS / DMT / UPI / BBPS yourself. You integrate a
licensed aggregator:

| Service        | Indian aggregators                                            |
| -------------- | ------------------------------------------------------------- |
| AePS, DMT      | PaySprint, Eko, Spice Money, IServeU, RBL Bank API            |
| UPI Collect    | Razorpay, Cashfree, PhonePe Business, ICICI Eazypay           |
| Wallet payouts | RazorpayX, Cashfree Payouts, ICICI CIB                        |
| BBPS bills     | BillAvenue, Setu, Euronet, Worldline                          |
| Recharges      | RechargeAPI, Plan API, PaySprint                              |
| Travel         | Tripjack, TBO, EaseMyTrip distributor program                 |
| PAN card       | NSDL e-Gov, UTIITSL                                           |

For each:
1. Sign their commercial agreement → get **API_KEY / SECRET / PARTNER_ID**.
2. Create one file `src/lib/partners/<name>.ts` exporting typed methods
   (`balance()`, `withdraw()`, `transfer()` …).
3. Wrap calls in `Transaction` records (status flow `INITIATED → PROCESSING
   → SUCCESS|FAILED`). Persist their `partnerTxnId` for reconciliation.
4. Listen to **webhooks** (`/api/webhooks/<partner>/route.ts`) — verify HMAC
   signature, update `Transaction.status`, credit/debit `WalletTxn`.
5. Reconcile daily via cron (`/api/cron/reconcile`) using their statement API.

### 4.1 Compliance checklist (RBI + NPCI)
- **PA-PG license** (or partner with one) before holding customer money.
- **AePS Sub-K** via your sponsor bank (NPCI mandates).
- **BBPS-AI / OU** registration for utility bills.
- **CKYC** for all retailers; **PAN + Aadhaar OTP eKYC** at onboarding.
- Data residency: store everything in **India region** (Neon Mumbai,
  Cloudinary AP region, Vercel Mumbai edge or AWS ap-south-1).
- 7-year audit log retention (`AuditLog` table — back up to S3 Glacier).
- Annual **VAPT** + **PCI-DSS SAQ-A** assessment if you touch card numbers.

---

## 5. Hosting

### 5.1 Web portal — Vercel
```bash
npm i -g vercel
vercel link
vercel env pull .env.local           # pulls non-secrets
# add real secrets in Vercel dashboard → Project → Settings → Environment
vercel deploy --prod
```
- Region: `bom1` (Mumbai).
- Add custom domain `app.nxtgpay.com`.
- Enable **Vercel Firewall** + **Bot Protection** + **WAF rules**.

Alternative: AWS Amplify, Render, or self-hosted on AWS ECS Fargate
behind CloudFront if compliance demands it.

### 5.2 Cron / background jobs
- Reconciliation, settlement, expiry of OTPs:
  - Vercel Cron (`vercel.json`) for light jobs.
  - Inngest or Trigger.dev for queued workflows (refunds, payouts).

### 5.3 Mobile app
- **iOS**: Apple Developer ($99/yr), `eas build --platform ios --profile production` → submit via TestFlight → App Store.
- **Android**: Google Play Console ($25 one-time), `eas build --platform android` → upload AAB → Play Console (internal → closed → open → production).
- Use **EAS Update** for OTA bug fixes without re-submitting.

```bash
cd mobile_app
npm install -g eas-cli
eas login
eas build:configure
eas build --platform all --profile production
eas submit --platform all
```

---

## 6. Observability & ops

| Concern         | Tool                                                    |
| --------------- | ------------------------------------------------------- |
| Errors          | Sentry (`@sentry/nextjs`, `@sentry/react-native`)       |
| Logs            | Pino → Axiom / Datadog / Better Stack                   |
| Uptime          | BetterStack / UptimeRobot                               |
| Metrics         | Vercel Analytics + Posthog                              |
| Alerting        | PagerDuty / Opsgenie                                    |
| Secrets         | Vercel + Doppler (rotate quarterly)                     |
| Rate limiting   | Upstash Redis + `@upstash/ratelimit`                    |

---

## 7. Pre-launch checklist

- [ ] All env vars set on Vercel **and** EAS.
- [ ] `npm run db:deploy` runs in CI on every prod push.
- [ ] Smoke test: signup → KYC upload → wallet topup → AePS demo → settlement.
- [ ] Disaster drill: revoke an API key, restore a Neon branch.
- [ ] Pen test report archived.
- [ ] Privacy policy + Terms + Refund policy live at footer URLs.
- [ ] Razorpay/PG account fully activated, payout balance funded.
- [ ] DLT templates approved with telcos (sender ID `PRISMP`).
- [ ] Apple / Google store listings reviewed (screenshots, classification).
- [ ] On-call rota set, runbook in this repo's `/docs/runbook.md`.

When the boxes above are green, flip the DNS, announce the launch, and
keep the `/api/healthz` endpoint green. 🚀
