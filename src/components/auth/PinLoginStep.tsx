"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { KeyRound, ArrowRight, AlertCircle, RotateCcw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";

interface PinLoginStepProps {
  tempToken: string;
  userName: string;
  /** Whether the user has already accepted the no-2FA liability before. */
  riskAlreadyAccepted: boolean;
  onBack: () => void;
}

/**
 * TPIN login step — shown when a master-admin has waived mandatory 2FA for the
 * account and enabled PIN login. The user enters their transaction PIN and, the
 * first time, must accept that they carry all account risk without 2FA.
 */
export function PinLoginStep({ tempToken, userName, riskAlreadyAccepted, onBack }: PinLoginStepProps) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [riskAccepted, setRiskAccepted] = useState(riskAlreadyAccepted);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const verify = useCallback(async () => {
    const toVerify = pin.trim();
    if (toVerify.length < 4 || submittingRef.current) return;
    if (!riskAlreadyAccepted && !riskAccepted) {
      setError("Please accept the risk acknowledgement to continue.");
      return;
    }
    submittingRef.current = true;
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/pin-login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tempToken, pin: toVerify, riskAccepted }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Verification failed");
        setLoading(false);
        setPin("");
        submittingRef.current = false;
        return;
      }

      const result = await signIn("token-login", { grant: data.grant, redirect: false });
      if (result?.error) {
        setError("Session creation failed. Please try again.");
        setLoading(false);
        submittingRef.current = false;
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
      setPin("");
      submittingRef.current = false;
    }
  }, [pin, tempToken, riskAccepted, riskAlreadyAccepted, router]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    verify();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white">
          <KeyRound className="h-5 w-5" />
        </span>
        <div>
          <h2 className="heading-md">Sign in with your PIN</h2>
          <p className="text-sm text-ink-500">
            Hi {userName}, enter your transaction PIN to continue.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form className="space-y-4" onSubmit={onSubmit}>
        <div>
          <Label htmlFor="pin-login-pin">Transaction PIN</Label>
          <Input
            ref={inputRef}
            id="pin-login-pin"
            type="password"
            inputMode="numeric"
            maxLength={6}
            placeholder="••••••"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            disabled={loading}
            autoComplete="off"
            className="text-center text-lg font-mono tracking-[0.4em]"
            required
          />
        </div>

        {!riskAlreadyAccepted && (
          <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <input
              type="checkbox"
              checked={riskAccepted}
              onChange={(e) => setRiskAccepted(e.target.checked)}
              disabled={loading}
              className="mt-0.5 h-4 w-4 accent-amber-600"
            />
            <span className="flex items-start gap-1.5">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                I understand that logging in without two-factor authentication is
                less secure. I accept that all risk for any suspicious or
                unauthorised activity on my account is mine, and the company bears
                no responsibility.
              </span>
            </span>
          </label>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2.5 py-3 text-sm font-medium text-brand-700">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
            Verifying...
          </div>
        ) : (
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={pin.length < 4 || (!riskAlreadyAccepted && !riskAccepted)}
          >
            Verify &amp; sign in <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </form>

      <div className="flex justify-end text-xs">
        <button
          type="button"
          onClick={onBack}
          disabled={loading}
          className="flex items-center gap-1 font-medium text-ink-500 hover:text-ink-900 disabled:opacity-50"
        >
          <RotateCcw className="h-3 w-3" />
          Start over
        </button>
      </div>
    </div>
  );
}
