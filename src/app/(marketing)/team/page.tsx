import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Linkedin, MapPin, ShieldCheck, Sparkles, Users } from "lucide-react";
import { Container, Section, SectionHeading } from "@/components/ui/Container";
import { PageHero } from "@/components/PageHero";
import { Button } from "@/components/ui/Button";
import { Reveal, Stagger, StaggerItem, TiltCard, CountUp } from "@/components/motion";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Team",
  description:
    "Meet the Ahmedabad-based team building Paybridgex — engineers, operators and compliance specialists united by one mission: payments every Indian counter can trust."
};

// TODO(paybridgex): replace placeholder team members with the real roster before launch.
const founder = {
  name: "Founder & Director",
  initials: "KA",
  role: "K.A. Paybridgex Solution (OPC) Pvt. Ltd.",
  bio: "Started Paybridgex in Ahmedabad with a simple conviction: the shopkeeper who serves a whole neighbourhood deserves the same payment infrastructure as a big-city enterprise. Every product decision still starts at the counter."
};

const team = [
  { name: "Devang Trivedi", role: "Head of Engineering", bio: "Builds the rails — high-availability payment systems that survive festival-day traffic." },
  { name: "Ritu Shah", role: "Head of Operations", bio: "Turns onboarding, settlements and support into processes that just work." },
  { name: "Nilesh Rawal", role: "Head of Compliance", bio: "Keeps every rupee inside the guardrails of RBI, NPCI and UIDAI frameworks." },
  { name: "Hetal Joshi", role: "Head of Partnerships", bio: "Signs the banks, billers and networks that make 60+ services possible." },
  { name: "Parth Vaghela", role: "Head of Product", bio: "Designs flows a first-time smartphone user can finish without help." },
  { name: "Krupa Desai", role: "Head of Merchant Success", bio: "Owns the 12-minute reply time and every retailer's growth story." }
];

const cultureStats = [
  { value: 1, suffix: "", label: "City we call home", icon: MapPin },
  { value: 9, suffix: "", label: "Languages we support in", icon: Users },
  { value: 100, suffix: "%", label: "Team trained on data privacy", icon: ShieldCheck }
];

const gradients = [
  "from-brand-500 to-brand-700",
  "from-accent-400 to-accent-600",
  "from-brand-600 to-accent-500"
];

export default function TeamPage() {
  return (
    <>
      <PageHero
        eyebrow="Team"
        title={
          <>
            Small team,{" "}
            <span className="gradient-text">serious rails</span>
          </>
        }
        description="Paybridgex is built by a compact Ahmedabad team that sits close to the merchants it serves — close enough to visit a counter, watch a transaction and fix what's broken the same week."
      />

      {/* Founder feature */}
      <Section className="bg-white">
        <Container>
          <Reveal>
            <div className="relative overflow-hidden rounded-[2rem] border border-ink-100 bg-gradient-to-br from-brand-900 via-brand-800 to-ink-900 p-8 text-white md:p-12">
              <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-accent-500/20 blur-3xl" />
              <div className="relative grid items-center gap-8 md:grid-cols-[auto,1fr]">
                <div className="mx-auto grid h-28 w-28 place-items-center rounded-3xl bg-gradient-to-br from-accent-400 to-accent-600 font-display text-4xl font-extrabold text-ink-900 shadow-glow md:h-36 md:w-36">
                  {founder.initials}
                </div>
                <div className="text-center md:text-left">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-300">
                    {founder.role}
                  </p>
                  <h2 className="mt-2 font-display text-2xl font-bold md:text-3xl">
                    {founder.name}
                  </h2>
                  <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/75 md:text-base">
                    {founder.bio}
                  </p>
                </div>
              </div>
            </div>
          </Reveal>
        </Container>
      </Section>

      {/* Leadership grid */}
      <Section className="bg-ink-50/40">
        <Container>
          <SectionHeading
            eyebrow="Leadership"
            title="The people running the bridge"
            description="Six functions, one shared metric: did the merchant get paid, on time, every time?"
          />
          <Stagger className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {team.map((m, i) => (
              <StaggerItem key={m.name}>
                <TiltCard intensity="subtle" className="group h-full">
                  <div className="flex h-full flex-col rounded-3xl border border-ink-100 bg-white p-7 shadow-sm transition group-hover:shadow-soft">
                    <div
                      className={cn(
                        "grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br font-display text-lg font-bold text-white shadow-glow transition group-hover:scale-110 group-hover:rotate-3",
                        gradients[i % gradients.length]
                      )}
                    >
                      {m.name
                        .split(" ")
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")}
                    </div>
                    <h3 className="mt-5 font-display text-lg font-semibold text-ink-900">
                      {m.name}
                    </h3>
                    <p className="text-xs font-semibold uppercase tracking-widest text-brand-700">
                      {m.role}
                    </p>
                    <p className="mt-3 flex-1 text-sm text-ink-600">{m.bio}</p>
                    <a
                      href="#"
                      aria-label={`${m.name} LinkedIn`}
                      className="mt-5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-ink-100 text-ink-700 transition hover:bg-brand-600 hover:text-white"
                    >
                      <Linkedin className="h-4 w-4" />
                    </a>
                  </div>
                </TiltCard>
              </StaggerItem>
            ))}
          </Stagger>
        </Container>
      </Section>

      {/* Culture stats */}
      <Section className="bg-white">
        <Container>
          <div className="grid gap-6 md:grid-cols-3">
            {cultureStats.map((s, i) => {
              const Icon = s.icon;
              return (
                <Reveal key={s.label} delay={i * 0.1}>
                  <div className="rounded-3xl border border-ink-100 bg-gradient-to-b from-white to-ink-50/50 p-8 text-center shadow-sm">
                    <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-700">
                      <Icon className="h-5 w-5" />
                    </span>
                    <p className="mt-4 font-display text-4xl font-extrabold text-ink-900">
                      <CountUp value={s.value} suffix={s.suffix} />
                    </p>
                    <p className="mt-1 text-sm font-medium text-ink-500">{s.label}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>

          <Reveal delay={0.2}>
            <div className="mt-12 flex flex-col items-center gap-4 rounded-[2rem] border border-accent-100 bg-gradient-to-r from-accent-50 via-white to-brand-50 px-8 py-10 text-center md:flex-row md:text-left">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-accent-500 text-white shadow-glow">
                <Sparkles className="h-6 w-6" />
              </span>
              <div className="flex-1">
                <h2 className="font-display text-xl font-bold text-ink-900 md:text-2xl">
                  This page is missing your name.
                </h2>
                <p className="mt-1 text-sm text-ink-600">
                  We&apos;re hiring across engineering, design, sales, operations and compliance.
                </p>
              </div>
              <Link href="/career">
                <Button size="lg">
                  See open roles <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </Reveal>
        </Container>
      </Section>
    </>
  );
}
