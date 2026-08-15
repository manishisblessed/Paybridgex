import Link from "next/link";
import { ArrowRight, PhoneCall } from "lucide-react";
import { Container, Section } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/motion";
import { company } from "@/lib/data";

export function FinalCTA() {
  return (
    <Section className="bg-white pb-24">
      <Container>
        <Reveal>
          <div className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-brand-800 via-brand-700 to-[#0b1030] px-8 py-16 text-center text-white shadow-glow md:px-16 md:py-20">
            {/* bridge arc watermark */}
            <svg
              viewBox="0 0 800 240"
              className="pointer-events-none absolute inset-x-0 bottom-0 w-full opacity-15"
              fill="none"
              aria-hidden
            >
              <path d="M0 220 C 220 40, 580 40, 800 220" stroke="#34d399" strokeWidth="3" />
              <path d="M40 240 H760" stroke="#8db4ff" strokeWidth="3" />
              {["160", "280", "400", "520", "640"].map((x) => (
                <line key={x} x1={x} y1="90" x2={x} y2="240" stroke="#8db4ff" strokeWidth="1.5" />
              ))}
            </svg>
            <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-accent-400/20 blur-3xl" />
            <div className="pointer-events-none absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-brand-400/25 blur-3xl" />

            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-accent-300">
              {company.tagline}
            </p>
            <h2 className="mx-auto mt-4 max-w-2xl font-display text-3xl font-extrabold leading-tight md:text-5xl">
              Your counter is one bridge away from the bank.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm text-white/70 md:text-base">
              Free to join, live the same day. Bring your PAN and Aadhaar — we
              will handle the rest.
            </p>

            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link href="/register">
                <Button size="lg" variant="accent" className="!text-white">
                  Open your free account <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/contact">
                <Button
                  size="lg"
                  variant="outline"
                  className="border-white/25 bg-white/5 !text-white hover:border-accent-300/60 hover:!text-accent-200"
                >
                  <PhoneCall className="h-4 w-4" /> Talk to our team
                </Button>
              </Link>
            </div>
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}
