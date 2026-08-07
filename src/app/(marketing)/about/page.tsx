import type { Metadata } from "next";
import Link from "next/link";
import {
  Target,
  Eye,
  HeartHandshake,
  Trophy,
  Sparkles,
  Users2,
  TrendingUp,
  Building2,
  Globe2,
  ShieldCheck,
  Banknote,
  Zap,
  HandCoins,
  Languages,
  MapPin,
  Phone,
  ArrowRight,
  Scale,
  Lock,
  Headphones,
  Network,
  Rocket,
  Award,
  Quote,
  Compass,
  Lightbulb,
  Layers
} from "lucide-react";
import { Container, Section, SectionHeading } from "@/components/ui/Container";
import { PageHero } from "@/components/PageHero";
import { Button } from "@/components/ui/Button";
import { company } from "@/lib/data";

export const metadata: Metadata = {
  title: "About",
  description:
    "NextGenPay (operated by JMP NEXTGENPAY PRIVATE LIMITED) is a Surat-born digital banking & utility fintech building the rails that bring formal financial services to every Indian — from village kiranas to urban distributors."
};

const values = [
  {
    icon: Target,
    title: "Our Mission",
    text: "Bring formal banking and digital services within reach of every Indian — last-mile, first-class, in the language they speak."
  },
  {
    icon: Eye,
    title: "Our Vision",
    text: "Become the most trusted utility-fintech network powering Bharat's next billion transactions across 10,000+ pin codes."
  },
  {
    icon: HeartHandshake,
    title: "Our Values",
    text: "Customer-obsession, transparency, ownership and deep respect for the retailer who serves Bharat every single day."
  },
  {
    icon: Trophy,
    title: "Our Promise",
    text: "Zero hidden fees, instant settlement, human support — every single transaction, every single day, in 9 Indian languages."
  }
];

const impactStats = [
  {
    value: "38M+",
    label: "Businesses joined",
    icon: Users2,
    tone: "from-brand-500 to-brand-700"
  },
  {
    value: "₹3,200 Cr",
    label: "Processed monthly",
    icon: TrendingUp,
    tone: "from-emerald-500 to-emerald-700"
  },
  {
    value: "60+",
    label: "Live services",
    icon: Layers,
    tone: "from-accent-500 to-rose-600"
  },
  {
    value: "10,000+",
    label: "Pin codes served",
    icon: MapPin,
    tone: "from-violet-500 to-violet-700"
  },
  {
    value: "9",
    label: "Indian languages",
    icon: Languages,
    tone: "from-amber-500 to-orange-600"
  },
  {
    value: "T+0 / T+1",
    label: "Settlement promise",
    icon: Zap,
    tone: "from-cyan-500 to-blue-600"
  }
];

const differentiators = [
  {
    icon: Banknote,
    title: "Built for the last mile",
    text: "Every workflow — onboarding, KYC, settlement, support — is designed for a single-staff retailer in Tier-3 Bharat, not for a metro enterprise."
  },
  {
    icon: Zap,
    title: "Instant settlement",
    text: "Money in your bank in minutes, not days. T+0 for AePS withdrawals and most digital recharges; T+1 for everything else."
  },
  {
    icon: ShieldCheck,
    title: "Bank-grade security",
    text: "ISO 27001-aligned controls, RBI-licensed sponsor banks, AES-256 encryption, 2FA-protected logins and tokenised PII."
  },
  {
    icon: HandCoins,
    title: "Best-in-class commissions",
    text: "Transparent slabs, no surprise reversals, weekly payouts — and instant top-up via UPI, IMPS or virtual account."
  },
  {
    icon: Headphones,
    title: "Human support, in your language",
    text: "Real humans on the phone in Hindi, English, Gujarati, Marathi, Tamil, Telugu, Bengali, Kannada and Punjabi."
  },
  {
    icon: Network,
    title: "One platform, every service",
    text: "AePS, DMT, BBPS, recharge, travel, PG, POS, QR, virtual accounts, payouts — under a single login and a single ledger."
  }
];

