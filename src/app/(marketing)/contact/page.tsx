import type { Metadata } from "next";
import Link from "next/link";
import {
  Mail,
  Phone,
  MapPin,
  MessageSquare,
  Headphones,
  Building2,
  ShieldAlert,
  ArrowRight,
  Clock3
} from "lucide-react";
import { Container, Section } from "@/components/ui/Container";
import { PageHero } from "@/components/PageHero";
import { Input, Label } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { company, grievanceOfficer } from "@/lib/data";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Reach Paybridgex — 24×7 retailer helpline, WhatsApp support, email and our Ahmedabad HQ at SAFAL 11, Shahibag. Average first reply in 12 minutes."
};

const channels = [
  {
    icon: Phone,
    label: "Call us 24×7",
    value: `+91 ${company.phone}`,
    sub: "Retailer & partner helpline",
    tone: "bg-brand-50 text-brand-700"
  },
  {
    icon: MessageSquare,
    label: "WhatsApp",
    value: `+91 ${company.phone}`,
    sub: "Average reply in 12 minutes",
    tone: "bg-accent-50 text-accent-700"
  },
  {
    icon: Mail,
    label: "Email",
    value: company.email,
    sub: company.supportEmail,
    tone: "bg-brand-50 text-brand-700"
  },
  {
    icon: Headphones,
    label: "Agent helpdesk",
    value: `support@${company.domain}`,
    sub: "For onboarded agents only",
    tone: "bg-accent-50 text-accent-700"
  }
];

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        title={
          <>
            Talk to a human,{" "}
            <span className="gradient-text">not a ticket queue</span>
          </>
        }
        description="Question, partnership, or a stuck transaction — pick any channel below. Our Ahmedabad support desk answers around the clock, in nine languages."
      />

      <Section className="bg-white">
        <Container>
          {/* Channel cards */}
          <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {channels.map((c, i) => {
              const Icon = c.icon;
              return (
                <StaggerItem key={c.label} direction={i % 2 === 0 ? "up" : "down"}>
                  <div className="group h-full rounded-2xl border border-ink-100 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-brand-200 hover:shadow-soft">
                    <span className={`grid h-11 w-11 place-items-center rounded-xl transition group-hover:rotate-6 group-hover:scale-110 ${c.tone}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-ink-500">
                      {c.label}
                    </p>
                    <p className="mt-1 break-all font-display text-base font-semibold text-ink-900">
                      {c.value}
                    </p>
                    <p className="text-xs text-ink-500">{c.sub}</p>
                  </div>
                </StaggerItem>
              );
            })}
          </Stagger>

          {/* Form + HQ */}
          <div className="mt-12 grid gap-10 lg:grid-cols-12">
            <Reveal direction="right" className="lg:col-span-7">
              <div className="relative overflow-hidden rounded-3xl border border-ink-100 bg-white p-8 shadow-sm">
                <div className="absolute -left-16 -top-16 h-48 w-48 rounded-full bg-brand-100/60 blur-3xl" />
                <div className="relative">
                  <h2 className="heading-md">Send us a message</h2>
                  <p className="mt-2 text-sm text-ink-500">
                    Fill the form and our team will respond within 24 hours — usually much sooner.
                  </p>
                  <form className="mt-6 grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="name">Full name</Label>
                      <Input id="name" placeholder="Your name" />
                    </div>
                    <div>
                      <Label htmlFor="phone">Phone</Label>
                      <Input id="phone" type="tel" placeholder="+91" />
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor="email">Email</Label>
                      <Input id="email" type="email" placeholder="you@company.com" />
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor="msg">How can we help?</Label>
                      <textarea
                        id="msg"
                        rows={5}
                        placeholder="Tell us a bit about your business or query..."
                        className="flex w-full rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Button type="submit" className="w-full sm:w-auto">
                        Send message <ArrowRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </form>
                </div>
              </div>
            </Reveal>

            <Reveal direction="left" delay={0.1} className="lg:col-span-5">
              <div className="overflow-hidden rounded-3xl border border-ink-100 bg-gradient-to-br from-brand-50 to-accent-50 p-8 shadow-sm">
                <h2 className="font-display text-xl font-semibold text-ink-900">
                  Visit our HQ
                </h2>
                <p className="mt-2 text-sm text-ink-700">
                  SAFAL 11, opposite Namaskar Circle in Shahibag — one of Ahmedabad&apos;s best-connected business neighbourhoods.
                </p>
                <div className="mt-6 space-y-4 text-sm text-ink-700">
                  <div className="flex items-start gap-3">
                    <Building2 className="mt-0.5 h-4 w-4 text-brand-600" />
                    <div>
                      <p className="font-semibold text-ink-900">{company.legalName}</p>
                      <p className="text-xs text-ink-500">CIN: {company.cin}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <MapPin className="mt-0.5 h-4 w-4 text-brand-600" />
                    <p>{company.address}</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <Phone className="mt-0.5 h-4 w-4 text-brand-600" />
                    <p>+91 {company.phone}</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <Clock3 className="mt-0.5 h-4 w-4 text-brand-600" />
                    <p>Office hours: Mon–Sat, 10:00–19:00 IST (helpline is 24×7)</p>
                  </div>
                </div>
                <div className="mt-6 aspect-video w-full overflow-hidden rounded-2xl border border-white/60 bg-white">
                  <iframe
                    title="Paybridgex HQ — SAFAL 11, Shahibag, Ahmedabad"
                    src="https://www.google.com/maps?q=SAFAL+11+Namaskar+Circle+Shahibag+Ahmedabad+Gujarat+380004&output=embed"
                    className="h-full w-full"
                    loading="lazy"
                  />
                </div>
              </div>
            </Reveal>
          </div>

          {/* Escalation strip */}
          <Reveal delay={0.1}>
            <div className="mt-12 flex flex-col items-start gap-5 rounded-[2rem] border border-ink-100 bg-ink-50/50 p-8 md:flex-row md:items-center">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-600 text-white shadow-glow">
                <ShieldAlert className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <h3 className="font-display text-base font-semibold text-ink-900">
                  Not happy with a resolution?
                </h3>
                <p className="mt-1 text-sm text-ink-600">
                  Escalate to our Grievance Officer at{" "}
                  <a href={`mailto:${grievanceOfficer.email}`} className="font-semibold text-brand-700 hover:underline">
                    {grievanceOfficer.email}
                  </a>
                  . Acknowledged within 24 hours, resolved within 30 days as per our{" "}
                  <Link href="/legal/grievance" className="font-semibold text-brand-700 hover:underline">
                    grievance redressal policy
                  </Link>
                  .
                </p>
              </div>
            </div>
          </Reveal>
        </Container>
      </Section>
    </>
  );
}
