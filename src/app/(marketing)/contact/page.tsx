import type { Metadata } from "next";
import { Mail, Phone, MapPin, MessageSquare, Headphones, Building2 } from "lucide-react";
import { Container, Section } from "@/components/ui/Container";
import { PageHero } from "@/components/PageHero";
import { Input, Label } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { company } from "@/lib/data";

export const metadata: Metadata = {
  title: "Contact"
};

const channels = [
  {
    icon: Phone,
    label: "Call us 24×7",
    value: `+91 ${company.phone}`,
    sub: "Mon–Sun, retailer helpline"
  },
  {
    icon: Mail,
    label: "Email",
    value: company.email,
    sub: company.supportEmail
  },
  {
    icon: MessageSquare,
    label: "WhatsApp support",
    value: `+91 ${company.phone}`,
    sub: "Avg. reply in 12 minutes"
  },
  {
    icon: Headphones,
    label: "Agent helpdesk",
    value: "agent@nxtgpay.com",
    sub: "For onboarded agents only"
  }
];

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        title={<>We'd love to <span className="gradient-text">hear from you</span></>}
        description="Got a question, want to partner, or need help with a transaction? Pick a channel below and our team will get back to you in record time."
      />

      <Section className="bg-white">
        <Container>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {channels.map((c) => {
              const Icon = c.icon;
              return (
                <div
                  key={c.label}
                  className="rounded-2xl border border-ink-100 bg-white p-5 transition hover:border-brand-200 hover:shadow-soft"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-700">
                    <Icon className="h-5 w-5" />
                  </span>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-ink-500">
                    {c.label}
                  </p>
                  <p className="mt-1 font-display text-base font-semibold text-ink-900">
                    {c.value}
                  </p>
                  <p className="text-xs text-ink-500">{c.sub}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-12 grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <div className="rounded-3xl border border-ink-100 bg-white p-8 shadow-sm">
                <h2 className="heading-md">Send us a message</h2>
                <p className="mt-2 text-sm text-ink-500">
                  Fill the form and our team will respond within 24 hours.
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
                      Send message
                    </Button>
                  </div>
                </form>
              </div>
            </div>

            <div className="lg:col-span-5">
              <div className="overflow-hidden rounded-3xl border border-ink-100 bg-gradient-to-br from-brand-50 to-accent-50 p-8 shadow-sm">
                <h2 className="font-display text-xl font-semibold text-ink-900">
                  Visit our HQ
                </h2>
                <p className="mt-2 text-sm text-ink-700">
                  At Devi Arcade on Ashwini Kumar Road — in the heart of Surat's bustling commercial district.
                </p>
                <div className="mt-6 space-y-4 text-sm text-ink-700">
                  <div className="flex items-start gap-3">
                    <Building2 className="mt-0.5 h-4 w-4 text-brand-600" />
                    <div>
                      <p className="font-semibold text-ink-900">
                        {company.legalName}
                      </p>
                      <p className="text-xs text-ink-500">
                        CIN: {company.cin}
                      </p>
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
                    <Mail className="mt-0.5 h-4 w-4 text-brand-600" />
                    <p>{company.email}</p>
                  </div>
                </div>
                <div className="mt-6 aspect-video w-full overflow-hidden rounded-2xl border border-white/60 bg-white">
                  <iframe
                    title="JMP NextGenPay HQ — Devi Arcade, Ashwini Kumar Road, Surat"
                    src="https://www.google.com/maps?q=Devi+Arcade+Ashwini+Kumar+Road+Surat+Gujarat+395008&output=embed"
                    className="h-full w-full"
                    loading="lazy"
                  />
                </div>
              </div>
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