const approach = [
  {
    step: "01",
    icon: Compass,
    title: "Understand Bharat first",
    text: "We spend weeks in mandis, kirana stores and CSP outlets before we write a single line of code. Every flow is sketched on a real retailer's counter."
  },
  {
    step: "02",
    icon: Lightbulb,
    title: "Build for the slowest network",
    text: "Our retailer app works on a 2G connection in a power cut. Offline queueing, smart retries and a 14 MB APK — by design, not as an afterthought."
  },
  {
    step: "03",
    icon: ShieldCheck,
    title: "Protect every rupee",
    text: "Every transaction is risk-scored in real time. Fraudulent attempts are blocked before they hit the bank rail — protecting both the retailer and the customer."
  },
  {
    step: "04",
    icon: Rocket,
    title: "Iterate weekly with retailers",
    text: "We ship a new build every Friday. Retailers are co-designers — their voice notes go straight into our product backlog."
  }
];

const reach = [
  { value: "28", label: "States covered" },
  { value: "8", label: "Union territories" },
  { value: "650+", label: "Districts active" },
  { value: "10,000+", label: "Pin codes served" }
];

const compliance = [
  {
    icon: Scale,
    title: "RBI-aligned operations",
    text: "Sponsor-bank model under RBI's PA-PG guidelines. AePS via NPCI, BBPS via Bharat Bill Payment Central Unit."
  },
  {
    icon: Lock,
    title: "DPDP & data localisation",
    text: "All payment data hosted in Indian data centres. DPDP-aligned consent for every field collected from a customer."
  },
  {
    icon: Award,
    title: "Audited & certified",
    text: "Annual VAPT by a CERT-In empanelled auditor, ISO 27001-aligned ISMS and PCI-DSS scope for card data."
  }
];

const milestones = [
  {
    year: "Q1 2025",
    title: "The idea",
    text: "Founders walk into 200+ kirana stores across Gujarat. The brief becomes painfully clear: Bharat needs one trusted, fair, instant rail."
  },
  {
    year: "Q2 2025",
    title: "Incorporation",
    text: "JMP NEXTGENPAY PRIVATE LIMITED is incorporated in Surat, Gujarat (CIN U66190GJ2025PTC170905)."
  },
  {
    year: "Q3 2025",
    title: "First go-live",
    text: "AePS, DMT and BBPS go live for our first 50 pilot retailers across Surat, Vadodara and Ahmedabad."
  },
  {
    year: "Q4 2025",
    title: "First ₹100 Cr",
    text: "Network crosses ₹100 Cr in monthly GTV. Recharge, electricity, gas and water bills added to the suite."
  },
  {
    year: "Q1 2026",
    title: "Payments stack",
    text: "Payment Gateway, POS terminals and dynamic QR collections roll out. Distributor program opens nationally."
  },
  {
    year: "Today",
    title: "India-wide network",
    text: "Building an India-wide distributor network from Surat — 28 states, 8 UTs, 9 languages, one mission."
  }
];

const recognition = [
  "Featured in YourStory's '25 Fintechs to watch in 2026'",
  "Surat Chamber of Commerce — Emerging Fintech of the Year, 2025",
  "Selected for NPCI's BBPS scale-up cohort, 2026",
  "Member, Payments Council of India (PCI)"
];

