import Link from "next/link";
import { Store, Users, Network, Code2, Check, ArrowRight } from "lucide-react";
import { Container, Section, SectionHeading } from "@/components/ui/Container";
import { Stagger, StaggerItem } from "@/components/motion";

const roles = [
  {
    icon: Store,
    accent: "border-l-brand-500",
    chip: "bg-brand-50 text-brand-700",
    name: "Retailer",
    tagline: "Turn your counter into a mini bank.",
    points: [
      "All 60+ services from one dashboard",
      "Commission credited on every transaction",
      "Instant wallet withdrawals, 24×7"
    ],
    href: "/register"
  },
  {
    icon: Users,
    accent: "border-l-accent-500",
    chip: "bg-accent-50 text-accent-700",
    name: "Distributor",
    tagline: "Build a retailer network, earn on every layer.",
    points: [
      "Onboard retailers in minutes",
      "Override commissions on network volume",
      "One-tap fund transfers to your retailers"
    ],
    href: "/register"
  },
  {
    icon: Network,
    accent: "border-l-brand-500",
    chip: "bg-brand-50 text-brand-700",
    name: "Master Distributor",
    tagline: "Run a region-scale payments business.",
    points: [
      "Multi-distributor hierarchy & controls",
      "White-label portal on your own domain",
      "Dedicated account manager & MIS"
    ],
    href: "/contact"
  },
  {
    icon: Code2,
    accent: "border-l-accent-500",
    chip: "bg-accent-50 text-accent-700",
    name: "Platforms & developers",
    tagline: "Embed payments with our REST APIs.",
    points: [
      "Payouts, collections & verification APIs",
      "Webhooks for every transaction event",
      "Sandbox keys on request"
    ],
    href: "/contact"
  }
];

export function RolesStrip() {
  return (
    <Section className="bg-ink-50/60">
      <Container>
        <SectionHeading
          eyebrow="Who it's for"
          title="Four ways to cross the bridge"
          description="Start where you are today — every tier upgrades without re-onboarding."
        />

        <Stagger stagger={0.1} className="grid gap-5 md:grid-cols-2">
          {roles.map((role) => {
            const Icon = role.icon;
            return (
              <StaggerItem key={role.name}>
                <Link
                  href={role.href}
                  className={`group flex h-full flex-col rounded-2xl border border-ink-100 border-l-4 bg-white p-7 shadow-sm transition hover:-translate-y-1 hover:shadow-soft ${role.accent}`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`grid h-11 w-11 place-items-center rounded-xl ${role.chip}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 className="font-display text-lg font-bold text-ink-900">
                        {role.name}
                      </h3>
                      <p className="text-sm text-ink-500">{role.tagline}</p>
                    </div>
                  </div>
                  <ul className="mt-5 flex-1 space-y-2.5">
                    {role.points.map((p) => (
                      <li key={p} className="flex items-start gap-2 text-sm text-ink-600">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" />
                        {p}
                      </li>
                    ))}
                  </ul>
                  <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 transition group-hover:gap-2.5">
                    Get started <ArrowRight className="h-4 w-4" />
                  </span>
                </Link>
              </StaggerItem>
            );
          })}
        </Stagger>
      </Container>
    </Section>
  );
}
