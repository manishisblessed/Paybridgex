import { ShieldCheck, Lock, FileCheck2 } from "lucide-react";
import { Container, Section } from "@/components/ui/Container";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { footerCertifications } from "@/lib/data";

const pillars = [
  {
    icon: ShieldCheck,
    title: "Regulated rails only",
    text: "Every rupee moves through RBI-licensed sponsor banks and NPCI-certified switches — never through shortcuts."
  },
  {
    icon: Lock,
    title: "Your data stays in India",
    text: "Payment data is stored on Indian soil per RBI's data-localisation mandate, encrypted at rest with AES-256."
  },
  {
    icon: FileCheck2,
    title: "Audited, not assumed",
    text: "Annual VAPT by CERT-In empanelled auditors, PMLA transaction monitoring and DPDP-aligned consent for every field."
  }
];

export function ComplianceBand() {
  return (
    <Section className="bg-[#0b1030] text-white">
      <Container>
        <div className="grid gap-12 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-5">
            <Reveal>
              <span className="inline-flex items-center gap-2 rounded-full border border-accent-400/40 bg-accent-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-accent-300">
                Compliance first
              </span>
              <h2 className="mt-5 font-display text-3xl font-bold leading-tight md:text-4xl">
                A bridge is only as good as{" "}
                <span className="bg-gradient-to-r from-brand-300 to-accent-300 bg-clip-text text-transparent">
                  what holds it up.
                </span>
              </h2>
              <p className="mt-5 text-white/65">
                Paybridgex is engineered on regulated Indian payment
                infrastructure, with security and compliance reviewed before a
                single customer-facing feature ships.
              </p>

              <div className="mt-8 flex flex-wrap gap-2">
                {footerCertifications.map((c) => (
                  <span
                    key={c}
                    className="rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-semibold text-white/75"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </Reveal>
          </div>

          <div className="lg:col-span-7">
            <Stagger stagger={0.1} className="grid gap-4">
              {pillars.map((p) => {
                const Icon = p.icon;
                return (
                  <StaggerItem key={p.title}>
                    <div className="flex gap-5 rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm transition hover:border-accent-400/30 hover:bg-white/[0.07]">
                      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-500/30 to-accent-500/30 text-accent-300">
                        <Icon className="h-5 w-5" />
                      </span>
                      <div>
                        <h3 className="font-display text-lg font-bold">{p.title}</h3>
                        <p className="mt-1.5 text-sm leading-relaxed text-white/60">
                          {p.text}
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
