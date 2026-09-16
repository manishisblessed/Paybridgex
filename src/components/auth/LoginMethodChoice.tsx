"use client";

import { ShieldCheck, KeyRound, ChevronRight, RotateCcw } from "lucide-react";

export type LoginMethod = "2fa" | "pinlogin";

interface LoginMethodChoiceProps {
  userName: string;
  /** Called with the factor the user picked. */
  onChoose: (method: LoginMethod) => void;
  onBack: () => void;
}

/**
 * Second-factor chooser — shown when TPIN login is enabled for an account that
 * ALSO has an authenticator app set up. The user decides, on every sign-in,
 * whether to verify with their authenticator or their transaction PIN. Neither
 * option is forced.
 */
export function LoginMethodChoice({ userName, onChoose, onBack }: LoginMethodChoiceProps) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <h2 className="heading-md">Choose how to verify</h2>
          <p className="text-sm text-ink-500">
            Hi {userName}, pick the second factor you&apos;d like to use.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <button
          type="button"
          onClick={() => onChoose("2fa")}
          className="group flex w-full items-center gap-4 rounded-2xl border border-ink-100 p-4 text-left transition hover:border-emerald-400 hover:bg-emerald-50/60"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink-900">
              Authenticator app
            </span>
            <span className="block text-xs text-ink-500">
              Enter the 6-digit code from Google Authenticator, Authy, etc.
            </span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-ink-400 transition group-hover:translate-x-0.5 group-hover:text-emerald-600" />
        </button>

        <button
          type="button"
          onClick={() => onChoose("pinlogin")}
          className="group flex w-full items-center gap-4 rounded-2xl border border-ink-100 p-4 text-left transition hover:border-brand-400 hover:bg-brand-50/60"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-600 text-white">
            <KeyRound className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink-900">
              Transaction PIN
            </span>
            <span className="block text-xs text-ink-500">
              Sign in with your TPIN instead of the authenticator.
            </span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-ink-400 transition group-hover:translate-x-0.5 group-hover:text-brand-600" />
        </button>
      </div>

      <div className="flex justify-end text-xs">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 font-medium text-ink-500 hover:text-ink-900"
        >
          <RotateCcw className="h-3 w-3" />
          Start over
        </button>
      </div>
    </div>
  );
}
