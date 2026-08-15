import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  Compass,
  Eye,
  Fingerprint,
  HeartHandshake,
  Landmark,
  Languages,
  Lock,
  MapPin,
  Scale,
  ShieldCheck,
  Sparkles,
  Target,
  Users2,
  Zap
} from "lucide-react";
import { Container, Section, SectionHeading } from "@/components/ui/Container";
import { PageHero } from "@/components/PageHero";
import { Button } from "@/components/ui/Button";
import { Reveal, Stagger, StaggerItem, CountUp } from "@/components/motion";
import { company } from "@/lib/data";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "About",
  description:
    "Paybridgex (operated by K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED) is an Ahmedabad-born payments fintech building the bridge that brings formal financial services to every Indian counter."
};

const facts = [
  { label: "Legal entity", value: "K.A. Paybridgex Solution (OPC) Pvt. Ltd." },
  { label: "CIN", value: company.cin },
  { label: "Incorporated", value: `${company.incorporated}, Ahmedabad` },
  { label: "Tagline", value: company.tagline }
];

const milestones = [
  {
    year: "2025",
    title: "The idea",
    text: "Months of groundwork across Gujarat's kirana counters and CSP outlets make the brief painfully clear: Bharat needs one trusted, fair, instant payment bridge."
  },
  {
    year: "Q1 2026",
    title: "Incorporation",
    text: "K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED is incorporated in Ahmedabad, Gujarat (CIN U82910GJ2026OPC181144)."
  },
  {
    year: "Q2 2026",
    title: "Platform build",
    text: "The Paybridgex stack takes shape — wallet ledger, commission engine, KYC pipeline and partner-bank integrations, engineered in Ahmedabad."
  },
  {
    year: "Q2 2026",
    title: "First go-live",
    text: "AePS, DMT and BBPS go live for our first pilot retailers across Ahmedabad, Gandhinagar and Vadodara."
  },
  {
    year: "Q3 2026",
    title: "Payments stack",
    text: "Payment Gateway, POS terminals and dynamic QR collections roll out. The distributor programme opens nationally."
  },
  {
    year: "Today",
    title: "Growing the bridge",
    text: "Building an India-wide distributor network from Ahmedabad — 28 states, 8 UTs, 9 languages, one mission."
  }
];

const values = [
  {
    icon: HeartHandshake,
    title: "Merchant first",
    text: "The retailer serving a whole neighbourhood is our real customer. Every fee, flow and feature is judged from their side of the counter."
  },
  {
    icon: Zap,
    title: "Settle instantly",
    text: "Money that moves slowly is money that can't work. T+0 for AePS and wallet withdrawals, T+1 for gateway volumes — no exceptions, no excuses."
  },
  {
    icon: Scale,
    title: "Transparent to a fault",
    text: "Published commission slabs, zero hidden fees, downloadable ledgers. If we can't explain a charge in one sentence, we don't levy it."
  },
  {
    icon: ShieldCheck,
    title: "Compliance is a feature",
    text: "RBI, NPCI and UIDAI frameworks aren't hurdles — they're the reason merchants can trust the bridge. We build inside the guardrails, always."
  }
];

const principles = [
  {
    icon: Compass,
    title: "Start at the counter",
    text: "Product ideas begin with a visit to a real shop, not a whiteboard. If a first-time smartphone user can't finish the flow, we redesign it."
  },
  {
    icon: Fingerprint,
    title: "Trust is engineered",
    text: "AES-256 encryption, tokenised PII, 2FA on every login and an annual CERT-In empanelled VAPT — security is a build step, not an audit scramble."
  },
  {
    icon: Users2,
    title: "Partners over volume",
    text: "We'd rather onboard one distributor who grows for years than ten who churn in a quarter. Slab-wise commissions reward loyalty, not just size."
  },
  {
    icon: Languages,
    title: "Speak Bharat's languages",
    text: "Nine Indian languages across the app and support desk, because financial confidence starts with understanding every word on the screen."
  }
];

