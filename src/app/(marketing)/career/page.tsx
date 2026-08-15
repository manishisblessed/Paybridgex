import type { Metadata } from "next";
import {
  ArrowRight,
  MapPin,
  Briefcase,
  Clock,
  HeartPulse,
  Laptop,
  GraduationCap,
  Plane,
  Coins,
  Baby,
  FileText,
  PhoneCall,
  Users,
  Handshake
} from "lucide-react";
import { Container, Section, SectionHeading } from "@/components/ui/Container";
import { PageHero } from "@/components/PageHero";
import { Button } from "@/components/ui/Button";
import { Reveal, Stagger, StaggerItem, CountUp } from "@/components/motion";
import { company } from "@/lib/data";

export const metadata: Metadata = {
  title: "Career",
  description:
    "Join Paybridgex in Ahmedabad or remotely — we're hiring across engineering, design, sales, operations and compliance to build India's most trusted payment bridge."
};

const values = [
  "Merchant first, always",
  "Ship fast, settle faster",
  "Own the outcome",
  "Compliance is a feature",
  "Small team, big trust"
];

const perks = [
  { icon: Coins, title: "Competitive pay + ESOPs", text: "Own a piece of the bridge you're building." },
  { icon: HeartPulse, title: "Health cover for family", text: "You, your spouse, kids and parents." },
  { icon: Laptop, title: "Hybrid & remote friendly", text: "Ahmedabad HQ with remote-first engineering." },
  { icon: GraduationCap, title: "Quarterly learning budget", text: "Courses, books and conferences on us." },
  { icon: Plane, title: "Annual team offsite", text: "One week a year to think, bond and recharge." },
  { icon: Baby, title: "Generous parental leave", text: "For every kind of parent." }
];

const process = [
  { icon: FileText, step: "Apply", text: "Send your résumé or portfolio. No cover letter needed — your work speaks." },
  { icon: PhoneCall, step: "Intro call", text: "30 minutes with the hiring manager about the role and your story." },
  { icon: Users, step: "Skill rounds", text: "One or two practical rounds built around real Paybridgex problems." },
  { icon: Handshake, step: "Offer", text: "Decision within 5 working days of your final round. Always." }
];

const openings = [
  { title: "Senior Backend Engineer (Payments)", team: "Engineering", location: "Ahmedabad / Remote", type: "Full-time" },
  { title: "Product Designer (Retailer App)", team: "Design", location: "Ahmedabad", type: "Full-time" },
  { title: "Regional Sales Manager (Gujarat)", team: "Sales", location: "Ahmedabad", type: "Full-time" },
  { title: "Customer Success Lead", team: "Operations", location: "Ahmedabad", type: "Full-time" },
  { title: "Compliance Manager", team: "Compliance", location: "Ahmedabad", type: "Full-time" },
  { title: "Growth Marketing Intern", team: "Marketing", location: "Remote", type: "Internship" }
];

