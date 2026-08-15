import Link from "next/link";
import { ArrowRight, Store, Landmark, ShieldCheck, Zap, Fingerprint, QrCode, Send, Receipt } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { LogoMark } from "@/components/layout/Logo";

const floatingChips = [
  { label: "AePS", icon: Fingerprint, className: "left-[6%] top-[14%]", delay: "0s" },
  { label: "UPI QR", icon: QrCode, className: "right-[8%] top-[10%]", delay: "1.2s" },
  { label: "DMT", icon: Send, className: "left-[12%] bottom-[30%]", delay: "2.1s" },
  { label: "BBPS", icon: Receipt, className: "right-[13%] bottom-[34%]", delay: "0.7s" }
];

const heroFigures = [
  { value: "60+", label: "Services on one login" },
  { value: "1,200+", label: "Live BBPS billers" },
  { value: "T+0", label: "Instant settlement" },
  { value: "99.97%", label: "Platform uptime" }
];

/**
 * Landing hero — dark, centred, built around the Paybridgex "bridge" identity.
 * A live SVG shows payments flowing from the shop, across the bridge, to the bank.
 */
export function BridgeHero() {
  return (
    <section className="relative isolate overflow-hidden bg-[#0b1030] text-white">
      {/* Ambient colour — royal blue + emerald glows on deep navy */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-[-20%] h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-brand-600/30 blur-[140px]" />
        <div className="absolute bottom-[-30%] left-[-10%] h-[420px] w-[520px] rounded-full bg-accent-500/20 blur-[130px]" />
        <div className="absolute bottom-[-20%] right-[-10%] h-[420px] w-[520px] rounded-full bg-brand-500/20 blur-[130px]" />
        <div className="absolute inset-0 opacity-[0.12] [background-image:linear-gradient(to_right,rgba(255,255,255,0.35)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.35)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(60%_60%_at_50%_40%,black,transparent)]" />
      </div>

      <div className="container-x flex flex-col items-center pb-10 pt-20 text-center md:pt-28">
        <span className="inline-flex items-center gap-2 rounded-full border border-accent-400/40 bg-accent-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-accent-300 animate-fade-up">
          Smart Payments · Trusted Solutions
        </span>

        <h1 className="mt-6 max-w-4xl font-display text-4xl font-extrabold leading-[1.08] tracking-tight animate-fade-up [animation-delay:80ms] md:text-6xl lg:text-7xl">
          Every payment
          <br />
          <span className="bg-gradient-to-r from-brand-300 via-accent-300 to-brand-300 bg-[length:200%_auto] bg-clip-text text-transparent animate-gradient-x">
            finds its way home.
          </span>
        </h1>

        <p className="mt-6 max-w-2xl text-base leading-relaxed text-white/70 animate-fade-up [animation-delay:160ms] md:text-lg">
          Paybridgex is the bridge between your counter and India&apos;s payment
          rails. Collect on UPI, cards, AePS and BBPS — and watch the money land
          in your bank, instantly.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3 animate-fade-up [animation-delay:240ms]">
          <Link href="/register">
            <Button size="lg" variant="accent" className="!text-white">
              Open your free account
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/services">
            <Button
              size="lg"
              variant="outline"
              className="border-white/20 bg-white/5 !text-white hover:border-accent-300/50 hover:!text-accent-200"
            >
              Explore 60+ services
            </Button>
          </Link>
        </div>
        <p className="mt-4 flex items-center gap-2 text-xs text-white/50 animate-fade-up [animation-delay:300ms]">
          <ShieldCheck className="h-3.5 w-3.5 text-accent-400" />
          Zero joining fee · Paperless KYC · RBI-licensed partner banks
        </p>
      </div>

      {/* ── The bridge — payments flow from shop to bank ─────────────────── */}
      <div className="container-x relative pb-16 md:pb-20">
        {floatingChips.map((chip) => {
          const Icon = chip.icon;
          return (
            <span
              key={chip.label}
              className={`absolute z-10 hidden items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/85 backdrop-blur-sm animate-float md:inline-flex ${chip.className}`}
              style={{ animationDelay: chip.delay }}
            >
              <Icon className="h-3.5 w-3.5 text-accent-300" />
              {chip.label}
            </span>
          );
        })}

        <div className="relative mx-auto max-w-4xl">
          <svg viewBox="0 0 800 240" fill="none" className="w-full" role="img" aria-label="Payments flow from the shop, across the Paybridgex bridge, to the bank">
            <defs>
              <linearGradient id="bh-arc" x1="0" y1="0" x2="800" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#578bfc" />
                <stop offset="0.5" stopColor="#34d399" />
                <stop offset="1" stopColor="#578bfc" />
              </linearGradient>
            </defs>

            {/* deck */}
            <path d="M60 200 H740" stroke="rgba(255,255,255,0.18)" strokeWidth="3" strokeLinecap="round" />
            {/* main arc */}
            <path id="bh-path" d="M60 200 C 220 60, 580 60, 740 200" stroke="url(#bh-arc)" strokeWidth="3.5" strokeLinecap="round" />
            {/* cables */}
            {[
              ["170", "128"], ["260", "94"], ["350", "78"], ["450", "78"], ["540", "94"], ["630", "128"]
            ].map(([x, y]) => (
              <line key={x} x1={x} y1={y} x2={x} y2="200" stroke="rgba(255,255,255,0.14)" strokeWidth="2" strokeLinecap="round" />
            ))}

            {/* payment pulses travelling across the bridge */}
            {[0, 2.6, 5.2].map((delay, i) => (
              <circle key={i} r="6" fill={i === 1 ? "#34d399" : "#8db4ff"}>
                <animateMotion dur="7.8s" begin={`${delay}s`} repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear">
                  <mpath href="#bh-path" />
                </animateMotion>
              </circle>
            ))}
          </svg>

          {/* endpoints + centre pylon */}
          <div className="pointer-events-none absolute inset-x-0 bottom-[6%] flex items-end justify-between px-[2%]">
            <div className="flex flex-col items-center gap-2">
              <span className="grid h-12 w-12 place-items-center rounded-2xl border border-white/15 bg-white/10 backdrop-blur-sm md:h-14 md:w-14">
                <Store className="h-5 w-5 text-brand-300 md:h-6 md:w-6" />
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-widest text-white/60">Your shop</span>
            </div>
            <div className="flex -translate-y-10 flex-col items-center gap-2 md:-translate-y-14">
              <span className="grid h-14 w-14 place-items-center rounded-2xl border border-accent-400/40 bg-[#0e1740] shadow-[0_0_50px_rgba(52,211,153,0.35)] md:h-16 md:w-16">
                <LogoMark size={44} variant="light" />
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-widest text-accent-300">Paybridgex</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <span className="grid h-12 w-12 place-items-center rounded-2xl border border-white/15 bg-white/10 backdrop-blur-sm md:h-14 md:w-14">
                <Landmark className="h-5 w-5 text-accent-300 md:h-6 md:w-6" />
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-widest text-white/60">Your bank</span>
            </div>
          </div>
        </div>
      </div>

      {/* figures strip */}
      <div className="border-t border-white/10 bg-white/[0.03]">
        <div className="container-x grid grid-cols-2 divide-white/10 py-6 md:grid-cols-4 md:divide-x">
          {heroFigures.map((f) => (
            <div key={f.label} className="flex flex-col items-center gap-1 py-2 text-center">
              <span className="inline-flex items-center gap-1.5 font-display text-2xl font-bold md:text-3xl">
                {f.value === "T+0" && <Zap className="h-5 w-5 text-accent-400" />}
                {f.value}
              </span>
              <span className="text-xs text-white/55">{f.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
