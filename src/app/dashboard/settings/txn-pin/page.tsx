"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, KeyRound, Lock, ShieldCheck } from "lucide-react";
import { ServicePageHeader } from "@/components/dashboard/ServicePage";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { PinInput } from "@/components/security/PinInput";
import { Reveal } from "@/components/motion";

type Status = { isSet: boolean; setAt: string | null; lockedUntil: string | null };

/**
 * Set or change the 4-digit transaction PIN required on every payment.
 * First-time set is confirmed with the account password; changing it is
 * confirmed with the current PIN.
 */
export default function TxnPinPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [forgotPin, setForgotPin] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/security/txn-pin");
      if (res.ok) setStatus(await res.json());
    } catch {
      /* the form still renders; the server enforces */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const isChange = Boolean(status?.isSet);
  const usePassword = !isChange || forgotPin;
  const locked = status?.lockedUntil && new Date(status.lockedUntil) > new Date();
  const pinsMatch = newPin.length === 4 && newPin === confirmPin;
  const canSubmit =
    pinsMatch && !saving && (usePassword ? password.length >= 8 : currentPin.length === 4);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/security/txn-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newPin,
          ...(usePassword ? { password } : { currentPin }),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not save the PIN — check your details");
        return;
      }
      setDone(true);
    } catch {
      setError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-lg space-y-6 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-emerald-50 to-brand-50 ring-1 ring-emerald-100">
          <CheckCircle2 className="h-8 w-8 text-emerald-600" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">
            Transaction PIN {isChange ? "updated" : "activated"}
          </h1>
          <p className="mt-2 text-sm text-ink-600">
            You&apos;ll be asked for this PIN every time you make a payment —
            bill pay, recharge, money transfer, AePS and payouts.
          </p>
        </div>
        <Button size="lg" onClick={() => router.back()}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <Reveal distance={14} duration={0.4}>
        <ServicePageHeader
          icon={KeyRound}
          title={isChange ? "Change transaction PIN" : "Set transaction PIN"}
          description="A 4-digit PIN confirmed on every payment. It's separate from your login password — never share it."
        />
      </Reveal>

      <div className="mb-6 flex items-start gap-3 rounded-2xl border border-brand-100 bg-brand-50/60 p-4 text-sm text-ink-700">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" />
        <div>
          <p className="font-semibold text-ink-900">Why a transaction PIN?</p>
          <p className="mt-1">
            Even if someone reaches your open dashboard, they cannot move money
            without this PIN. 5 wrong attempts lock payments for 15 minutes.
          </p>
        </div>
      </div>

      {locked ? (
        <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            PIN entry is temporarily locked after too many wrong attempts. Try
            again after{" "}
            {new Date(status!.lockedUntil!).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            .
          </span>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-6 rounded-2xl border border-ink-100 bg-white p-6 shadow-sm">
          {isChange && !forgotPin && (
            <div>
              <p className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-ink-500">
                Current PIN
              </p>
              <PinInput id="current-pin" value={currentPin} onChange={setCurrentPin} autoFocus />
              <p className="mt-2 text-center text-[11px]">
                <button
                  type="button"
                  onClick={() => setForgotPin(true)}
                  className="font-semibold text-brand-700 hover:underline"
                >
                  Forgot your PIN? Verify with your password instead
                </button>
              </p>
            </div>
          )}

          <div>
            <p className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-ink-500">
              New 4-digit PIN
            </p>
            <PinInput id="new-pin" value={newPin} onChange={setNewPin} autoFocus={!isChange} />
            <p className="mt-2 text-center text-[11px] text-ink-400">
              Avoid guessable PINs like 0000 or 1234 — they&apos;re rejected.
            </p>
          </div>

          <div>
            <p className="mb-3 text-center text-xs font-semibold uppercase tracking-widest text-ink-500">
              Confirm new PIN
            </p>
            <PinInput id="confirm-pin" value={confirmPin} onChange={setConfirmPin} autoFocus={false} />
            {confirmPin.length === 4 && !pinsMatch && (
              <p className="mt-2 text-center text-xs text-rose-600">PINs don&apos;t match</p>
            )}
          </div>

          {usePassword && (
            <div>
              <Label htmlFor="password">Account password</Label>
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="Confirm it's really you"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" size="lg" className="w-full" isLoading={saving} disabled={!canSubmit}>
            {saving ? "Saving…" : isChange ? "Update PIN" : "Activate PIN"}
          </Button>
        </form>
      )}
    </div>
  );
}
