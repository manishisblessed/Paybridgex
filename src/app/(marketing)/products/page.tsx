import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Smartphone,
  Laptop2,
  Building2,
  Code2,
  Wallet,
  QrCode,
  Send,
  Fingerprint,
  Globe2,
  Languages,
  Wifi
} from "lucide-react";
import { Container, Section } from "@/components/ui/Container";
import { PageHero } from "@/components/PageHero";
import { Button } from "@/components/ui/Button";
import { Reveal, Stagger, StaggerItem, TiltCard } from "@/components/motion";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Products",
  description:
    "Retailer app, web dashboard, distributor suite and developer APIs — the four Paybridgex products that take you from a single counter to an enterprise integration."
};

/* ---------- mock-UI visuals ---------- */

function PhoneMock() {
  const actions = [
    { icon: Fingerprint, label: "AePS" },
    { icon: Send, label: "DMT" },
    { icon: QrCode, label: "UPI QR" },
    { icon: Wallet, label: "Wallet" }
  ];
  return (
    <div className="mx-auto w-64 rounded-[2.2rem] border border-ink-200 bg-white p-3 shadow-soft">
      <div className="rounded-[1.7rem] bg-gradient-to-b from-brand-700 to-brand-900 p-4 text-white">
        <div className="mx-auto mb-4 h-1.5 w-16 rounded-full bg-white/20" />
        <p className="text-[10px] uppercase tracking-widest text-white/50">Wallet balance</p>
        <p className="mt-1 font-display text-2xl font-bold">₹24,580</p>
        <div className="mt-4 grid grid-cols-4 gap-2">
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <div key={a.label} className="rounded-xl bg-white/10 p-2 text-center">
                <Icon className="mx-auto h-4 w-4 text-accent-300" />
                <p className="mt-1 text-[9px] text-white/70">{a.label}</p>
              </div>
            );
          })}
        </div>
        <div className="mt-4 space-y-2">
          {[
            ["AePS withdrawal", "+₹2,000"],
            ["Mobile recharge", "−₹239"],
            ["DMT to HDFC", "−₹5,000"]
          ].map(([t, amt]) => (
            <div key={t} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-[10px]">
              <span className="text-white/75">{t}</span>
              <span className={cn("font-semibold", amt.startsWith("+") ? "text-accent-300" : "text-white/90")}>
                {amt}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DashboardMock() {
  const bars = [42, 68, 55, 80, 64, 92, 75];
  return (
    <div className="mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-soft">
      <div className="flex items-center gap-1.5 border-b border-ink-100 bg-ink-50/60 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-accent-400" />
        <span className="ml-3 text-[10px] text-ink-400">app.paybridgex.in/dashboard</span>
      </div>
      <div className="p-5">
        <div className="grid grid-cols-3 gap-3">
          {[
            ["Today's GTV", "₹1.8L"],
            ["Success rate", "99.4%"],
            ["Commission", "₹2,140"]
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-ink-50/70 p-3">
              <p className="text-[9px] uppercase tracking-wider text-ink-400">{k}</p>
              <p className="mt-1 font-display text-sm font-bold text-ink-900">{v}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex h-24 items-end gap-2">
          {bars.map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-t-md bg-gradient-to-t from-brand-500 to-accent-400"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
        <p className="mt-2 text-center text-[9px] text-ink-400">Weekly volume</p>
      </div>
    </div>
  );
}

function NetworkMock() {
  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-ink-200 bg-white p-6 shadow-soft">
      <div className="flex justify-center">
        <div className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white shadow-glow">
          Master Distributor
        </div>
      </div>
      <div className="mx-auto mt-2 h-5 w-px bg-ink-200" />
      <div className="grid grid-cols-2 gap-3">
        {["Distributor A", "Distributor B"].map((d) => (
          <div key={d} className="text-center">
            <div className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-[11px] font-semibold text-brand-700">
              {d}
            </div>
            <div className="mx-auto mt-2 h-4 w-px bg-ink-200" />
            <div className="grid grid-cols-2 gap-1.5">
              {[1, 2, 3, 4].map((r) => (
                <div key={r} className="rounded-lg bg-accent-50 px-1 py-1.5 text-[9px] font-medium text-accent-700">
                  Retailer
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl bg-ink-50/70 px-4 py-2.5 text-center text-[10px] text-ink-500">
        Commission overrides flow down automatically, in real time
      </div>
    </div>
  );
}

function CodeMock() {
  return (
    <div className="mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-ink-800 bg-ink-950 shadow-soft">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <span className="text-[10px] font-medium text-white/50">create-payout.ts</span>
        <span className="rounded-full bg-accent-500/15 px-2 py-0.5 text-[9px] font-semibold text-accent-300">
          POST /v1/payouts
        </span>
      </div>
      <pre className="overflow-x-auto p-5 text-[11px] leading-relaxed">
        <code>
          <span className="text-brand-300">const</span>
          <span className="text-white"> payout = </span>
          <span className="text-brand-300">await</span>
          <span className="text-white"> pbx.payouts.</span>
          <span className="text-accent-300">create</span>
          <span className="text-white">({"{"}</span>
          {"\n"}
          <span className="text-white">  amount: </span>
          <span className="text-amber-300">50000</span>
          <span className="text-white">,</span>
          {"\n"}
          <span className="text-white">  mode: </span>
          <span className="text-emerald-300">&quot;IMPS&quot;</span>
          <span className="text-white">,</span>
          {"\n"}
          <span className="text-white">  beneficiary: </span>
          <span className="text-emerald-300">&quot;ben_8x2k91&quot;</span>
          {"\n"}
          <span className="text-white">{"}"});</span>
          {"\n\n"}
          <span className="text-ink-500">{"// → settled in ~4 seconds"}</span>
        </code>
      </pre>
    </div>
  );
}

/* ---------- page data ---------- */

const products = [
  {
    name: "Paybridgex Retailer App",
    icon: Smartphone,
    badge: "Most popular",
    headline: "Your whole shop, in your pocket",
    text: "Accept payments, run AePS withdrawals, transfer money, recharge and pay bills — all from an Android or iOS app that works even on patchy 2G networks.",
    points: ["Biometric login & PIN lock", "Offline-tolerant transaction queue", "Live commission tracker"],
    cta: { label: "Create free account", href: "/register" },
    visual: PhoneMock
  },
  {
    name: "Paybridgex Web Dashboard",
    icon: Laptop2,
    headline: "See every rupee in real time",
    text: "A full-width command centre for busy counters: transaction search, downloadable ledgers, multi-user roles and analytics that update by the second.",
    points: ["One-click Excel & PDF exports", "Role-based staff access", "GST-ready commission reports"],
    cta: { label: "Open dashboard", href: "/login" },
    visual: DashboardMock
  },
  {
    name: "Paybridgex Distributor Suite",
    icon: Building2,
    headline: "Grow a network, not a headache",
    text: "Onboard retailers in minutes, set slab-wise commission overrides, push wallet float down the chain and watch settlements roll up — from one screen.",
    points: ["Instant retailer KYC onboarding", "Slab-wise commission engine", "Network-wide P&L view"],
    cta: { label: "Talk to sales", href: "/contact" },
    visual: NetworkMock
  },
  {
    name: "Paybridgex Developer APIs",
    icon: Code2,
    headline: "Payments infrastructure, four lines at a time",
    text: "REST APIs for collections, payouts, AePS, BBPS and travel with sandbox keys on signup, webhooks for every event and predictable, versioned responses.",
    points: ["Sandbox in under 5 minutes", "Signed webhooks & idempotency", "99.97% uptime SLA"],
    cta: { label: "Explore the APIs", href: "/contact" },
    visual: CodeMock
  }
];

const compat = [
  { icon: Wifi, label: "Works on 2G", sub: "Low-bandwidth optimised" },
  { icon: Languages, label: "9 Indian languages", sub: "App & support" },
  { icon: Globe2, label: "Android · iOS · Web", sub: "One login everywhere" }
];

export default function ProductsPage() {
  return (
    <>
      <PageHero
        eyebrow="Products"
        title={
          <>
            One platform,{" "}
            <span className="gradient-text">four ways in</span>
          </>
        }
        description="Start on the retailer app, scale with the distributor suite, run operations on the web dashboard, and go deep with APIs — every product shares the same wallet and ledger."
      />

      {/* Alternating product sections */}
      {products.map((p, i) => {
        const Icon = p.icon;
        const Visual = p.visual;
        const flip = i % 2 === 1;
        return (
          <Section key={p.name} className={i % 2 === 0 ? "bg-white" : "bg-ink-50/40"}>
            <Container>
              <div className="grid items-center gap-12 lg:grid-cols-2">
                <Reveal direction={flip ? "left" : "right"} className={flip ? "lg:order-2" : ""}>
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-500 text-white shadow-glow">
                        <Icon className="h-6 w-6" />
                      </span>
                      {p.badge && (
                        <span className="rounded-full bg-accent-100 px-2.5 py-1 text-xs font-semibold text-accent-700">
                          {p.badge}
                        </span>
                      )}
                    </div>
                    <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">
                      {p.name}
                    </p>
                    <h2 className="mt-2 font-display text-3xl font-bold text-ink-900 md:text-4xl">
                      {p.headline}
                    </h2>
                    <p className="mt-4 max-w-lg text-ink-600">{p.text}</p>
                    <ul className="mt-6 space-y-2.5">
                      {p.points.map((pt) => (
                        <li key={pt} className="flex items-center gap-3 text-sm text-ink-700">
                          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-100 text-[10px] font-bold text-accent-700">
                            ✓
                          </span>
                          {pt}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-8">
                      <Link href={p.cta.href}>
                        <Button variant={i === 0 ? "primary" : "outline"}>
                          {p.cta.label} <ArrowRight className="h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                </Reveal>

                <Reveal direction={flip ? "right" : "left"} delay={0.1} className={flip ? "lg:order-1" : ""}>
                  <TiltCard intensity="subtle" className="group">
                    <Visual />
                  </TiltCard>
                </Reveal>
              </div>
            </Container>
          </Section>
        );
      })}

      {/* Compatibility strip */}
      <Section className="bg-white pt-0">
        <Container>
          <Stagger className="grid gap-4 rounded-[2rem] border border-ink-100 bg-gradient-to-r from-brand-50 via-white to-accent-50 p-8 sm:grid-cols-3">
            {compat.map((c) => {
              const Icon = c.icon;
              return (
                <StaggerItem key={c.label}>
                  <div className="flex items-center gap-4">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white text-brand-700 shadow-sm">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="font-display text-sm font-bold text-ink-900">{c.label}</p>
                      <p className="text-xs text-ink-500">{c.sub}</p>
                    </div>
                  </div>
                </StaggerItem>
              );
            })}
          </Stagger>
        </Container>
      </Section>
    </>
  );
}
