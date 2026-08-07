"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import {
  Eye,
  EyeOff,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
  Network,
  Crown,
  ArrowRight,
  AlertCircle,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
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
      <div className="grid w-full max-w-5xl gap-8 lg:grid-cols-2">
        <div className="hidden flex-col justify-between rounded-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-accent-500 p-10 text-white shadow-glow lg:flex">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-widest">
              <Sparkles className="h-3.5 w-3.5" /> Secure login
            </span>
            <h2 className="mt-6 font-display text-3xl font-bold leading-tight">
              Two-factor <br /> verification.
            </h2>
            <p className="mt-3 text-white/85">
              Enter the code from your authenticator app to complete sign-in.
            </p>
          </div>
          <div className="space-y-3">
            {[
              "Google Authenticator / Authy / Microsoft",
              "Code refreshes every 30 seconds",
              "Backup codes available",
              "Your account stays protected"
            ].map((t) => (
              <div key={t} className="flex items-center gap-2 text-sm">
                <ShieldCheck className="h-4 w-4 text-emerald-300" />
                {t}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-ink-100 bg-white p-8 shadow-soft md:p-10">
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
        </div>
      </div>
    );
  }

  return (
    <div className="grid w-full max-w-5xl gap-8 lg:grid-cols-2">
      <div className="hidden flex-col justify-between rounded-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-accent-500 p-10 text-white shadow-glow lg:flex">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-widest">
            <Sparkles className="h-3.5 w-3.5" /> Unified portal
          </span>
          <h2 className="mt-6 font-display text-3xl font-bold leading-tight">
            One NextGenPay. <br /> Four powerful dashboards.
          </h2>
          <p className="mt-3 text-white/85">
            Retailer, distributor, master distributor and super distributor — each with its own purpose-built workspace, KPIs and controls.
          </p>
        </div>

        <div className="space-y-3">
          {[
            "60+ services in one dashboard",
            "Instant IMPS settlement 24x7",
            "Highest commissions in the industry",
            "Two-factor authentication for all users"
          ].map((t) => (
            <div key={t} className="flex items-center gap-2 text-sm">
              <ShieldCheck className="h-4 w-4 text-emerald-300" />
              {t}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-ink-100 bg-white p-8 shadow-soft md:p-10">
        <h1 className="heading-md">Sign in</h1>
        <p className="mt-2 text-sm text-ink-500">
          New to NextGenPay?{" "}
          <Link href="/register" className="font-semibold text-brand-700">
            Create an account
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
                    "flex items-center gap-3 rounded-xl border p-3 text-left transition",
                    active
                      ? "border-brand-500 bg-brand-50 shadow-soft"
                      : "border-ink-100 hover:border-brand-300"
                  )}
                >
                  <span
                    className={cn(
                      "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
                      active
                        ? "bg-brand-600 text-white"
                        : "bg-ink-100 text-ink-700"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-900">{r.label}</p>
                    <p className="truncate text-xs text-ink-500">{r.tagline}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {rateLimited && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
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
              placeholder="you@example.com or 8780224955"
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
        </form>
      </div>
    </div>
  );
}