export default function CareerPage() {
  return (
    <>
      <PageHero
        eyebrow="Careers"
        title={
          <>
            Help us build{" "}
            <span className="gradient-text">India&apos;s payment bridge</span>
          </>
        }
        description="We're a young Ahmedabad company with an outsized mission: make world-class payments infrastructure available at every counter in the country. Come build it with us."
      />

      {/* Culture band with counters */}
      <div className="border-b border-ink-100 bg-white">
        <Container className="grid grid-cols-3 gap-6 py-8 text-center">
          <div>
            <p className="font-display text-3xl font-extrabold text-ink-900">
              <CountUp value={6} />
            </p>
            <p className="mt-1 text-xs font-medium uppercase tracking-wider text-ink-500">Open roles</p>
          </div>
          <div>
            <p className="font-display text-3xl font-extrabold text-ink-900">
              <CountUp value={5} suffix=" days" />
            </p>
            <p className="mt-1 text-xs font-medium uppercase tracking-wider text-ink-500">Offer turnaround</p>
          </div>
          <div>
            <p className="font-display text-3xl font-extrabold text-ink-900">
              <CountUp value={100} suffix="%" />
            </p>
            <p className="mt-1 text-xs font-medium uppercase tracking-wider text-ink-500">Interview feedback given</p>
          </div>
        </Container>
      </div>

      {/* Values marquee-style chips */}
      <Section className="bg-ink-50/40">
        <Container>
          <SectionHeading
            eyebrow="How we work"
            title="Five beliefs we hire for"
            description="Skills can be taught. These can't — bring them with you."
          />
          <Stagger stagger={0.07} className="flex flex-wrap justify-center gap-3">
            {values.map((v, i) => (
              <StaggerItem key={v} direction={i % 2 === 0 ? "up" : "down"}>
                <span className="inline-block rounded-full border border-brand-200 bg-white px-5 py-2.5 text-sm font-semibold text-brand-800 shadow-sm transition hover:-translate-y-1 hover:border-accent-300 hover:shadow-soft">
                  {v}
                </span>
              </StaggerItem>
            ))}
          </Stagger>
        </Container>
      </Section>

      {/* Perks */}
      <Section className="bg-white">
        <Container>
          <SectionHeading
            eyebrow="Perks"
            title="Taken care of, so you can build"
            align="left"
          />
          <Stagger className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {perks.map((p) => {
              const Icon = p.icon;
              return (
                <StaggerItem key={p.title}>
                  <div className="group h-full rounded-2xl border border-ink-100 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-brand-200 hover:shadow-soft">
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-50 text-accent-700 transition group-hover:rotate-6 group-hover:scale-110">
                      <Icon className="h-5 w-5" />
                    </span>
                    <h3 className="mt-4 font-display text-base font-semibold text-ink-900">{p.title}</h3>
                    <p className="mt-1 text-sm text-ink-500">{p.text}</p>
                  </div>
                </StaggerItem>
              );
            })}
          </Stagger>
        </Container>
      </Section>

      {/* Hiring process */}
      <Section className="bg-gradient-to-b from-ink-50/60 to-white">
        <Container>
          <SectionHeading
            eyebrow="Hiring process"
            title="Four steps, zero ghosting"
            description="We respect your time — every candidate hears back at every stage."
          />
          <div className="relative grid gap-6 md:grid-cols-4">
            <div className="absolute left-0 right-0 top-8 hidden h-px bg-gradient-to-r from-brand-200 via-accent-300 to-brand-200 md:block" />
            {process.map((s, i) => {
              const Icon = s.icon;
              return (
                <Reveal key={s.step} delay={i * 0.12}>
                  <div className="relative text-center">
                    <span className="relative z-10 mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-brand-100 bg-white text-brand-700 shadow-sm">
                      <Icon className="h-6 w-6" />
                      <span className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-accent-500 text-[11px] font-bold text-white">
                        {i + 1}
                      </span>
                    </span>
                    <h3 className="mt-4 font-display text-base font-semibold text-ink-900">{s.step}</h3>
                    <p className="mx-auto mt-1 max-w-[220px] text-sm text-ink-500">{s.text}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </Container>
      </Section>

      {/* Open roles */}
      <Section className="bg-white">
        <Container>
          <SectionHeading eyebrow="Open roles" title="Find your seat on the bridge" align="left" />
          <Stagger stagger={0.06} className="overflow-hidden rounded-3xl border border-ink-100 bg-white shadow-sm">
            {openings.map((j) => (
              <StaggerItem key={j.title} direction="left">
                <div className="group flex flex-col gap-4 border-b border-ink-100 p-6 transition last:border-b-0 hover:bg-brand-50/40 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-display text-base font-semibold text-ink-900 transition group-hover:text-brand-700">
                      {j.title}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-ink-500">
                      <span className="inline-flex items-center gap-1">
                        <Briefcase className="h-3.5 w-3.5" /> {j.team}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" /> {j.location}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" /> {j.type}
                      </span>
                    </div>
                  </div>
                  <a href={`mailto:careers@${company.domain}?subject=${encodeURIComponent(`Application: ${j.title}`)}`}>
                    <Button variant="outline" size="sm">
                      Apply <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </a>
                </div>
              </StaggerItem>
            ))}
          </Stagger>

          <Reveal delay={0.15}>
            <div className="mt-10 flex flex-col items-center gap-4 rounded-[2rem] bg-gradient-to-r from-brand-700 via-brand-800 to-ink-900 px-8 py-10 text-center text-white md:flex-row md:text-left">
              <div className="flex-1">
                <h2 className="font-display text-xl font-bold md:text-2xl">
                  Don&apos;t see your role?
                </h2>
                <p className="mt-1 text-sm text-white/70">
                  Great people don&apos;t always fit a listing. Tell us what you&apos;d build at Paybridgex — we read every mail.
                </p>
              </div>
              <a href={`mailto:careers@${company.domain}`}>
                <Button variant="accent" size="lg">
                  careers@{company.domain} <ArrowRight className="h-4 w-4" />
                </Button>
              </a>
            </div>
          </Reveal>
        </Container>
      </Section>
    </>
  );
}
