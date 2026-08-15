"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import {
  Eye,
  EyeOff,
  ShieldCheck,
  Lock,
  ArrowRight,
  AlertCircle,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { TwoFactorStep } from "@/components/auth/TwoFactorStep";
import { LocationGate, type LocationData } from "@/components/auth/LocationGate";

export default function AdminLoginPage() {
  return (
    <LocationGate>
      {(location) => <AdminLoginForm location={location} />}
    </LocationGate>
  );
}

function AdminLoginForm({ location }: { location: LocationData }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [cooldownSec, setCooldownSec] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCooldown = useCallback((seconds: number) => {
    setCooldownSec(seconds);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldownSec((prev) => {
        if (prev <= 1) { clearInterval(cooldownRef.current!); cooldownRef.current = null; return 0; }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => { return () => { if (cooldownRef.current) clearInterval(cooldownRef.current); }; }, []);

  const rateLimited = cooldownSec > 0;

  // 2FA state
  const [step, setStep] = useState<"credentials" | "2fa">("credentials");
  const [tempToken, setTempToken] = useState("");
  const [userName, setUserName] = useState("");

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
          identifier: email.trim(),
          password,
          location: { lat: location.latitude, lng: location.longitude, accuracy: location.accuracy },
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          const retrySec = data.retryAfterSec ?? Math.ceil(parseInt(res.headers.get("Retry-After") || "60", 10));
          startCooldown(retrySec);
        }
        setError(data.error || "Invalid credentials.");
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
        <div className="hidden flex-col justify-between rounded-3xl bg-gradient-to-br from-ink-900 via-ink-800 to-brand-700 p-10 text-white shadow-glow lg:flex">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest">
              <Lock className="h-3.5 w-3.5" /> Restricted · Admin console
            </span>
            <h2 className="mt-6 font-display text-3xl font-bold leading-tight">
              Two-factor <br /> verification.
            </h2>
            <p className="mt-3 text-white/80">
              Enter the code from your authenticator app to complete sign-in.
            </p>
          </div>
          <div className="space-y-3">
            {[
              "TOTP authenticator app required",
              "3-minute session timeout",
              "Max 3 verification attempts",
              "All attempts logged to audit trail"
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
            userEmail={email}
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
      <div className="hidden flex-col justify-between rounded-3xl bg-gradient-to-br from-ink-900 via-ink-800 to-brand-700 p-10 text-white shadow-glow lg:flex">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest">
            <Lock className="h-3.5 w-3.5" /> Restricted · Admin console
          </span>
          <h2 className="mt-6 font-display text-3xl font-bold leading-tight">
            Paybridgex Admin <br /> Control Centre.
          </h2>
          <p className="mt-3 text-white/80">
            KYC approvals, biller routing, settlements, audit trail and full
            system health — all in one secure workspace.
          </p>
        </div>

        <div className="space-y-3">
          {[
            "Two-factor authentication enforced",
            "All actions logged to immutable audit trail",
            "IP-restricted to whitelisted networks",
            "Looking for delegated access? Use Sub-Admin login"
          ].map((t) => (
            <div key={t} className="flex items-center gap-2 text-sm">
              <ShieldCheck className="h-4 w-4 text-emerald-300" />
              {t}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-ink-100 bg-white p-8 shadow-soft md:p-10">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-ink-900 text-white">
            <Lock className="h-5 w-5" />
          </span>
          <div>
            <h1 className="heading-md">Admin sign in</h1>
            <p className="text-sm text-ink-500">
              Authorised personnel only.
            </p>
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
            <Label htmlFor="email">Admin email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@yourcompany.com"
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

          <Button type="submit" size="lg" className="w-full" disabled={loading || rateLimited}>
            {loading
              ? "Verifying..."
              : rateLimited
                ? `Wait ${Math.floor(cooldownSec / 60)}:${String(cooldownSec % 60).padStart(2, "0")}`
                : <>Continue <ArrowRight className="h-4 w-4" /></>}
          </Button>

          <p className="text-center text-xs text-ink-500">
            Sub-admin?{" "}
            <Link href="/sub-admin" className="font-semibold text-brand-700">
              Use the sub-admin login
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
