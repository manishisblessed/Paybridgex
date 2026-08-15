import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Landmark, Smartphone, Receipt, Plane, Wallet, Zap } from "lucide-react";
import { Container, Section } from "@/components/ui/Container";
import { PageHero } from "@/components/PageHero";
import { Button } from "@/components/ui/Button";
import { Reveal, Stagger, StaggerItem, CountUp } from "@/components/motion";
import { services } from "@/lib/data";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Services",
  description:
    "60+ digital services — AePS, money transfer, UPI QR, BBPS bills, recharges and travel — on one Paybridgex dashboard with instant settlement."
};

const categories = [
  {
    id: "banking",
    label: "Banking & Payments",
    icon: Landmark,
    blurb: "The money-movement core — collect, transfer and withdraw on regulated rails.",
    chip: "bg-brand-50 text-brand-700"
  },
  {
    id: "recharge",
    label: "Recharges",
    icon: Smartphone,
    blurb: "Prepaid mobile, DTH and broadband top-ups with operator-direct routing.",
    chip: "bg-accent-50 text-accent-700"
  },
  {
    id: "bills",
    label: "Bill Payments",
    icon: Receipt,
    blurb: "1,200+ live BBPS billers — utilities, credit cards, fees and premiums.",
    chip: "bg-brand-50 text-brand-700"
  },
  {
    id: "travel",
    label: "Travel Bookings",
    icon: Plane,
    blurb: "Flights, buses and hotels at agent rates, booked from your counter.",
    chip: "bg-accent-50 text-accent-700"
  }
];

const bandStats = [
  { value: 60, suffix: "+", label: "Live services" },
  { value: 1200, suffix: "+", label: "BBPS billers" },
  { value: 24, suffix: "×7", label: "Wallet withdrawals" },
  { value: 99.97, suffix: "%", decimals: 2, label: "Platform uptime" }
];

export default function ServicesPage() {
  return (
    <>
      <PageHero
        eyebrow="Service catalogue"
        title={
          <>
            Sixty businesses,{" "}
            <span className="gradient-text">one counter</span>
          </>
        }
        description="Every service below runs on the same wallet, the same ledger and the same instant-settlement promise. Switch any of them on from day one — no extra paperwork."
      />

      {/* Animated stats band */}
      <div className="border-b border-ink-100 bg-white">
        <Container className="grid grid-cols-2 gap-y-6 py-8 md:grid-cols-4">
          {bandStats.map((s) => (
            <div key={s.label} className="text-center">
              <p className="font-display text-3xl font-extrabold text-ink-900 md:text-4xl">
                <CountUp value={s.value} suffix={s.suffix} decimals={s.decimals ?? 0} />
              </p>
              <p className="mt-1 text-xs font-medium uppercase tracking-wider text-ink-500">
                {s.label}
              </p>
            </div>
          ))}
        </Container>
      </div>

      <Section className="bg-ink-50/40">
        <Container>
          <div className="grid gap-10 lg:grid-cols-12">
            {/* Sticky category rail */}
            <aside className="hidden lg:col-span-3 lg:block">
              <div className="sticky top-28 space-y-2">
                <p className="px-4 pb-2 text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">
                  Jump to
                </p>
                {categories.map((cat) => {
                  const Icon = cat.icon;
                  return (
                    <a
                      key={cat.id}
                      href={`#${cat.id}`}
                      className="group flex items-center gap-3 rounded-2xl border border-transparent bg-transparent px-4 py-3 transition hover:border-ink-100 hover:bg-white hover:shadow-sm"
                    >
                      <span className={cn("grid h-9 w-9 place-items-center rounded-xl transition group-hover:scale-105", cat.chip)}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="text-sm font-semibold text-ink-700 group-hover:text-ink-900">
                        {cat.label}
                      </span>
                    </a>
                  );
                })}
                <div className="mt-6 rounded-2xl bg-gradient-to-br from-brand-700 to-brand-900 p-5 text-white">
                  <Wallet className="h-5 w-5 text-accent-300" />
                  <p className="mt-3 text-sm font-semibold">One wallet powers it all</p>
                  <p className="mt-1 text-xs text-white/65">
                    Top up once, transact everywhere, settle to your bank 24×7.
                  </p>
                  <Link href="/register" className="mt-4 inline-block">
                    <Button size="sm" variant="accent" className="!text-white">
                      Get started <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </div>
              </div>
            </aside>

            {/* Category sections */}
            <div className="space-y-14 lg:col-span-9">
              {categories.map((cat, ci) => {
                const items = services.filter((s) => s.category === cat.id);
                if (!items.length) return null;
                const Icon = cat.icon;
                return (
                  <div key={cat.id} id={cat.id} className="scroll-mt-28">
                    <Reveal>
                      <div className="flex items-center gap-4">
                        <span className={cn("grid h-12 w-12 place-items-center rounded-2xl", cat.chip)}>
                          <Icon className="h-5 w-5" />
                        </span>
                        <div>
                          <h2 className="font-display text-2xl font-bold text-ink-900">
                            {cat.label}
                          </h2>
                          <p className="text-sm text-ink-500">{cat.blurb}</p>
                        </div>
                      </div>
                    </Reveal>

                    <Stagger stagger={0.06} className="mt-6 grid gap-4 sm:grid-cols-2">
                      {items.map((s) => {
                        const SIcon = s.icon;
                        return (
                          <StaggerItem key={s.slug} direction={ci % 2 === 0 ? "up" : "left"}>
                            <Link
                              id={s.slug}
                              href={s.href}
                              className="group flex h-full items-start gap-4 rounded-2xl border border-ink-100 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-brand-200 hover:shadow-soft"
                            >
                              <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl transition group-hover:rotate-6 group-hover:scale-110", cat.chip)}>
                                <SIcon className="h-5 w-5" />
                              </span>
                              <div className="flex-1">
                                <div className="flex items-start justify-between gap-2">
                                  <h3 className="font-display text-base font-semibold text-ink-900">
                                    {s.title}
                                  </h3>
                                  {s.badge && (
                                    <span className="animate-pulse rounded-full bg-accent-100 px-2 py-0.5 text-[10px] font-semibold text-accent-700">
                                      {s.badge}
                                    </span>
                                  )}
                                </div>
                                <p className="mt-1 text-sm text-ink-500">{s.description}</p>
                                <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 transition group-hover:gap-2">
                                  Open service <ArrowRight className="h-3 w-3" />
                                </span>
                              </div>
                            </Link>
                          </StaggerItem>
                        );
                      })}
                    </Stagger>
                  </div>
                );
              })}
            </div>
          </div>
        </Container>
      </Section>

      {/* Settlement promise strip */}
      <Section className="bg-white pt-0">
        <Container>
          <Reveal>
            <div className="flex flex-col items-center gap-6 rounded-[2rem] border border-accent-100 bg-gradient-to-r from-accent-50 via-white to-brand-50 px-8 py-10 text-center md:flex-row md:text-left">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-accent-500 text-white shadow-glow">
                <Zap className="h-6 w-6" />
              </span>
              <div className="flex-1">
                <h2 className="font-display text-xl font-bold text-ink-900 md:text-2xl">
                  Whichever service you run, settlement works the same way — instantly.
                </h2>
                <p className="mt-1 text-sm text-ink-600">
                  T+0 IMPS for AePS and wallet withdrawals · T+1 for gateway and card volumes · one downloadable ledger for everything.
                </p>
              </div>
              <Link href="/register">
                <Button size="lg">
                  Activate all services <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </Reveal>
        </Container>
      </Section>
    </>
  );
}
