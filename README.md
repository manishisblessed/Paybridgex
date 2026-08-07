# NextGenPay — Fintech Distribution Portal

A production-grade Next.js 14 fintech portal for **JMP NEXTGENPAY PRIVATE LIMITED** (trade name: `nxtgpay`). Built per the agreed proposal, it covers all 7 modules — **Payment Gateway (PG), Point of Sale (POS), QR Code Payments, Master Distributor (MDS), Distributor (DS), Retailer Portal and Sub-Admin Panel** — plus a polished marketing site and 15+ additional service modules (AePS, money transfer, recharges, bill payments, travel bookings, wallet, transactions, and more).

> Registered office: 2nd Floor, 201, Devi Arcade, Ashwini Kumar Road, Modi Maholla, Surat, Gujarat - 395008
> Email: Info@nxtgpay.com · Domain: [nxtgpay.com](https://nxtgpay.com/)
>
> Note: the CIN and phone number in `src/lib/data.ts` are placeholders — replace them with the client's official details before launch.

## ✨ Features

### Marketing site (`/`)
- **Hero** with stats, animated wallet card and trust badges
- **Trust marquee** of partners (NPCI, RBI, Visa, Mastercard, RuPay, etc.)
- **About**, **Goals**, **Services Grid** (16 services), **Payment Process** (4-step), **Solutions**, **Pricing** (3 plans), **Testimonials**, **FAQ**, **Blog**, **Newsletter** sections
- Inner pages: **About**, **Services**, **Products**, **Career**, **Team**, **Contact**, **Legal**
- Sticky responsive navbar with mega-menu on hover

### Auth
- `/login` and `/register` with split-pane premium UI
- Mock auth using `localStorage` + cookie (demo creds: `demo@nxtgpay.com / demo1234`)

### Dashboard (`/dashboard`)
- Sidebar + topbar with wallet pill, notifications and profile menu
- Protected route — redirects to `/login` if no session
- **Overview**: greeting, stat cards, wallet card, quick services, recent transactions
- **Payment Gateway (PG)**: payment-link generator, multi-mode order feed, settlement states (`/dashboard/pg`, admin at `/dashboard/admin/pg`)
- **POS Terminals**: machine fleet, card/UPI/BharatQR transactions, rental invoices (`/dashboard/pos`, admin inventory at `/dashboard/admin/pos`)
- **QR Payments**: static & dynamic UPI QR generator with live preview, QR register and payment feed (`/dashboard/qr`)
- **Wallet**: top-up + withdraw with live balance updates
- **Money Transfer (DMT)**: full IMPS/NEFT/RTGS form with success modal
- **AePS** (Aadhaar Pay): Withdrawal / balance / mini-statement
- **UPI Collect**: live QR generator + copyable UPI link (`nextgenpay@axisbank`)
- **Recharges**: Mobile / DTH / Broadband
- **Bill Payments**: Electricity / Water / Gas / Credit Card / Education
- **Travel**: Flight search, Hotel search, Bus search with mock results
- **Virtual Account** with copyable IFSC/account
- **Transactions**: search, filter, export-ready, summary cards
- **Profile** + **Settings** (notifications, security, password)

### API (mocked)
- `POST /api/auth/login`, `POST /api/auth/register`
- `GET/POST /api/transactions`
- `POST /api/bills/fetch`

## 🛠 Tech stack

- **Next.js 14** (App Router) + **TypeScript**
- **Tailwind CSS 3** with custom design tokens (brand, accent, ink palettes)
- **Lucide React** icons
- **class-variance-authority** + **tailwind-merge** for variants
- Modular route groups: `(marketing)`, `(auth)`, `dashboard/*`

## 🚀 Getting started

```bash
# install dependencies
npm install

# run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

To explore the dashboard, click **Login** and use the pre-filled demo credentials, or click **Become an Agent** to register.

## 📁 Project structure

```
src/
├── app/
│   ├── (marketing)/      Marketing site (home, about, services, contact, etc.)
│   ├── (auth)/           Login & register
│   ├── dashboard/        Agent dashboard + all service modules
│   ├── api/              Mock API routes
│   ├── layout.tsx        Root HTML/body, fonts
│   └── globals.css       Tailwind + design tokens
├── components/
│   ├── layout/           Navbar, Footer, Logo
│   ├── home/             Landing-page sections
│   ├── dashboard/        Sidebar, Topbar, StatCard, TransactionsTable, etc.
│   ├── ui/               Button, Card, Input, Badge, Container
│   └── PageHero.tsx
└── lib/
    ├── utils.ts          cn(), formatINR, generateRefId
    ├── data.ts           company info, services list, FAQ, testimonials, pricing
    └── auth.ts           mock session helpers
```

All company info (name, CIN, address, phone, email, domain) lives in a single `company` object exported from `src/lib/data.ts` — change it once and it updates everywhere.

## 🎨 Design system

- **Brand blue** (`#185df5`) — primary actions, links
- **Accent orange** (`#f97606`) — secondary CTAs, highlights
- **Ink** scale — neutral text/background
- Two custom fonts via `next/font`: **Inter** (sans) + **Manrope** (display)
- Reusable utility classes: `.container-x`, `.section`, `.eyebrow`, `.heading-xl/lg/md`, `.lead`, `.gradient-text`

## 🔌 Production stack (already wired)

- **Neon Postgres** via Prisma — schema in `prisma/schema.prisma`. Run `npm run db:migrate` then `npm run db:seed`.
- **Cloudinary** for KYC docs / shop photos / agreements (signed direct browser uploads).
- **Partner-agnostic adapters** in `src/lib/partners/` for AePS, DMT, UPI Collect, RazorpayX Payouts, BBPS, Recharges, Travel, PAN, SMS (MSG91), Email (Resend). Each runs in MOCK mode until the corresponding `PARTNER_*_ENABLED` env flag is flipped to `true`.
- **Money-safe orchestrator** in `src/lib/services/transaction.ts` — idempotency, atomic wallet debit/credit, auto-refund on failure, audit logs.
- **Health endpoint** at `GET /api/healthz` reports DB and partner status.

See [`PRODUCTION.md`](./PRODUCTION.md) for the full launch runbook (Neon setup, Cloudinary setup, partner integrations, hosting on Vercel, EAS submit for mobile, compliance checklist).

## 📱 Mobile app

A React Native (Expo) retailer app lives in [`mobile_app/`](./mobile_app). It mirrors the web flows with biometric login, 5-tab navigation and all 16 services. Run with:

```bash
cd mobile_app
npm install
npm start
```

## 🔐 Secrets

Never commit `.env` or `.env.local`. Both are gitignored. Copy `.env.example` to `.env.local` and fill in real values for local development; configure the same keys in your hosting provider's secret manager for production.

## 📄 License

© JMP NEXTGENPAY PRIVATE LIMITED. Brand assets shown for product purposes; replace with finalized logo/imagery before launch.
