"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck,
  QrCode,
  Copy,
  Check,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Download,
  Lock,
  Fingerprint,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";

type SetupStep = "start" | "scan" | "verify" | "backup" | "done";

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.4, ease: "easeOut" } },
  exit: { opacity: 0, transition: { duration: 0.3, ease: "easeIn" } },
};

const modalVariants = {
  hidden: { opacity: 0, scale: 0.92, y: 30 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 20,
    transition: { duration: 0.25, ease: "easeIn" },
  },
};

const stepVariants = {
  enter: { opacity: 0, x: 40 },
  center: { opacity: 1, x: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } },
  exit: { opacity: 0, x: -40, transition: { duration: 0.2, ease: "easeIn" } },
};

export function TwoFactorSetupModal() {
  const { data: session, update } = useSession();
  const [step, setStep] = useState<SetupStep>("start");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const startSetup = useCallback(async () => {
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
  }, []);

  const confirmingRef = useRef(false);

  const confirmSetup = useCallback(async (verifyCode?: string) => {
    const toVerify = verifyCode ?? code;
    if (toVerify.length !== 6 || confirmingRef.current) return;
    confirmingRef.current = true;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/2fa/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: toVerify }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Verification failed");
        setCode("");
        setLoading(false);
        confirmingRef.current = false;
        return;
      }
      setStep("backup");
    } catch {
      setError("Network error");
      setCode("");
    }
    setLoading(false);
    confirmingRef.current = false;
  }, [code]);

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

  async function handleFinish() {
    await update();
    setDismissed(true);
  }

  if (dismissed) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="2fa-backdrop"
        variants={backdropVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-ink-900/60 backdrop-blur-sm p-4"
      >
        <motion.div
          key="2fa-modal"
          variants={modalVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="relative w-full max-w-md rounded-3xl bg-white shadow-2xl ring-1 ring-ink-900/5"
        >
          {/* Decorative top bar */}
          <div className="absolute inset-x-0 top-0 h-1.5 rounded-t-3xl bg-gradient-to-r from-brand-600 via-brand-500 to-accent-500" />

          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 px-6 pt-6 pb-2">
            {(["start", "scan", "verify", "backup"] as const).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`h-2 w-2 rounded-full transition-all duration-500 ${
                    step === s
                      ? "w-6 bg-brand-500"
                      : (["start", "scan", "verify", "backup", "done"] as const).indexOf(step) >
                        i
                      ? "bg-emerald-500"
                      : "bg-ink-200"
                  }`}
                />
              </div>
            ))}
          </div>

          <div className="px-6 pb-6 pt-2">
            <AnimatePresence mode="wait">
              {step === "start" && (
                <motion.div
                  key="step-start"
                  variants={stepVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="space-y-5"
                >
                  <div className="flex flex-col items-center text-center">
                    <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-brand-50 to-emerald-50 ring-1 ring-brand-100">
                      <Lock className="h-8 w-8 text-brand-600" />
                    </div>
                    <h2 className="text-xl font-bold text-ink-900">
                      Set up two-factor authentication
                    </h2>
                    <p className="mt-1.5 text-sm text-ink-500 leading-relaxed">
                      Protect your account with an authenticator app
                    </p>
                  </div>

                  <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                      <div>
                        <p className="font-semibold text-amber-900 text-sm">2FA is mandatory</p>
                        <p className="mt-0.5 text-sm text-amber-800 leading-relaxed">
                          You must set up two-factor authentication before you can
                          access the dashboard.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2.5 rounded-2xl border border-ink-100 bg-ink-50/60 p-4">
                    <p className="text-sm font-semibold text-ink-900">You&apos;ll need:</p>
                    <ul className="space-y-2 text-sm text-ink-700">
                      <li className="flex items-center gap-2.5">
                        <QrCode className="h-4 w-4 text-brand-600" />
                        An authenticator app (Google Authenticator, Authy, Microsoft
                        Authenticator)
                      </li>
                      <li className="flex items-center gap-2.5">
                        <Download className="h-4 w-4 text-brand-600" />
                        A safe place to store backup codes
                      </li>
                    </ul>
                  </div>

                  {error && <p className="text-sm text-red-600">{error}</p>}

                  <Button
                    onClick={startSetup}
                    size="lg"
                    className="w-full"
                    disabled={loading}
                  >
                    {loading ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        Setting up...
                      </span>
                    ) : (
                      <>
                        Begin setup <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </motion.div>
              )}

              {step === "scan" && (
                <motion.div
                  key="step-scan"
                  variants={stepVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="space-y-5"
                >
                  <div className="text-center">
                    <h2 className="text-xl font-bold text-ink-900">Scan QR code</h2>
                    <p className="mt-1.5 text-sm text-ink-500">
                      Open your authenticator app and scan this QR code
                    </p>
                  </div>

                  <div className="flex justify-center rounded-2xl border border-ink-100 bg-white p-5">
                    {qrCode && (
                      <motion.img
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.4 }}
                        src={qrCode}
                        alt="2FA QR Code"
                        className="h-48 w-48"
                      />
                    )}
                  </div>

                  <div className="rounded-xl border border-ink-200 bg-ink-50/60 p-3">
                    <p className="mb-1.5 text-xs font-medium text-ink-500">
                      Can&apos;t scan? Enter this key manually:
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 break-all rounded-lg bg-white px-2.5 py-1.5 font-mono text-xs text-ink-900 ring-1 ring-ink-100">
                        {secret}
                      </code>
                      <button
                        onClick={copySecret}
                        className="rounded-lg border border-ink-200 p-2 text-ink-600 hover:bg-ink-100 transition-colors"
                      >
                        {copied ? (
                          <Check className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <Button
                    onClick={() => setStep("verify")}
                    size="lg"
                    className="w-full"
                  >
                    I&apos;ve scanned it <ArrowRight className="h-4 w-4" />
                  </Button>
                </motion.div>
              )}

              {step === "verify" && (
                <motion.div
                  key="step-verify"
                  variants={stepVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="space-y-5"
                >
                  <div className="flex flex-col items-center text-center">
                    <div className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-50 to-emerald-50 ring-1 ring-brand-100">
                      <Fingerprint className="h-7 w-7 text-brand-600" />
                    </div>
                    <h2 className="text-xl font-bold text-ink-900">Verify your setup</h2>
                    <p className="mt-1.5 text-sm text-ink-500">
                      Enter the 6-digit code shown in your authenticator app
                    </p>
                  </div>

                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
                    >
                      {error}
                    </motion.div>
                  )}

                  <div>
                    <Label htmlFor="verify-code">Verification code</Label>
                    <Input
                      id="verify-code"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="000000"
                      value={code}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, "");
                        setCode(val);
                        if (val.length === 6) confirmSetup(val);
                      }}
                      disabled={loading}
                      autoFocus
                      className="text-center text-lg font-mono tracking-[0.3em]"
                    />
                  </div>

                  {loading ? (
                    <div className="flex items-center justify-center gap-2.5 py-3 text-sm font-medium text-brand-700">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
                      Verifying...
                    </div>
                  ) : (
                    <Button
                      onClick={() => confirmSetup()}
                      size="lg"
                      className="w-full"
                      disabled={code.length !== 6}
                    >
                      Verify &amp; activate <ArrowRight className="h-4 w-4" />
                    </Button>
                  )}

                  <button
                    onClick={() => {
                      setError("");
                      setStep("scan");
                    }}
                    className="flex items-center gap-1.5 text-sm text-brand-700 hover:underline mx-auto"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back to QR code
                  </button>
                </motion.div>
              )}

              {step === "backup" && (
                <motion.div
                  key="step-backup"
                  variants={stepVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="space-y-5"
                >
                  <div className="flex flex-col items-center text-center">
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 200, damping: 15 }}
                      className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"
                    >
                      <ShieldCheck className="h-7 w-7" />
                    </motion.div>
                    <h2 className="text-xl font-bold text-ink-900">2FA is now active!</h2>
                    <p className="mt-1.5 text-sm text-ink-500">
                      Save these backup codes in a secure location. Each can only be
                      used once.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-ink-200 bg-ink-50/60 p-4">
                    <div className="grid grid-cols-2 gap-2">
                      {backupCodes.map((c, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.05 }}
                          className="rounded-lg bg-white px-3 py-2 text-center font-mono text-sm font-medium text-ink-900 ring-1 ring-ink-100"
                        >
                          {c}
                        </motion.div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-800">
                    <strong>Important:</strong> If you lose your phone and don&apos;t have
                    these codes, you will be locked out of your account.
                  </div>

                  <div className="flex gap-3">
                    <Button
                      onClick={downloadBackupCodes}
                      variant="outline"
                      className="flex-1"
                    >
                      <Download className="h-4 w-4" /> Download
                    </Button>
                    <Button onClick={() => setStep("done")} className="flex-1">
                      I&apos;ve saved them <Check className="h-4 w-4" />
                    </Button>
                  </div>
                </motion.div>
              )}

              {step === "done" && (
                <motion.div
                  key="step-done"
                  variants={stepVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="space-y-5 text-center py-4"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{
                      type: "spring",
                      stiffness: 200,
                      damping: 12,
                      delay: 0.1,
                    }}
                    className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-emerald-100 to-emerald-50"
                  >
                    <ShieldCheck className="h-10 w-10 text-emerald-600" />
                  </motion.div>

                  <div>
                    <h2 className="text-2xl font-bold text-ink-900">
                      You&apos;re all set!
                    </h2>
                    <p className="mt-2 text-sm text-ink-600 leading-relaxed">
                      Two-factor authentication is active. You&apos;ll need your
                      authenticator app every time you sign in.
                    </p>
                  </div>

                  <Button onClick={handleFinish} size="lg" className="mx-auto">
                    Go to Dashboard <ArrowRight className="h-4 w-4" />
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
