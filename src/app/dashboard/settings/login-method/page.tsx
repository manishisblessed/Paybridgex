"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ShieldCheck,
  KeyRound,
  HelpCircle,
  Loader2,
  Check,
  AlertTriangle,
  ShieldAlert,
  Lock,
} from "lucide-react";
import { ServicePageHeader } from "@/components/dashboard/ServicePage";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/utils";

type Preferred = "authenticator" | "tpin" | null;

type State = {
  selfManageable: boolean;
  twoFactorEnabled: boolean;
  hasTxnPin: boolean;
  pinLoginEnabled: boolean;
  riskAccepted: boolean;
  canChoose: boolean;
  preferred: Preferred;
};

const OPTIONS: {
  id: Exclude<Preferred, null> | "ask";
  label: string;
  desc: string;
  icon: typeof ShieldCheck;
  accent: string;
}[] = [
  {
    id: "ask",
    label: "Ask me every time",
    desc: "Show the chooser at each login so you can pick on the spot.",
    icon: HelpCircle,
    accent: "text-ink-600",
  },
  {
    id: "authenticator",
    label: "Authenticator app",
    desc: "Skip the chooser and go straight to your 6-digit TOTP code. Most secure.",
    icon: ShieldCheck,
    accent: "text-emerald-600",
  },
  {
    id: "tpin",
    label: "Transaction PIN",
    desc: "Skip the chooser and sign in with your TPIN. Quick and convenient.",
    icon: KeyRound,
    accent: "text-brand-600",
  },
];

