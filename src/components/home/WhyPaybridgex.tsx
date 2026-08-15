import Link from "next/link";
import {
  Zap,
  IndianRupee,
  ShieldCheck,
  Headphones,
  Wifi,
  BookOpenCheck,
  ArrowRight
} from "lucide-react";
import { Container, Section } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";

const reasons = [
  {
    icon: Zap,
    tone: "text-brand-600 bg-brand-50",
    title: "Settlement you can set your watch by",
    text: "T+0 IMPS for AePS and wallet withdrawals, T+1 for gateway volumes. Money never sleeps in someone else's account."
  },
  {
    icon: IndianRupee,
    tone: "text-accent-700 bg-accent-50",
    title: "Commissions with no fine print",
    text: "Every slab is published in your dashboard before you transact. What you see is what lands in your wallet — down to the paisa."
  },
  {
    icon: ShieldCheck,
    tone: "text-brand-600 bg-brand-50",
    title: "Bank-grade security by default",
    text: "Two-factor logins, encrypted PII, risk-scored transactions and RBI-licensed partner banks under every rupee that moves."
  },
  {
    icon: Headphones,
    tone: "text-accent-700 bg-accent-50",
    title: "Support that speaks your language",
    text: "Real humans in Hindi, Gujarati, English and six more languages — on WhatsApp, phone and in-app tickets."
  },
  {
    icon: Wifi,
    tone: "text-brand-600 bg-brand-50",
    title: "Built for the slowest network in town",
    text: "Offline queueing and smart retries keep your counter running on 2G, in a power cut, at month-end peak."
  },
  {
    icon: BookOpenCheck,
    tone: "text-accent-700 bg-accent-50",
    title: "One ledger for everything",
    text: "Every service, commission, refund and settlement lands in a single downloadable statement. GST-ready, dispute-ready."
  }
];

export function WhyPaybridgex() {
  return (
    <Section className="bg-white">
      <Container>
        <div className="grid gap-12 lg:grid-cols-12">
          {/* Sticky intro column */}
          <div className="lg:col-span-4">
            <div className="lg:sticky lg:top-28">
              <Reveal>
                <span className="eyebrow">Why Paybridgex</span>
                <h2 className="heading-lg mt-4">
                  Trust is a feature.{" "}
                  <span className="gradient-text">We ship it daily.</span>
                </h2>
                <p className="lead mt-5">
                  Anyone can list sixty services. The difference is what happens
                  after you press pay — and that is where we obsess.
                </p>
                <Link href="/about" className="mt-8 inline-block">
                  <Button variant="outline">
                    Read our story <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </Reveal>
            </div>
          </div>

          {/* Feature rows */}
          <div className="lg:col-span-8">
            <Stagger stagger={0.08} className="divide-y divide-ink-100">
              {reasons.map((r) => {
                const Icon = r.icon;
                return (
                  <StaggerItem key={r.title}>
                    <div className="group flex gap-5 py-7 first:pt-0 last:pb-0">
                      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl transition group-hover:scale-105 ${r.tone}`}>
                        <Icon className="h-5 w-5" />
                      </span>
                      <div>
                        <h3 className="font-display text-lg font-bold text-ink-900">
                          {r.title}
                        </h3>
                        <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-600">
                          {r.text}
                        </p>
                      </div>
                    </div>
                  </StaggerItem>
                );
              })}
            </Stagger>
          </div>
        </div>
      </Container>
    </Section>
  );
}
