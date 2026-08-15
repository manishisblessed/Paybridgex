"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { motion } from "framer-motion";
import {
  Eye,
  EyeOff,
  ShieldCheck,
  Store,
  Users,
  Network,
  Crown,
  ArrowRight,
  AlertCircle,
  Clock,
  Landmark,
  Zap,
  Fingerprint,
  QrCode,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { LogoMark } from "@/components/layout/Logo";
import { TwoFactorStep } from "@/components/auth/TwoFactorStep";
import { LocationGate, type LocationData } from "@/components/auth/LocationGate";
import { Turnstile, captchaConfigured } from "@/components/security/Turnstile";
import { cn } from "@/lib/utils";

type PublicRole = "retailer" | "distributor" | "master-distributor" | "super-distributor";

const roleOptions: { id: PublicRole; label: string; icon: typeof Store; tagline: string }[] = [
  { id: "retailer", label: "Retailer", icon: Store, tagline: "Run a single shop" },
  { id: "distributor", label: "Distributor", icon: Users, tagline: "Manage retailers" },
  { id: "master-distributor", label: "Master Dist.", icon: Network, tagline: "White-label & API" },
  { id: "super-distributor", label: "Super Dist.", icon: Crown, tagline: "Multi-state network" },
];

const panelFigures = [
  { value: "60+", label: "Services" },
  { value: "T+0", label: "Settlement" },
  { value: "99.97%", label: "Uptime" },
];

/** Dark brand panel with the animated Paybridgex bridge — shared by both login steps. */
function BrandPanel({
  eyebrow,
  title,
  text,
  points,
}: {
  eyebrow: string;
  title: React.ReactNode;
  text: string;
  points: string[];
}) {
  return (
    <div className="relative hidden flex-col justify-between overflow-hidden rounded-[2rem] bg-[#0b1030] p-10 text-white lg:flex">
      {/* ambient glows + grid, same language as the landing hero */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-30%] h-[380px] w-[520px] -translate-x-1/2 rounded-full bg-brand-600/30 blur-[120px]" />
        <div className="absolute bottom-[-25%] left-[-15%] h-[300px] w-[360px] rounded-full bg-accent-500/20 blur-[110px]" />
        <div className="absolute inset-0 opacity-[0.1] [background-image:linear-gradient(to_right,rgba(255,255,255,0.35)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.35)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(70%_70%_at_50%_35%,black,transparent)]" />
      </div>

      <div className="relative">
        <span className="inline-flex items-center gap-2 rounded-full border border-accent-400/40 bg-accent-500/10 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-accent-300">
          {eyebrow}
        </span>
        <h2 className="mt-6 font-display text-3xl font-bold leading-tight">{title}</h2>
        <p className="mt-3 text-sm leading-relaxed text-white/70">{text}</p>

        <div className="mt-6 space-y-3">
          {points.map((t, i) => (
            <div
              key={t}
              className="flex items-center gap-2.5 text-sm text-white/85 animate-fade-up"
              style={{ animationDelay: `${120 + i * 90}ms` }}
            >
              <ShieldCheck className="h-4 w-4 shrink-0 text-accent-400" />
              {t}
            </div>
          ))}
        </div>
      </div>

      {/* compact bridge with travelling payment pulses */}
      <div className="relative mt-10">
        <span className="absolute left-[4%] top-0 z-10 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[10px] font-semibold text-white/85 backdrop-blur-sm animate-float">
          <Fingerprint className="h-3 w-3 text-accent-300" /> AePS
        </span>
        <span className="absolute right-[6%] top-[-14px] z-10 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[10px] font-semibold text-white/85 backdrop-blur-sm animate-float [animation-delay:1.4s]">
          <QrCode className="h-3 w-3 text-accent-300" /> UPI QR
        </span>

        <svg viewBox="0 0 400 130" fill="none" className="w-full" aria-hidden>
          <defs>
            <linearGradient id="login-arc" x1="0" y1="0" x2="400" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#578bfc" />
              <stop offset="0.5" stopColor="#34d399" />
              <stop offset="1" stopColor="#578bfc" />
            </linearGradient>
          </defs>
          <path d="M20 110 H380" stroke="rgba(255,255,255,0.18)" strokeWidth="2.5" strokeLinecap="round" />
          <path id="login-path" d="M20 110 C 110 30, 290 30, 380 110" stroke="url(#login-arc)" strokeWidth="3" strokeLinecap="round" />
          {[
            ["85", "72"], ["145", "48"], ["200", "42"], ["255", "48"], ["315", "72"],
          ].map(([x, y]) => (
            <line key={x} x1={x} y1={y} x2={x} y2="110" stroke="rgba(255,255,255,0.14)" strokeWidth="1.5" strokeLinecap="round" />
          ))}
          {[0, 2.4].map((delay, i) => (
            <circle key={i} r="4.5" fill={i === 0 ? "#8db4ff" : "#34d399"}>
              <animateMotion dur="5.6s" begin={`${delay}s`} repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear">
                <mpath href="#login-path" />
              </animateMotion>
            </circle>
          ))}
        </svg>

        <div className="pointer-events-none absolute inset-x-0 bottom-[2%] flex items-end justify-between px-[1%]">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 bg-white/10 backdrop-blur-sm">
            <Store className="h-4 w-4 text-brand-300" />
          </span>
          <span className="grid -translate-y-8 h-12 w-12 place-items-center rounded-2xl border border-accent-400/40 bg-[#0e1740] shadow-[0_0_40px_rgba(52,211,153,0.35)]">
            <LogoMark size={34} variant="light" />
          </span>
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 bg-white/10 backdrop-blur-sm">
            <Landmark className="h-4 w-4 text-accent-300" />
          </span>
        </div>
      </div>

      {/* figures */}
      <div className="relative mt-8 grid grid-cols-3 divide-x divide-white/10 rounded-2xl border border-white/10 bg-white/[0.04] py-4">
        {panelFigures.map((f) => (
          <div key={f.label} className="flex flex-col items-center gap-0.5 text-center">
            <span className="inline-flex items-center gap-1 font-display text-lg font-bold">
              {f.value === "T+0" && <Zap className="h-3.5 w-3.5 text-accent-400" />}
              {f.value}
            </span>
            <span className="text-[10px] uppercase tracking-widest text-white/50">{f.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <LocationGate>
      {(location) => <LoginForm location={location} />}
    </LocationGate>
  );
}

function LoginForm({ location }: { location: LocationData }) {
  const router = useRouter();
  const [role, setRole] = useState<PublicRole>("retailer");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");

  // Rate-limit cooldown state
  const [cooldownSec, setCooldownSec] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCooldown = useCallback((seconds: number) => {
    setCooldownSec(seconds);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldownSec((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current!);
          cooldownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    return () => { if (cooldownRef.current) clearInterval(cooldownRef.current); };
  }, []);

  const rateLimited = cooldownSec > 0;

  // 2FA state
  const [step, setStep] = useState<"credentials" | "2fa">("credentials");
  const [tempToken, setTempToken] = useState("");
  const [userName, setUserName] = useState("");

  function pickRole(r: PublicRole) {
    setRole(r);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rateLimited) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: identifier.trim(),
          password,
          location: { lat: location.latitude, lng: location.longitude, accuracy: location.accuracy },
          captchaToken,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          const retrySec = data.retryAfterSec ?? Math.ceil(
            parseInt(res.headers.get("Retry-After") || "60", 10)
          );
          startCooldown(retrySec);
        }
        setError(data.error || "Invalid email/phone or password.");
        setLoading(false);
        return;
      }

      if (data.needs2FA) {
        setTempToken(data.tempToken);
        setUserName(data.user?.name || "");
        setStep("2fa");
        setLoading(false);
        return;
      }

      if (data.needsSetup) {
        const result = await signIn("token-login", {
          grant: data.grant,
          redirect: false,
        });
        if (result?.error) {
          setError("Login failed.");
          setLoading(false);
          return;
        }
        router.push("/dashboard/settings/security");
        router.refresh();
        return;
      }
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  if (step === "2fa") {
    return (
      <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-2">
        <BrandPanel
          eyebrow="Secure login"
          title={<>One more step.<br />Your account is worth it.</>}
          text="Enter the code from your authenticator app to finish crossing the bridge."
          points={[
            "Google Authenticator / Authy / Microsoft",
            "Code refreshes every 30 seconds",
            "Backup codes available",
            "Your account stays protected",
          ]}
        />

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-[2rem] border border-ink-100 bg-white p-8 shadow-soft md:p-10"
        >
          <TwoFactorStep
            tempToken={tempToken}
            userName={userName}
            userEmail={identifier}
            onBack={() => {
              setStep("credentials");
              setTempToken("");
              setPassword("");
              setError("");
            }}
          />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-2">
      <BrandPanel
        eyebrow="Smart Payments · Trusted Solutions"
        title={<>Welcome back<br />to the bridge.</>}
        text="One login for retailers, distributors, master distributors and super distributors — each with its own purpose-built workspace."
        points={[
          "60+ services on one dashboard",
          "Instant IMPS settlement, 24×7",
          "Transparent, slab-wise commissions",
          "Two-factor authentication for all users",
        ]}
      />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-[2rem] border border-ink-100 bg-white p-8 shadow-soft md:p-10"
      >
        <div className="flex items-center gap-3 lg:hidden">
          <LogoMark size={36} />
        </div>
        <h1 className="heading-md mt-4 lg:mt-0">Sign in</h1>
        <p className="mt-2 text-sm text-ink-500">
          New to Paybridgex?{" "}
          <Link href="/register" className="font-semibold text-brand-700 hover:underline">
            Request to join
          </Link>
        </p>

        <div className="mt-6">
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-ink-500">
            I am a
          </p>
          <div className="grid grid-cols-2 gap-2">
            {roleOptions.map((r) => {
              const Icon = r.icon;
              const active = role === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => pickRole(r.id)}
                  className={cn(
                    "relative flex items-center gap-3 rounded-2xl border p-3 text-left transition duration-200",
                    active
                      ? "border-transparent shadow-soft"
                      : "border-ink-100 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-sm"
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="role-pill"
                      className="absolute inset-0 rounded-2xl bg-gradient-to-br from-brand-50 to-accent-50 ring-1 ring-inset ring-brand-400"
                      transition={{ type: "spring", stiffness: 400, damping: 32 }}
                    />
                  )}
                  <span
                    className={cn(
                      "relative grid h-9 w-9 shrink-0 place-items-center rounded-xl transition",
                      active
                        ? "bg-gradient-to-br from-brand-600 to-brand-500 text-white shadow-glow"
                        : "bg-ink-100 text-ink-700"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="relative min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-900">{r.label}</p>
                    <p className="truncate text-xs text-ink-500">{r.tagline}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            className="mt-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </motion.div>
        )}

        {rateLimited && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            <Clock className="h-4 w-4 shrink-0 text-amber-600" />
            <span>
              Too many attempts. Try again in{" "}
              <span className="font-bold tabular-nums">
                {Math.floor(cooldownSec / 60)}:{String(cooldownSec % 60).padStart(2, "0")}
              </span>
            </span>
          </div>
        )}

        <form className="mt-6 space-y-5" onSubmit={onSubmit}>
          <div>
            <Label htmlFor="identifier">Email or mobile</Label>
            <Input
              id="identifier"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="you@example.com or 9876543210"
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                href="#"
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <Input
                id="password"
                type={showPwd ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPwd((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-500 hover:text-ink-900"
                aria-label={showPwd ? "Hide password" : "Show password"}
              >
                {showPwd ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              defaultChecked
              className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
            />
            Keep me signed in for 30 days
          </label>

          <Turnstile onToken={setCaptchaToken} className="flex justify-center" />

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={loading || rateLimited || (captchaConfigured && !captchaToken)}
          >
            {loading
              ? "Verifying..."
              : rateLimited
                ? `Wait ${Math.floor(cooldownSec / 60)}:${String(cooldownSec % 60).padStart(2, "0")}`
                : <>Continue <ArrowRight className="h-4 w-4" /></>}
          </Button>

          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-ink-400">
            <ShieldCheck className="h-3.5 w-3.5 text-accent-600" />
            256-bit encrypted · Location-verified sign-in
          </p>
        </form>
      </motion.div>
    </div>
  );
}