const reach = [
  { value: 28, suffix: "", label: "States covered" },
  { value: 8, suffix: "", label: "Union territories" },
  { value: 60, suffix: "+", label: "Live services" },
  { value: 9, suffix: "", label: "Languages supported" }
];

const compliance = [
  {
    icon: Landmark,
    title: "Regulated rails only",
    text: "Every transaction runs on RBI-licensed sponsor banks and NPCI-certified switches."
  },
  {
    icon: Lock,
    title: "Data stays in India",
    text: "PII is encrypted, tokenised and stored in Indian data centres, aligned to the DPDP Act 2023."
  },
  {
    icon: ShieldCheck,
    title: "Audited continuously",
    text: "ISO 27001-aligned ISMS, PCI-DSS scope for card data and an annual external VAPT."
  }
];

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About us"
        title={
          <>
            The bridge between Bharat&apos;s counters and{" "}
            <span className="gradient-text">formal finance</span>
          </>
        }
        description="Paybridgex was born in Ahmedabad in 2026 with one job: give every Indian retailer the payment infrastructure a metro enterprise takes for granted."
      />

      {/* Who we are + fact panel */}
      <Section className="bg-white">
        <Container>
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <Reveal direction="right">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">
                  Who we are
                </p>
                <h2 className="mt-3 font-display text-3xl font-bold text-ink-900 md:text-4xl">
                  A payments company that thinks like a shopkeeper
                </h2>
                <div className="mt-5 space-y-4 text-ink-600">
                  <p>
                    India&apos;s digital payments story is extraordinary — but at millions of counters it still arrives second-hand: slow settlements, opaque commissions and support lines that never pick up. Paybridgex exists to close that gap.
                  </p>
                  <p>
                    From our home in Shahibag, Ahmedabad, we build one platform where a retailer can run AePS banking, money transfer, UPI collections, bill payments, recharges and travel — with instant settlement to one wallet and a human on the phone 24×7.
                  </p>
                  <p>
                    We&apos;re young by design. Being incorporated in {company.incorporated} means no legacy systems, no legacy thinking — just modern rails built for the way Bharat actually transacts.
                  </p>
                </div>
              </div>
            </Reveal>

            <Reveal direction="left" delay={0.1}>
              <div className="relative overflow-hidden rounded-[2rem] border border-ink-100 bg-gradient-to-br from-brand-900 via-brand-800 to-ink-900 p-8 text-white">
                <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-accent-500/20 blur-3xl" />
                <p className="relative text-xs font-semibold uppercase tracking-[0.2em] text-accent-300">
                  Company facts
                </p>
                <div className="relative mt-6 space-y-5">
                  {facts.map((f) => (
                    <div key={f.label} className="border-b border-white/10 pb-4 last:border-b-0 last:pb-0">
                      <p className="text-[11px] uppercase tracking-widest text-white/45">{f.label}</p>
                      <p className="mt-1 font-display text-base font-semibold">{f.value}</p>
                    </div>
                  ))}
                  <div className="flex items-start gap-2 text-sm text-white/70">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-accent-300" />
                    <p>{company.address}</p>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </Container>
      </Section>

      {/* Mission & Vision panels */}
      <Section className="bg-ink-50/40">
        <Container>
          <div className="grid gap-6 md:grid-cols-2">
            <Reveal direction="right">
              <div className="group h-full rounded-[2rem] border border-brand-100 bg-gradient-to-br from-brand-50 to-white p-8 transition hover:shadow-soft md:p-10">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-600 text-white shadow-glow transition group-hover:scale-110 group-hover:rotate-3">
                  <Target className="h-6 w-6" />
                </span>
                <h2 className="mt-6 font-display text-2xl font-bold text-ink-900">Our mission</h2>
                <p className="mt-3 text-ink-600">
                  Put formal banking and digital services within arm&apos;s reach of every Indian — last-mile, first-class, in the language they speak — by turning neighbourhood shops into trusted financial access points.
                </p>
              </div>
            </Reveal>
            <Reveal direction="left" delay={0.1}>
              <div className="group h-full rounded-[2rem] border border-accent-100 bg-gradient-to-br from-accent-50 to-white p-8 transition hover:shadow-soft md:p-10">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-500 text-white shadow-glow transition group-hover:scale-110 group-hover:-rotate-3">
                  <Eye className="h-6 w-6" />
                </span>
                <h2 className="mt-6 font-display text-2xl font-bold text-ink-900">Our vision</h2>
                <p className="mt-3 text-ink-600">
                  Become India&apos;s most trusted payment bridge — the network a retailer in any of 10,000+ pin codes points to and says, &quot;my money moves through Paybridgex, and it&apos;s never let me down.&quot;
                </p>
              </div>
            </Reveal>
          </div>
        </Container>
      </Section>

      {/* Timeline */}
      <Section className="bg-white">
        <Container>
          <SectionHeading
            eyebrow="Our story"
            title="From an idea to a national bridge"
            description="A short history — because we're just getting started."
          />
          <div className="relative mx-auto max-w-3xl">
            <div className="absolute bottom-0 left-4 top-0 w-px bg-gradient-to-b from-brand-200 via-accent-300 to-brand-200 md:left-1/2" />
            <div className="space-y-10">
              {milestones.map((m, i) => {
                const left = i % 2 === 0;
                return (
                  <Reveal key={`${m.year}-${m.title}`} direction={left ? "right" : "left"} delay={0.05}>
                    <div
                      className={cn(
                        "relative pl-12 md:w-1/2 md:pl-0",
                        left ? "md:pr-10 md:text-right" : "md:ml-auto md:pl-10"
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-1 grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-gradient-to-br from-brand-500 to-accent-500 shadow-glow",
                          "left-0 md:left-auto",
                          left ? "md:-right-4" : "md:-left-4"
                        )}
                      >
                        <span className="h-2 w-2 rounded-full bg-white" />
                      </span>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent-600">
                        {m.year}
                      </p>
                      <h3 className="mt-1 font-display text-lg font-semibold text-ink-900">
                        {m.title}
                      </h3>
                      <p className="mt-1.5 text-sm text-ink-500">{m.text}</p>
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </Container>
      </Section>

      {/* Values */}
      <Section className="bg-gradient-to-b from-ink-50/60 to-white">
        <Container>
          <SectionHeading
            eyebrow="What we stand for"
            title="Four values, zero fine print"
            align="left"
          />
          <Stagger className="grid gap-5 sm:grid-cols-2">
            {values.map((v) => {
              const Icon = v.icon;
              return (
                <StaggerItem key={v.title}>
                  <div className="group h-full rounded-3xl border border-ink-100 bg-white p-7 shadow-sm transition hover:-translate-y-1 hover:border-brand-200 hover:shadow-soft">
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-700 transition group-hover:scale-110 group-hover:rotate-6 group-hover:bg-brand-600 group-hover:text-white">
                      <Icon className="h-5 w-5" />
                    </span>
                    <h3 className="mt-5 font-display text-lg font-semibold text-ink-900">{v.title}</h3>
                    <p className="mt-2 text-sm text-ink-600">{v.text}</p>
                  </div>
                </StaggerItem>
              );
            })}
          </Stagger>
        </Container>
      </Section>

      {/* Reach counters */}
      <Section className="bg-gradient-to-r from-brand-800 via-brand-900 to-ink-950 text-white">
        <Container>
          <div className="grid items-center gap-10 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <Reveal>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-300">
                  Our reach
                </p>
                <h2 className="mt-3 font-display text-3xl font-bold md:text-4xl">
                  Built in Ahmedabad, built for all of India
                </h2>
                <p className="mt-4 text-white/70">
                  The distributor programme is live nationally — wherever there&apos;s a counter and a connection, the bridge reaches.
                </p>
              </Reveal>
            </div>
            <div className="grid grid-cols-2 gap-6 lg:col-span-7">
              {reach.map((s, i) => (
                <Reveal key={s.label} delay={i * 0.08}>
                  <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-center backdrop-blur">
                    <p className="font-display text-4xl font-extrabold text-accent-300 md:text-5xl">
                      <CountUp value={s.value} suffix={s.suffix} />
                    </p>
                    <p className="mt-2 text-sm font-medium text-white/70">{s.label}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      {/* Operating principles */}
      <Section className="bg-white">
        <Container>
          <div className="grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <div className="lg:sticky lg:top-28">
                <Reveal>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">
                    How we operate
                  </p>
                  <h2 className="mt-3 font-display text-3xl font-bold text-ink-900">
                    Principles that survive contact with reality
                  </h2>
                  <p className="mt-4 text-ink-600">
                    Anyone can frame values on a wall. These are the four we actually use to make decisions, every week.
                  </p>
                </Reveal>
              </div>
            </div>
            <div className="space-y-4 lg:col-span-8">
              {principles.map((p, i) => {
                const Icon = p.icon;
                return (
                  <Reveal key={p.title} direction="left" delay={i * 0.06}>
                    <div className="group flex items-start gap-5 rounded-3xl border border-ink-100 bg-white p-6 shadow-sm transition hover:border-accent-200 hover:shadow-soft">
                      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-accent-50 text-accent-700 transition group-hover:scale-110">
                        <Icon className="h-5 w-5" />
                      </span>
                      <div>
                        <h3 className="font-display text-base font-semibold text-ink-900">{p.title}</h3>
                        <p className="mt-1 text-sm text-ink-600">{p.text}</p>
                      </div>
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </Container>
      </Section>

      {/* Compliance strip */}
      <Section className="bg-ink-50/40">
        <Container>
          <SectionHeading
            eyebrow="Trust & compliance"
            title="Boring on purpose, where it matters"
          />
          <div className="grid gap-5 md:grid-cols-3">
            {compliance.map((c, i) => {
              const Icon = c.icon;
              return (
                <Reveal key={c.title} delay={i * 0.1}>
                  <div className="h-full rounded-3xl border border-ink-100 bg-white p-7 text-center shadow-sm">
                    <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-600 text-white shadow-glow">
                      <Icon className="h-5 w-5" />
                    </span>
                    <h3 className="mt-4 font-display text-base font-semibold text-ink-900">{c.title}</h3>
                    <p className="mt-2 text-sm text-ink-500">{c.text}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </Container>
      </Section>

      {/* Team + join CTA */}
      <Section className="bg-white">
        <Container>
          <Reveal>
            <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-r from-brand-700 via-brand-800 to-ink-900 px-8 py-12 text-center text-white md:px-16">
              <div className="absolute -left-16 -top-16 h-56 w-56 rounded-full bg-accent-500/20 blur-3xl" />
              <div className="absolute -bottom-16 -right-16 h-56 w-56 rounded-full bg-brand-400/20 blur-3xl" />
              <Sparkles className="mx-auto h-8 w-8 text-accent-300" />
              <h2 className="mx-auto mt-4 max-w-2xl font-display text-3xl font-bold md:text-4xl">
                The bridge is open. Walk across.
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-white/70">
                Meet the people building Paybridgex, or become one of the merchants they build for.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link href="/team">
                  <Button variant="accent" size="lg">
                    Meet the team <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/register">
                  <Button size="lg" variant="outline" className="border-white/30 bg-transparent text-white hover:border-accent-300 hover:text-accent-200">
                    Open a free account <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
              <div className="mx-auto mt-8 flex max-w-md items-center justify-center gap-2 text-xs text-white/50">
                <Building2 className="h-3.5 w-3.5" />
                <span>
                  {company.legalName} · CIN {company.cin}
                </span>
              </div>
            </div>
          </Reveal>
        </Container>
      </Section>
    </>
  );
}
