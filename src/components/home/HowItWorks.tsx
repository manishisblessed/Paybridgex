import { UserPlus, ArrowLeftRight, Banknote, ArrowRight } from "lucide-react";
import Link from "next/link";
import { Container, Section, SectionHeading } from "@/components/ui/Container";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";

const steps = [
  {
    icon: UserPlus,
    tone: "bg-brand-50 text-brand-700 ring-brand-100",
    title: "Cross over in minutes",
    text: "Register with PAN + Aadhaar, finish paperless video KYC and get your live dashboard the same day. No joining fee, no paperwork couriered anywhere.",
    foot: "Avg. onboarding — under 10 minutes"
  },
  {
    icon: ArrowLeftRight,
    tone: "bg-accent-50 text-accent-700 ring-accent-100",
    title: "Transact on every rail",
    text: "AePS, UPI QR, DMT, BBPS bills, recharges, travel, PG and POS — 60+ services routed through one wallet and one ledger, with commission credited per transaction.",
    foot: "One balance powers everything"
  },
  {
    icon: Banknote,
    tone: "bg-brand-50 text-brand-700 ring-brand-100",
    title: "Settle to your bank, instantly",
    text: "T+0 IMPS settlement for AePS and wallet withdrawals, T+1 for card and gateway volumes. Every rupee reconciled and visible in real time.",
    foot: "24×7 withdrawals, even on holidays"
  }
];

export function HowItWorks() {
  return (
    <Section className="bg-white">
      <Container>
        <SectionHeading
          eyebrow="How the bridge works"
          title="Counter to bank, in three moves"
          description="No franchise agents, no branch visits, no waiting for cycles. The whole journey is digital — and it starts today."
        />

        <Stagger stagger={0.12} className="relative grid gap-6 lg:grid-cols-3">
          {/* connecting line (desktop) */}
          <div className="pointer-events-none absolute left-[16%] right-[16%] top-9 hidden border-t-2 border-dashed border-ink-200 lg:block" />

          {steps.map((s, i) => {
            const Icon = s.icon;
            return (
              <StaggerItem key={s.title}>
                <div className="relative flex h-full flex-col rounded-3xl border border-ink-100 bg-white p-7 shadow-sm transition hover:-translate-y-1 hover:shadow-soft">
                  <div className="flex items-center justify-between">
                    <span className={`relative z-10 grid h-14 w-14 place-items-center rounded-2xl ring-8 ring-inset ${s.tone}`}>
                      <Icon className="h-6 w-6" />
                    </span>
                    <span className="font-display text-5xl font-extrabold text-ink-100">
                      0{i + 1}
                    </span>
                  </div>
                  <h3 className="mt-6 font-display text-xl font-bold text-ink-900">
                    {s.title}
                  </h3>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-ink-600">
                    {s.text}
                  </p>
                  <p className="mt-5 border-t border-ink-100 pt-4 text-xs font-semibold uppercase tracking-wider text-accent-700">
                    {s.foot}
                  </p>
                </div>
              </StaggerItem>
            );
          })}
        </Stagger>

        <Reveal delay={0.2} className="mt-10 text-center">
          <Link
            href="/register"
            className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:text-brand-800"
          >
            Start step one now <ArrowRight className="h-4 w-4" />
          </Link>
        </Reveal>
      </Container>
    </Section>
  );
}
