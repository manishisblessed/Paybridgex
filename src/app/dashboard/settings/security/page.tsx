"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  ShieldCheck,
  QrCode,
  Copy,
  Check,
  AlertTriangle,
  ArrowRight,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";

type SetupStep = "start" | "scan" | "verify" | "backup" | "done";

export default function SecuritySettingsPage() {
  const { data: session } = useSession({ required: true });
  const router = useRouter();
  const [step, setStep] = useState<SetupStep>("start");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (session?.user && !session.user.twoFactorEnabled) {
      router.replace("/dashboard");
    }
  }, [session, router]);

  async function startSetup() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/2fa/setup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Setup failed");
        setLoading(false);
        return;
      }
      setQrCode(data.qrCode);
      setSecret(data.secret);
      setBackupCodes(data.backupCodes);
      setStep("scan");
    } catch {
      setError("Network error");
    }
    setLoading(false);
  }

  async function confirmSetup() {
    if (code.length !== 6) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/2fa/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Verification failed");
        setLoading(false);
        return;
      }
      setStep("backup");
    } catch {
      setError("Network error");
    }
    setLoading(false);
  }

  function copySecret() {
    navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadBackupCodes() {
    const text = [
      "Paybridgex — 2FA Backup Codes",
      `Account: ${session?.user?.email}`,
      `Generated: ${new Date().toLocaleDateString()}`,
      "",
      "Keep these codes safe. Each can only be used once.",
      "",
      ...backupCodes.map((c, i) => `${i + 1}. ${c}`),
    ].join("\n");

    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "paybridgex-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (step === "start") {
    return (
      <div className="mx-auto max-w-lg space-y-6 p-6">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-ink-900">Set up two-factor authentication</h1>
            <p className="text-sm text-ink-500">Protect your account with an authenticator app</p>
          </div>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-semibold text-amber-900">2FA is mandatory</p>
              <p className="mt-1 text-sm text-amber-800">
                You must set up two-factor authentication before you can access
                the dashboard. This protects your account and your customers.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-ink-100 bg-ink-50 p-4">
          <p className="font-semibold text-ink-900">You'll need:</p>
          <ul className="space-y-2 text-sm text-ink-700">
            <li className="flex items-center gap-2">
              <QrCode className="h-4 w-4 text-brand-600" />
              An authenticator app (Google Authenticator, Authy, Microsoft Authenticator)
            </li>
            <li className="flex items-center gap-2">
              <Download className="h-4 w-4 text-brand-600" />
              A safe place to store backup codes
            </li>
          </ul>
        </div>

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        <Button onClick={startSetup} size="lg" className="w-full" isLoading={loading} disabled={loading}>
          {loading ? "Setting up..." : <>Begin setup <ArrowRight className="h-4 w-4" /></>}
        </Button>
      </div>
    );
  }

  if (step === "scan") {
    return (
      <div className="mx-auto max-w-lg space-y-6 p-6">
        <div>
          <h1 className="text-xl font-bold text-ink-900">Scan QR code</h1>
          <p className="mt-1 text-sm text-ink-500">
            Open your authenticator app and scan this QR code.
          </p>
        </div>

        <div className="flex justify-center rounded-2xl border border-ink-100 bg-white p-6">
          {qrCode && (
            <img src={qrCode} alt="2FA QR Code" className="h-56 w-56" />
          )}
        </div>

        <div className="rounded-xl border border-ink-200 bg-ink-50 p-3">
          <p className="mb-1 text-xs font-medium text-ink-500">
            Can't scan? Enter this key manually:
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-white px-2 py-1 font-mono text-sm text-ink-900">
              {secret}
            </code>
            <button
              onClick={copySecret}
              className="rounded-lg border border-ink-200 p-2 text-ink-600 hover:bg-ink-100"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <Button onClick={() => setStep("verify")} size="lg" className="w-full">
          I've scanned it <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  if (step === "verify") {
    return (
      <div className="mx-auto max-w-lg space-y-6 p-6">
        <div>
          <h1 className="text-xl font-bold text-ink-900">Verify your setup</h1>
          <p className="mt-1 text-sm text-ink-500">
            Enter the 6-digit code shown in your authenticator app.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div>
          <Label htmlFor="verify-code">Verification code</Label>
          <Input
            id="verify-code"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            autoFocus
          />
        </div>

        <Button
          onClick={confirmSetup}
          size="lg"
          className="w-full"
          isLoading={loading}
          disabled={loading || code.length !== 6}
        >
          {loading ? "Verifying..." : <>Verify & activate <ArrowRight className="h-4 w-4" /></>}
        </Button>

        <button
          onClick={() => setStep("scan")}
          className="text-sm text-brand-700 hover:underline"
        >
          Back to QR code
        </button>
      </div>
    );
  }

  if (step === "backup") {
    return (
      <div className="mx-auto max-w-lg space-y-6 p-6">
        <div>
          <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold text-ink-900">2FA is now active!</h1>
          <p className="mt-1 text-sm text-ink-500">
            Save these backup codes in a secure location. Each can only be used once.
          </p>
        </div>

        <div className="rounded-2xl border border-ink-200 bg-ink-50 p-4">
          <div className="grid grid-cols-2 gap-2">
            {backupCodes.map((code, i) => (
              <div
                key={i}
                className="rounded-lg bg-white px-3 py-2 text-center font-mono text-sm font-medium text-ink-900"
              >
                {code}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <strong>Important:</strong> If you lose your phone and don't have these codes,
          you will be locked out of your account.
        </div>

        <div className="flex gap-3">
          <Button
            onClick={downloadBackupCodes}
            variant="outline"
            className="flex-1"
          >
            <Download className="h-4 w-4" /> Download
          </Button>
          <Button
            onClick={() => setStep("done")}
            className="flex-1"
          >
            I've saved them <Check className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  // done
  return (
    <div className="mx-auto max-w-lg space-y-6 p-6 text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100">
        <ShieldCheck className="h-8 w-8 text-emerald-600" />
      </div>
      <h1 className="text-2xl font-bold text-ink-900">You're all set!</h1>
      <p className="text-ink-600">
        Two-factor authentication is active. You'll need your authenticator
        app every time you sign in.
      </p>
      <Button
        onClick={() => (window.location.href = "/dashboard")}
        size="lg"
        className="mx-auto"
      >
        Go to Dashboard <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
