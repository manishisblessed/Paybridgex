import Link from "next/link";
import {
  Mail,
  MapPin,
  Phone,
  Facebook,
  Twitter,
  Instagram,
  Linkedin,
  Youtube,
  ShieldCheck,
  ArrowRight
} from "lucide-react";
import { Logo } from "./Logo";
import { Container } from "@/components/ui/Container";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  footerLinks,
  footerCertifications,
  company,
  grievanceOfficer
} from "@/lib/data";

export function Footer() {
  return (
    <footer className="relative border-t border-white/5 bg-ink-950 text-ink-200">
      <div className="absolute inset-0 -z-10 bg-grid-pattern opacity-[0.04]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-brand-500/40 to-transparent" />

      {/* COMPLIANCE STRIP */}
      <div className="border-b border-white/10 bg-white/[0.02]">
        <Container className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 py-3 text-[11px] font-medium uppercase tracking-widest text-ink-300/80">
          {footerCertifications.map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400/80" />
              {c}
            </span>
          ))}
        </Container>
      </div>

      {/* MAIN GRID */}
      <Container className="py-14 md:py-16">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-12 lg:gap-10">
          {/* Brand + newsletter */}
          <div className="md:col-span-2 lg:col-span-4">
            <Logo variant="light" />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-ink-400">
              NextGenPay simplifies high-end fintech so anyone — from a village
              kirana to an urban distributor — can offer 60+ digital services
              and grow with us. Engineered in Bharat, certified by India.
            </p>

            <div className="mt-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400">
                Get the monthly Bharat-fintech briefing
              </p>
              <form className="mt-3 flex w-full max-w-md flex-col gap-2 sm:flex-row">
                <Input
                  type="email"
                  placeholder="you@email.com"
                  aria-label="Email address"
                  className="h-11 flex-1 border-white/10 bg-white/5 text-white placeholder:text-ink-500 focus:border-brand-400"
                />
                <Button type="submit" variant="accent" className="h-11 shrink-0">
                  Subscribe
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </form>
              <p className="mt-2 text-[11px] text-ink-500">
                We respect your inbox. Unsubscribe anytime. Read our{" "}
                <Link
                  href="/legal/privacy"
                  className="underline-offset-2 hover:text-ink-200 hover:underline"
                >
                  Privacy Policy
                </Link>
                .
              </p>
            </div>
          </div>

          {/* Link columns */}
          <FooterColumn title="Company" links={footerLinks.company} />
          <FooterColumn title="Services" links={footerLinks.services} />
          <FooterColumn title="Resources" links={footerLinks.resources} />
          <FooterColumn title="Legal" links={footerLinks.legal} />
        </div>

        {/* CONTACT BAND */}
        <div className="mt-12 grid gap-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6 md:grid-cols-3 md:p-7">
          <ContactItem
            icon={MapPin}
            label="Registered office"
            value={
              <>
                {company.legalName}
                <br />
                {company.address}
              </>
            }
          />
          <ContactItem
            icon={Phone}
            label="Customer support · 10 AM – 6 PM IST"
            value={
              <a
                href={`tel:+91${company.phone}`}
                className="hover:text-white"
              >
                +91 {company.phone}
              </a>
            }
          />
          <ContactItem
            icon={Mail}
            label="Email us"
            value={
              <a
                href={`mailto:${company.email}`}
                className="break-all hover:text-white"
              >
                {company.email}
              </a>
            }
          />
        </div>

        {/* GRIEVANCE STRIP */}
        <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-white/10 bg-gradient-to-r from-brand-900/40 via-ink-900 to-accent-900/30 p-5 text-sm text-ink-200 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-300">
              Grievance Redressal · IT Rules 2021
            </p>
            <p className="mt-1 text-ink-300">
              <span className="font-medium text-white">
                {grievanceOfficer.name}
              </span>{" "}
              · {grievanceOfficer.designation}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-300">
            <a
              href={`mailto:${grievanceOfficer.email}`}
              className="inline-flex items-center gap-1.5 hover:text-white"
            >
              <Mail className="h-3.5 w-3.5 text-brand-300" />
              {grievanceOfficer.email}
            </a>
            <span className="inline-flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 text-brand-300" />
              {grievanceOfficer.phone}
            </span>
            <Link
              href="/legal/grievance"
              className="inline-flex items-center gap-1 font-semibold text-accent-300 hover:text-accent-200"
            >
              Read policy <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {/* BOTTOM BAR */}
        <div className="mt-10 flex flex-col items-start justify-between gap-6 border-t border-white/10 pt-6 md:flex-row md:items-center">
          <div className="text-xs leading-relaxed text-ink-500">
            <p>
              © {new Date().getFullYear()} {company.legalName}. All rights
              reserved.
            </p>
            <p className="mt-1">
              CIN: {company.cin} · GSTIN: {company.gstin} · Incorporated{" "}
              {company.incorporated}, {company.jurisdiction}.
            </p>
          </div>

          <p className="text-xs text-ink-500 md:text-center">
            Technology partner —{" "}
            <a
              href="https://www.shahworks.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-ink-300 underline-offset-2 transition hover:text-white hover:underline"
            >
              Shah Works
            </a>
          </p>

          <div className="flex items-center gap-3 text-ink-400">
            <SocialLink href="#" label="Twitter" icon={Twitter} />
            <SocialLink href="#" label="Facebook" icon={Facebook} />
            <SocialLink href="#" label="Instagram" icon={Instagram} />
            <SocialLink href="#" label="LinkedIn" icon={Linkedin} />
            <SocialLink href="#" label="YouTube" icon={Youtube} />
          </div>
        </div>
      </Container>
    </footer>
  );
}

function FooterColumn({
  title,
  links
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div className="lg:col-span-2">
      <h4 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
        {title}
      </h4>
      <ul className="space-y-3 text-sm">
        {links.map((l) => (
          <li key={l.label}>
            <Link
              href={l.href}
              className="text-ink-400 transition hover:text-white"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ContactItem({
  icon: Icon,
  label,
  value
}: {
  icon: typeof MapPin;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-500/15 text-brand-300">
        <Icon className="h-4 w-4" />
      </span>
      <div className="text-sm leading-relaxed text-ink-300">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-500">
          {label}
        </p>
        <div className="mt-1 text-ink-200">{value}</div>
      </div>
    </div>
  );
}

function SocialLink({
  href,
  label,
  icon: Icon
}: {
  href: string;
  label: string;
  icon: typeof Twitter;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-ink-300 transition hover:border-white/30 hover:bg-white/10 hover:text-white"
    >
      <Icon className="h-4 w-4" />
    </a>
  );
}
