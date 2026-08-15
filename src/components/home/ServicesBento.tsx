import Link from "next/link";
import {
  CreditCard,
  Monitor,
  QrCode,
  Fingerprint,
  Send,
  Receipt,
  Smartphone,
  Plane,
  ArrowUpRight,
  Sparkles
} from "lucide-react";
import { Container, Section, SectionHeading } from "@/components/ui/Container";
import { Reveal } from "@/components/motion";

export function ServicesBento() {
  return (
    <Section className="bg-ink-50/60">
      <Container>
        <SectionHeading
          eyebrow="What you can offer"
          title="One counter. Sixty-plus businesses."
          description="Every tile below is a revenue line for your shop — switched on from day one, billed through one wallet."
        />

        <Reveal>
          <div className="grid auto-rows-[minmax(150px,auto)] gap-4 md:grid-cols-6">
            {/* Featured — Payment Gateway */}
            <Link
              href="/services"
              className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-800 p-7 text-white shadow-soft transition hover:shadow-glow md:col-span-3 md:row-span-2"
            >
              <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-accent-400/25 blur-3xl transition group-hover:bg-accent-400/40" />
              <CreditCard className="h-8 w-8 text-accent-300" />
              <h3 className="mt-24 font-display text-2xl font-bold md:text-3xl">
                Payment Gateway
              </h3>
              <p className="mt-2 max-w-sm text-sm text-white/75">
                Accept UPI, cards, net banking and wallets on your website or
                payment links — with T+1 settlement and zero setup cost.
              </p>
              <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-accent-300">
                See gateway pricing <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </span>
            </Link>

            {/* POS */}
            <Link
              href="/services"
              className="group relative overflow-hidden rounded-3xl border border-ink-100 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft md:col-span-3"
            >
              <div className="flex items-start justify-between">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-700">
                  <Monitor className="h-5 w-5" />
                </span>
                <ArrowUpRight className="h-4 w-4 text-ink-300 transition group-hover:text-brand-600" />
              </div>
              <h3 className="mt-4 font-display text-lg font-bold text-ink-900">POS terminals on rent</h3>
              <p className="mt-1 text-sm text-ink-600">
                Android POS with card, UPI, BharatQR and Tap-and-Pay — from ₹499/month.
              </p>
            </Link>

            {/* QR */}
            <Link
              href="/services"
              className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-accent-600 to-accent-700 p-6 text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft md:col-span-2"
            >
              <QrCode className="h-6 w-6 text-white/90" />
              <h3 className="mt-4 font-display text-lg font-bold">UPI QR collections</h3>
              <p className="mt-1 text-sm text-white/80">
                Branded static & dynamic QRs with voice-style instant alerts.
              </p>
            </Link>

            {/* AePS */}
            <Link
              href="/services"
              className="group rounded-3xl border border-ink-100 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft md:col-span-1"
            >
              <Fingerprint className="h-6 w-6 text-accent-600" />
              <h3 className="mt-4 font-display text-base font-bold text-ink-900">AePS</h3>
              <p className="mt-1 text-xs text-ink-600">Aadhaar cash-out & balance</p>
            </Link>

            {/* DMT */}
            <Link
              href="/services"
              className="group rounded-3xl border border-ink-100 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft md:col-span-2"
            >
              <div className="flex items-start justify-between">
                <Send className="h-6 w-6 text-brand-600" />
                <ArrowUpRight className="h-4 w-4 text-ink-300 transition group-hover:text-brand-600" />
              </div>
              <h3 className="mt-4 font-display text-lg font-bold text-ink-900">Money transfer</h3>
              <p className="mt-1 text-sm text-ink-600">
                24×7 IMPS to any bank account in India, in seconds.
              </p>
            </Link>

            {/* Bills */}
            <Link
              href="/services"
              className="group rounded-3xl border border-ink-100 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft md:col-span-2"
            >
              <Receipt className="h-6 w-6 text-accent-600" />
              <h3 className="mt-4 font-display text-lg font-bold text-ink-900">Bills & utilities</h3>
              <p className="mt-1 text-sm text-ink-600">
                Electricity, gas, water, credit cards, FASTag — 1,200+ billers on BBPS.
              </p>
            </Link>

            {/* Recharge */}
            <Link
              href="/services"
              className="group rounded-3xl border border-ink-100 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft md:col-span-1"
            >
              <Smartphone className="h-6 w-6 text-brand-600" />
              <h3 className="mt-4 font-display text-base font-bold text-ink-900">Recharges</h3>
              <p className="mt-1 text-xs text-ink-600">Mobile, DTH & broadband</p>
            </Link>

            {/* Travel */}
            <Link
              href="/services"
              className="group rounded-3xl border border-ink-100 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft md:col-span-1"
            >
              <Plane className="h-6 w-6 text-accent-600" />
              <h3 className="mt-4 font-display text-base font-bold text-ink-900">Travel</h3>
              <p className="mt-1 text-xs text-ink-600">Flights, buses & hotels</p>
            </Link>

            {/* CTA tile */}
            <Link
              href="/services"
              className="group flex flex-col justify-between rounded-3xl border-2 border-dashed border-brand-200 bg-brand-50/60 p-6 transition hover:border-brand-400 hover:bg-brand-50 md:col-span-2"
            >
              <Sparkles className="h-6 w-6 text-brand-600" />
              <div>
                <h3 className="font-display text-lg font-bold text-brand-800">
                  + 50 more services
                </h3>
                <p className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-brand-600">
                  Browse the full catalogue
                  <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </p>
              </div>
            </Link>
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}