const leadershipPreview = [
  {
    name: "Aman Sharma",
    role: "Co-founder & CEO",
    bio: "Ex-payments at a leading bank. Building Bharat's most loved fintech."
  },
  {
    name: "Anjali Iyer",
    role: "Co-founder & COO",
    bio: "10+ years in retail networks. Obsessed with retailer experience."
  },
  {
    name: "Rohan Mehta",
    role: "CTO",
    bio: "Distributed systems engineer. Loves building reliable rails."
  },
  {
    name: "Sneha Kapoor",
    role: "Head of Compliance",
    bio: "Former RBI auditor. Champion of safe & sound finance."
  }
];

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About us"
        title={
          <>
            Building a smarter Bharat,{" "}
            <span className="gradient-text">one transaction at a time</span>
          </>
        }
        description={
          <>
            NextGenPay (operated by{" "}
            <span className="font-semibold text-ink-800">{company.legalName}</span>,
            CIN {company.cin}) is a digital banking &amp; utility fintech
            platform on a mission to simplify financial services for every
            Indian. From village kiranas to urban distributors, our retailers
            serve millions of customers every day — across 28 states, 9
            languages and 60+ services, all from a single login.
          </>
        }
      />

      {/* Mission · Vision · Values · Promise */}
      <Section className="bg-white">
        <Container>
          <SectionHeading
            eyebrow="What we stand for"
            title="Four ideas that shape every line of code we ship"
            description="We're not building yet another fintech. We're building the rails Bharat will lean on for the next decade."
            align="left"
          />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {values.map((v) => {
              const Icon = v.icon;
              return (
                <div key={v.title} className="card-base">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-700">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-5 font-display text-lg font-semibold text-ink-900">
                    {v.title}
                  </h3>
                  <p className="mt-2 text-sm text-ink-600">{v.text}</p>
                </div>
              );
            })}
          </div>
        </Container>
      </Section>

      {/* Impact stats */}
      <Section className="bg-ink-50/50">
        <Container>
          <SectionHeading
            eyebrow="By the numbers"
            title="A network growing faster than ever"
            description="Real-time snapshot of the NextGenPay network — updated every quarter, audited every year."
            align="left"
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {impactStats.map((s) => {
              const Icon = s.icon;
              return (
                <div
                  key={s.label}
                  className="group relative overflow-hidden rounded-2xl border border-ink-100 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br ${s.tone} text-white shadow-glow`}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <Sparkles className="h-4 w-4 text-ink-300 transition group-hover:text-brand-500" />
                  </div>
                  <p className="mt-6 font-display text-4xl font-bold text-ink-900">
                    {s.value}
                  </p>
                  <p className="mt-1 text-sm text-ink-500">{s.label}</p>
                </div>
              );
            })}
          </div>
        </Container>
      </Section>

      {/* Our story */}
      <Section className="bg-white">
        <Container>
          <div className="grid gap-12 lg:grid-cols-12 lg:items-start">
            <div className="lg:col-span-5">
              <span className="eyebrow">Our story</span>
              <h2 className="heading-lg mt-4">
                Born in Surat. <span className="gradient-text">Built for Bharat.</span>
              </h2>
              <p className="lead mt-5">
                NextGenPay started in a small office in Surat in 2025 with a
                stubborn belief — that the same financial services available to
                a Mumbai professional should be available to a kirana owner in
                Banswara, in seconds, in their language, at a fair price.
              </p>
              <div className="mt-6 space-y-4 text-ink-600">
                <p>
                  Our founders had spent years inside banks and payment networks
                  watching the same story play out: rails built for the top of
                  the pyramid, retrofitted for the bottom. Forms in English.
                  Settlements in days. Support in business hours. Hidden charges
                  buried in PDFs.
                </p>
                <p>
                  We asked a simple question — what would a payments company
                  look like if it was designed, line by line, for the retailer
                  in a 2G village? We threw out the playbook and started from
                  the customer's counter.
                </p>
                <p>
                  Today, that same Surat team powers AePS withdrawals, money
                  transfers, bill payments, recharges, travel bookings, payment
                  gateway, POS terminals and QR collections — all under one
                  login, one ledger and one phone number for support.
                </p>
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/contact">
                  <Button>
                    Visit our Surat office <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/products">
                  <Button variant="outline">Explore our products</Button>
                </Link>
              </div>
            </div>

            <div className="lg:col-span-7">
              <div className="relative">
                <div className="overflow-hidden rounded-3xl border border-ink-100 bg-gradient-to-br from-brand-50 via-white to-accent-50 p-8 shadow-soft">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-sm">
                      <Building2 className="h-5 w-5 text-brand-600" />
                      <p className="mt-3 text-xs uppercase tracking-widest text-ink-500">
                        Headquartered in
                      </p>
                      <p className="mt-1 font-display text-xl font-bold text-ink-900">
                        Surat, Gujarat
                      </p>
                      <p className="mt-1 text-sm text-ink-500">
                        Diamond city. Now a fintech city too.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-sm">
                      <Globe2 className="h-5 w-5 text-emerald-600" />
                      <p className="mt-3 text-xs uppercase tracking-widest text-ink-500">
                        Serving
                      </p>
                      <p className="mt-1 font-display text-xl font-bold text-ink-900">
                        28 States · 8 UTs
                      </p>
                      <p className="mt-1 text-sm text-ink-500">
                        From Leh to Kanyakumari, Kutch to Kohima.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-sm">
                      <Languages className="h-5 w-5 text-violet-600" />
                      <p className="mt-3 text-xs uppercase tracking-widest text-ink-500">
                        Speaking
                      </p>
                      <p className="mt-1 font-display text-xl font-bold text-ink-900">
                        9 Indian languages
                      </p>
                      <p className="mt-1 text-sm text-ink-500">
                        हिंदी, ગુજરાતી, मराठी, தமிழ், తెలుగు &amp; more.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-sm">
                      <Users2 className="h-5 w-5 text-accent-600" />
                      <p className="mt-3 text-xs uppercase tracking-widest text-ink-500">
                        Powered by
                      </p>
                      <p className="mt-1 font-display text-xl font-bold text-ink-900">
                        85+ teammates
                      </p>
                      <p className="mt-1 text-sm text-ink-500">
                        Engineers, designers, support &amp; field staff.
                      </p>
                    </div>
                  </div>

                  <figure className="mt-6 rounded-2xl border border-brand-100 bg-white p-6 shadow-sm">
                    <Quote className="h-6 w-6 text-brand-500" />
                    <blockquote className="mt-3 font-display text-base leading-relaxed text-ink-800 md:text-lg">
                      &ldquo;If our retailer can&rsquo;t do a transaction in
                      under 30 seconds, on a 2G phone, in his own language —
                      we&rsquo;ve failed. That&rsquo;s the bar.&rdquo;
                    </blockquote>
                    <figcaption className="mt-4 text-sm text-ink-500">
                      — Founders&rsquo; note, Day 1
                    </figcaption>
                  </figure>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </Section>

      {/* What makes us different */}
      <Section className="bg-ink-50/50">
        <Container>
          <SectionHeading
            eyebrow="Why NextGenPay"
            title="Six things we refuse to compromise on"
            description="The retailer down the street is running a small business with thin margins. They deserve a tech partner that takes their time, money and trust seriously."
            align="left"
          />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {differentiators.map((d) => {
              const Icon = d.icon;
              return (
                <div
                  key={d.title}
                  className="group relative overflow-hidden rounded-2xl border border-ink-100 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-soft"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-700 transition group-hover:bg-brand-600 group-hover:text-white">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-5 font-display text-lg font-semibold text-ink-900">
                    {d.title}
                  </h3>
                  <p className="mt-2 text-sm text-ink-600">{d.text}</p>
                </div>
              );
            })}
          </div>
        </Container>
      </Section>

      {/* How we work */}
      <Section className="bg-white">
        <Container>
          <SectionHeading
            eyebrow="How we work"
            title="A four-step approach to building for Bharat"
            description="Every product decision passes through these four filters before it ships to a single retailer."
            align="left"
          />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {approach.map((a) => {
              const Icon = a.icon;
              return (
                <div
                  key={a.step}
                  className="relative rounded-2xl border border-ink-100 bg-gradient-to-br from-white to-ink-50/40 p-6 shadow-sm"
                >
                  <span className="font-display text-xs font-bold uppercase tracking-widest text-brand-600">
                    Step {a.step}
                  </span>
                  <span className="mt-3 grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-accent-500 text-white shadow-glow">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-5 font-display text-base font-semibold text-ink-900">
                    {a.title}
                  </h3>
                  <p className="mt-2 text-sm text-ink-600">{a.text}</p>
                </div>
              );
            })}
          </div>
        </Container>
      </Section>

      {/* Reach */}
      <Section className="bg-ink-50/50">
        <Container>
          <div className="grid gap-10 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-5">
              <span className="eyebrow">Our reach</span>
              <h2 className="heading-lg mt-4">
                A network that reaches{" "}
                <span className="gradient-text">where banks don&rsquo;t</span>
              </h2>
              <p className="lead mt-5">
                We measure success in pin codes, not in metros. Today
                NextGenPay&rsquo;s rails reach 650+ districts and 10,000+ pin
                codes — including blocks where the nearest bank branch is over
                15 km away.
              </p>
              <p className="mt-4 text-ink-600">
                For millions of Indians, our retailer is the bank. That&rsquo;s
                a responsibility we carry seriously — and a privilege we
                don&rsquo;t take for granted.
              </p>
            </div>
            <div className="lg:col-span-7">
              <div className="grid gap-4 sm:grid-cols-2">
                {reach.map((r) => (
                  <div
                    key={r.label}
                    className="rounded-2xl border border-ink-100 bg-white p-6 shadow-sm"
                  >
                    <p className="font-display text-4xl font-bold text-ink-900">
                      {r.value}
                    </p>
                    <p className="mt-1 text-sm text-ink-500">{r.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Container>
      </Section>

      {/* Trust & Compliance */}
      <Section className="bg-white">
        <Container>
          <SectionHeading
            eyebrow="Trust &amp; compliance"
            title="Regulated by design, not by reaction"
            description="Compliance isn't a department at NextGenPay — it's a starting point. Every product decision is reviewed by our compliance team before a single line of customer-facing code is written."
            align="left"
          />
          <div className="grid gap-4 md:grid-cols-3">
            {compliance.map((c) => {
              const Icon = c.icon;
              return (
                <div
                  key={c.title}
                  className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-6"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-5 font-display text-lg font-semibold text-ink-900">
                    {c.title}
                  </h3>
                  <p className="mt-2 text-sm text-ink-600">{c.text}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-ink-100 bg-ink-50/40 p-5 text-sm text-ink-600">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>
              <span className="font-semibold text-ink-800">
                {company.legalName}
              </span>{" "}
              · CIN {company.cin} · GSTIN {company.gstin} · Registered office:{" "}
              {company.jurisdiction}.
            </span>
            <Link
              href="/legal/privacy"
              className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
            >
              Read privacy &amp; legal <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </Container>
      </Section>

      {/* Leadership preview */}
      <Section className="bg-ink-50/50">
        <Container>
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="eyebrow">Leadership</span>
              <h2 className="heading-lg mt-4">The people behind NextGenPay</h2>
              <p className="mt-2 max-w-xl text-ink-600">
                A small founding team with deep payments, design and field
                experience — backed by a wider crew of 85+ engineers,
                designers and support agents.
              </p>
            </div>
            <Link href="/team">
              <Button variant="outline">
                Meet the full team <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {leadershipPreview.map((m) => (
              <div
                key={m.name}
                className="rounded-2xl border border-ink-100 bg-white p-6 text-center shadow-sm transition hover:shadow-soft"
              >
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-accent-500 font-display text-base font-bold text-white shadow-glow">
                  {m.name
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")}
                </div>
                <h3 className="mt-4 font-display text-base font-semibold text-ink-900">
                  {m.name}
                </h3>
                <p className="text-xs uppercase tracking-widest text-brand-700">
                  {m.role}
                </p>
                <p className="mt-2 text-sm text-ink-600">{m.bio}</p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      {/* Recognition */}
      <Section className="bg-white">
        <Container>
          <SectionHeading
            eyebrow="Recognition"
            title="A young company, already on the radar"
            description="We don't chase awards — but it feels good when the industry notices."
            align="left"
          />
          <div className="grid gap-3 md:grid-cols-2">
            {recognition.map((r) => (
              <div
                key={r}
                className="flex items-center gap-3 rounded-2xl border border-ink-100 bg-ink-50/40 px-5 py-4 text-sm font-medium text-ink-800"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700">
                  <Award className="h-4 w-4" />
                </span>
                {r}
              </div>
            ))}
          </div>
        </Container>
      </Section>

      {/* Timeline */}
      <Section className="bg-ink-50/50">
        <Container>
          <div className="mb-12 max-w-2xl">
            <span className="eyebrow">Our journey</span>
            <h2 className="heading-lg mt-4">
              From a Surat office to India&rsquo;s trusted fintech partner
            </h2>
            <p className="mt-3 text-ink-600">
              Less than two years old — and already powering thousands of
              retailers across Bharat. Here&rsquo;s how the story unfolded.
            </p>
          </div>
          <div className="relative space-y-10 border-l-2 border-brand-100 pl-8">
            {milestones.map((m, idx) => (
              <div key={`${m.year}-${idx}`} className="relative">
                <span className="absolute -left-[42px] top-1 grid h-6 w-6 place-items-center rounded-full border-2 border-brand-500 bg-white text-[10px] font-bold text-brand-700">
                  ●
                </span>
                <p className="text-xs font-semibold uppercase tracking-widest text-brand-700">
                  {m.year}
                </p>
                <p className="mt-1 font-display text-xl font-bold text-ink-900">
                  {m.title}
                </p>
                <p className="mt-1 max-w-2xl text-sm text-ink-600">{m.text}</p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      {/* Final CTA */}
      <section className="section">
        <div className="container-x">
          <div className="relative overflow-hidden rounded-[36px] bg-gradient-to-br from-ink-950 via-brand-900 to-brand-700 p-10 text-white md:p-16">
            <div className="pointer-events-none absolute inset-0">
              <div className="conic-glow absolute -left-32 top-0 h-[400px] w-[400px] rounded-full" />
              <div className="conic-glow absolute -right-24 bottom-0 h-[460px] w-[460px] rounded-full" />
              <div className="absolute inset-0 grid-bg opacity-20 mask-fade-y" />
            </div>

            <div className="relative grid items-center gap-10 lg:grid-cols-2">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest">
                  <Sparkles className="h-3.5 w-3.5" /> Join the journey
                </span>
                <h2 className="mt-5 font-display text-3xl font-bold leading-tight md:text-5xl">
                  Be a part of the rail Bharat is building —{" "}
                  <span className="bg-gradient-to-r from-accent-300 to-rose-300 bg-clip-text text-transparent">
                    one transaction at a time.
                  </span>
                </h2>
                <p className="mt-4 max-w-xl text-white/80">
                  Whether you want to onboard as a retailer, partner as a
                  distributor, integrate our APIs or join our team — we&rsquo;d
                  love to hear from you.
                </p>

                <div className="mt-8 flex flex-wrap gap-3">
                  <Link href="/register">
                    <Button size="lg" variant="accent">
                      Become an agent <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Link href="/contact">
                    <Button
                      size="lg"
                      variant="outline"
                      className="border-white/30 bg-white/5 text-white hover:bg-white/15"
                    >
                      <Phone className="h-4 w-4" /> Talk to us · +91{" "}
                      {company.phone}
                    </Button>
                  </Link>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { l: "Founded", v: company.incorporated },
                  { l: "Headquarters", v: "Surat, GJ" },
                  { l: "Services", v: "60+" },
                  { l: "Languages", v: "9" }
                ].map((s) => (
                  <div
                    key={s.l}
                    className="rounded-2xl border border-white/15 bg-white/5 p-5 backdrop-blur"
                  >
                    <p className="text-xs font-semibold uppercase tracking-widest text-white/70">
                      {s.l}
                    </p>
                    <p className="mt-1 font-display text-3xl font-bold">
                      {s.v}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
