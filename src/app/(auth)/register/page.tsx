"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, AlertCircle, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select } from "@/components/ui/Input";
import { Turnstile, captchaConfigured } from "@/components/security/Turnstile";

const roleMap = {
  retailer: "RETAILER",
  distributor: "DISTRIBUTOR",
  "master-distributor": "MASTER_DISTRIBUTOR",
} as const;

const STATES = [
  "Delhi",
  "Uttar Pradesh",
  "Bihar",
  "Maharashtra",
  "Karnataka",
  "Tamil Nadu",
  "West Bengal",
  "Punjab",
  "Rajasthan",
  "Gujarat",
  "Other",
];

export default function JoinPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    shopName: "",
    city: "",
    state: "Delhi",
    message: "",
    role: "retailer" as keyof typeof roleMap,
  });

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone.replace(/\s/g, ""),
          shopName: form.shopName || undefined,
          city: form.city || undefined,
          state: form.state || undefined,
          role: roleMap[form.role],
          message: form.message || undefined,
          captchaToken,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(
          typeof data.error === "string"
            ? data.error
            : "Could not submit your request. Please try again."
        );
        setLoading(false);
        return;
      }

      setSubmitted(true);
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="grid w-full max-w-5xl gap-8 lg:grid-cols-2">
      <div className="hidden flex-col justify-between rounded-3xl bg-gradient-to-br from-accent-500 via-brand-600 to-brand-700 p-10 text-white shadow-glow lg:flex">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-widest">
            Become an Agent
          </span>
          <h2 className="mt-6 font-display text-3xl font-bold leading-tight">
            Start earning from your{" "}
            <span className="bg-gradient-to-r from-amber-200 to-white bg-clip-text text-transparent">
              very first transaction.
            </span>
          </h2>
          <p className="mt-3 text-white/85">
            Share your details and our onboarding team will call you back, verify
            your KYC and get you live with 60+ services.
          </p>
        </div>

        <ul className="space-y-3 text-sm">
          {[
            "Zero joining fee, zero hidden charges",
            "Free RuPay business card on activation",
            "Earn up to 1.2% commission per transaction",
            "24x7 WhatsApp & phone support",
          ].map((t) => (
            <li key={t} className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              {t}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-3xl border border-ink-100 bg-white p-8 shadow-soft md:p-10">
        {submitted ? (
          <div className="flex flex-col items-center py-6 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-9 w-9" />
            </div>
            <h1 className="heading-md mt-6">Request received!</h1>
            <p className="mt-3 max-w-sm text-sm text-ink-500">
              Thanks{form.name ? `, ${form.name.split(" ")[0]}` : ""}! Our
              onboarding team will connect with you shortly on{" "}
              <span className="font-semibold text-ink-700">{form.phone}</span> to
              complete your setup.
            </p>
            <div className="mt-6 flex w-full max-w-xs flex-col gap-3">
              <div className="flex items-center gap-2 rounded-xl border border-ink-100 bg-ink-50/60 px-4 py-3 text-left text-sm text-ink-600">
                <PhoneCall className="h-4 w-4 shrink-0 text-brand-600" />
                Keep your Aadhaar, PAN & bank details handy for eKYC.
              </div>
              <Link href="/">
                <Button variant="outline" size="lg" className="w-full">
                  Back to home
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <>
            <h1 className="heading-md">Join Paybridgex</h1>
            <p className="mt-2 text-sm text-ink-500">
              Fill in your details — our support team will reach out and complete
              your onboarding. Already a member?{" "}
              <Link href="/login" className="font-semibold text-brand-700">
                Login here
              </Link>
            </p>

            {error && (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <form
              className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2"
              onSubmit={onSubmit}
            >
              <div className="sm:col-span-2">
                <Label htmlFor="name">Full name</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder="As per Aadhaar"
                  required
                />
              </div>
              <div>
                <Label htmlFor="phone">Mobile</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => update("phone", e.target.value)}
                  placeholder="10-digit mobile"
                  required
                />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                  placeholder="you@email.com"
                  required
                />
              </div>
              <div>
                <Label htmlFor="shopName">Shop / Business name</Label>
                <Input
                  id="shopName"
                  value={form.shopName}
                  onChange={(e) => update("shopName", e.target.value)}
                  placeholder="e.g. Sharma Mobile World"
                />
              </div>
              <div>
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={form.city}
                  onChange={(e) => update("city", e.target.value)}
                  placeholder="e.g. Ahmedabad"
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="state">State</Label>
                <Select
                  id="state"
                  value={form.state}
                  onChange={(e) => update("state", e.target.value)}
                >
                  {STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label>I want to join as</Label>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  {(["retailer", "distributor", "master-distributor"] as const).map(
                    (r) => (
                      <button
                        type="button"
                        key={r}
                        onClick={() => update("role", r)}
                        className={`rounded-xl border px-3 py-2 text-sm font-medium capitalize transition ${
                          form.role === r
                            ? "border-brand-500 bg-brand-50 text-brand-700"
                            : "border-ink-200 bg-white text-ink-700 hover:border-ink-300"
                        }`}
                      >
                        {r.replace("-", " ")}
                      </button>
                    )
                  )}
                </div>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="message">Message (optional)</Label>
                <textarea
                  id="message"
                  value={form.message}
                  onChange={(e) => update("message", e.target.value)}
                  placeholder="Tell us anything that helps us onboard you faster."
                  rows={3}
                  maxLength={1000}
                  className="flex w-full rounded-xl border border-ink-200 bg-white px-4 py-2.5 text-sm text-ink-900 shadow-sm transition placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="flex items-start gap-2 text-xs text-ink-600">
                  <input
                    type="checkbox"
                    defaultChecked
                    required
                    className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                  />
                  I agree to be contacted by Paybridgex and accept the{" "}
                  <Link href="/legal/terms" className="font-semibold text-brand-700">
                    Terms
                  </Link>{" "}
                  &{" "}
                  <Link
                    href="/legal/privacy"
                    className="font-semibold text-brand-700"
                  >
                    Privacy Policy
                  </Link>
                  .
                </label>
              </div>
              <div className="sm:col-span-2">
                <Turnstile
                  onToken={setCaptchaToken}
                  className="mb-3 flex justify-center"
                />
                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={loading || (captchaConfigured && !captchaToken)}
                >
                  {loading ? "Submitting..." : "Submit join request"}
                </Button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