export default function LoginMethodSettingsPage() {
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [declaration, setDeclaration] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/security/login-method");
      const data = await res.json();
      if (res.ok) setState(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function post(payload: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey);
    try {
      const res = await fetch("/api/security/login-method", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Something went wrong");
      setState(data);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function enablePinLogin() {
    if (!declaration) return;
    const ok = await post({ action: "enablePinLogin", riskAccepted: true }, "enable");
    if (ok) {
      setDeclaration(false);
      toast.success("PIN login enabled. You can now sign in with your transaction PIN.");
    }
  }

  async function disablePinLogin() {
    const ok = await post({ action: "disablePinLogin" }, "disable");
    setConfirmDisable(false);
    if (ok) toast.success("PIN login disabled. Your authenticator app is required again.");
  }

  async function choose(id: (typeof OPTIONS)[number]["id"]) {
    const preferred: Preferred = id === "ask" ? null : id;
    const ok = await post({ action: "setPreference", preferred }, `pref-${id}`);
    if (ok) toast.success("Login preference saved.");
  }

  const current: (typeof OPTIONS)[number]["id"] = state?.preferred ?? "ask";

  return (
    <div className="mx-auto max-w-2xl">
      <ServicePageHeader
        icon={ShieldCheck}
        title="Login method"
        description="Choose how you'd like to verify your identity when you sign in."
        back="/dashboard/settings"
      />

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-ink-100 bg-white p-10 text-ink-500">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : !state ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          Couldn&apos;t load your login settings. Please refresh and try again.
        </div>
      ) : !state.selfManageable ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold text-amber-900">
              PIN login isn&apos;t available for this account
            </p>
            <p className="mt-1 text-sm text-amber-800">
              For security, admin and master-admin accounts must always sign in
              with an authenticator app.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── Enable / disable TPIN login ─────────────────────────────── */}
          <section className="rounded-2xl border border-ink-100 bg-white">
            <div className="flex items-center gap-3 border-b border-ink-100 px-6 py-4">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-700">
                <KeyRound className="h-4 w-4" />
              </span>
              <div>
                <h3 className="font-display text-base font-semibold text-ink-900">
                  Sign in with your transaction PIN
                </h3>
                <p className="text-xs text-ink-500">
                  Use your TPIN as an alternative to the authenticator app.
                </p>
              </div>
              {state.pinLoginEnabled && (
                <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                  <Check className="h-3.5 w-3.5" /> Enabled
                </span>
              )}
            </div>

            <div className="space-y-4 p-6">
              {!state.hasTxnPin ? (
                <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div className="text-sm text-amber-800">
                    You need a transaction PIN before you can turn this on.{" "}
                    <Link
                      href="/dashboard/settings/txn-pin"
                      className="font-semibold text-brand-700 hover:underline"
                    >
                      Set a transaction PIN
                    </Link>
                    .
                  </div>
                </div>
              ) : state.pinLoginEnabled ? (
                <>
                  <p className="text-sm text-ink-600">
                    PIN login is on. At sign-in you can use either your
                    authenticator app or your transaction PIN.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => setConfirmDisable(true)}
                    isLoading={busy === "disable"}
                    disabled={busy !== null}
                  >
                    Disable PIN login
                  </Button>
                </>
              ) : (
                <>
                  <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    <input
                      type="checkbox"
                      checked={declaration}
                      onChange={(e) => setDeclaration(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-amber-600"
                    />
                    <span className="flex items-start gap-1.5">
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        <strong>Declaration.</strong> I understand that signing
                        in with a transaction PIN instead of an authenticator app
                        is less secure. I accept that all responsibility and risk
                        for any activity on my account — including any suspicious
                        or unauthorised activity — is entirely mine, and that the
                        company bears no responsibility whatsoever.
                      </span>
                    </span>
                  </label>
                  <Button
                    onClick={enablePinLogin}
                    isLoading={busy === "enable"}
                    disabled={!declaration || busy !== null}
                  >
                    Enable PIN login
                  </Button>
                </>
              )}
            </div>
          </section>

          {/* ── Preferred method ────────────────────────────────────────── */}
          {state.pinLoginEnabled && (
            <section className="space-y-3">
              <div>
                <h3 className="font-display text-base font-semibold text-ink-900">
                  Preferred method at login
                </h3>
                <p className="text-sm text-ink-500">
                  {state.canChoose
                    ? "Pick a default — you can always switch during login."
                    : "You'll sign in with your transaction PIN. Set up an authenticator app to be able to choose between the two."}
                </p>
              </div>

              {state.canChoose ? (
                OPTIONS.map((o) => {
                  const Icon = o.icon;
                  const active = current === o.id;
                  const isBusy = busy === `pref-${o.id}`;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => choose(o.id)}
                      className={cn(
                        "flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition",
                        active
                          ? "border-brand-500 bg-brand-50 shadow-soft"
                          : "border-ink-100 hover:border-brand-300"
                      )}
                    >
                      <span
                        className={cn(
                          "grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white",
                          o.accent
                        )}
                      >
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-ink-900">
                          {o.label}
                        </span>
                        <span className="block text-xs text-ink-500">{o.desc}</span>
                      </span>
                      {isBusy ? (
                        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-brand-600" />
                      ) : active ? (
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-600 text-white">
                          <Check className="h-4 w-4" />
                        </span>
                      ) : (
                        <span className="h-6 w-6 shrink-0 rounded-full border border-ink-200" />
                      )}
                    </button>
                  );
                })
              ) : (
                <div className="flex items-start gap-3 rounded-2xl border border-ink-100 bg-ink-50 p-4 text-sm text-ink-600">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>
                    Want the choice at login?{" "}
                    <Link
                      href="/dashboard/settings/security"
                      className="font-semibold text-brand-700 hover:underline"
                    >
                      Set up an authenticator app
                    </Link>{" "}
                    and you&apos;ll be able to pick either method.
                  </span>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDisable}
        busy={busy === "disable"}
        title="Disable PIN login?"
        description="You'll need your authenticator app to sign in again. If you don't have one set up, you'll be asked to set it up at your next login. Your saved preference will be cleared."
        confirmLabel="Disable PIN login"
        onConfirm={disablePinLogin}
        onClose={() => setConfirmDisable(false)}
      />
    </div>
  );
}
