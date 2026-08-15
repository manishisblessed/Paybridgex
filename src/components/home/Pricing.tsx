"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { Container, Section, SectionHeading } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { pricingPlans } from "@/lib/data";
import { cn } from "@/lib/utils";

export function Pricing() {
  return (
    <Section id="pricing" className="bg-ink-50/50">
      <Container>
        <Reveal>
          <SectionHeading
            eyebrow="Pricing"
            title="Economical pricing for every retailer"
            description="Pick a plan that fits your business — upgrade as you grow. Cancel anytime, no questions asked."
          />
        </Reveal>

        <Stagger stagger={0.12} className="grid gap-6 lg:grid-cols-3">
          {pricingPlans.map((plan) => (
            <StaggerItem key={plan.name}>
              <div
                className={cn(
                  "group relative flex h-full flex-col rounded-3xl border bg-white p-8 shadow-sm transition-all duration-500",
                  plan.highlighted
                    ? "border-brand-300 shadow-glow ring-1 ring-brand-200 hover:-translate-y-2 hover:shadow-[0_30px_60px_-20px_rgba(66,99,199,0.55)] lg:-translate-y-2 lg:scale-[1.03]"
                    : "border-ink-100 hover:-translate-y-1.5 hover:border-brand-200 hover:shadow-soft"
                )}
              >
                {plan.highlighted && (
                  <>
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-brand-600 to-accent-500 px-3 py-1 text-xs font-semibold text-white shadow-soft">
                      Most popular
                    </span>
                    <span className="pointer-events-none absolute -inset-1 -z-10 rounded-[28px] bg-gradient-to-br from-brand-400/20 via-violet-400/10 to-accent-400/20 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100" />
                  </>
                )}
                <div>
                  <p className="font-display text-lg font-semibold text-ink-900">
                    {plan.name}
                  </p>
                  <p className="mt-1 text-sm text-ink-500">{plan.description}</p>
                  <div className="mt-6 flex items-baseline gap-1">
                    <span className="font-display text-4xl font-bold text-ink-900 transition-transform duration-500 origin-left group-hover:scale-110">
                      {plan.price}
                    </span>
                    <span className="text-sm text-ink-500">{plan.cadence}</span>
                  </div>
                </div>

                <ul className="mt-8 flex-1 space-y-3 text-sm">
                  {plan.features.map((f, i) => (
                    <li
                      key={f}
                      className="flex items-start gap-2 text-ink-700 transition-transform duration-300 group-hover:translate-x-0.5"
                      style={{ transitionDelay: `${i * 30}ms` }}
                    >
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      {f}
                    </li>
                  ))}
                </ul>

                <div className="mt-8">
                  <Link href="/register">
                    <Button
                      variant={plan.highlighted ? "primary" : "outline"}
                      className="w-full"
                    >
                      {plan.cta}
                    </Button>
                  </Link>
                </div>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </Container>
    </Section>
  );
}
