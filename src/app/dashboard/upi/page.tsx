"use client";

import { useState } from "react";
import { QrCode, Copy, Check } from "lucide-react";
import { ServicePageHeader } from "@/components/dashboard/ServicePage";
import { Input, Label } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export default function UpiPage() {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const upiId = "paybridgex@axisbank";
  const link = `upi://pay?pa=${upiId}&pn=Paybridgex&am=${amount}&tn=${encodeURIComponent(
    note || "Paybridgex payment"
  )}&cu=INR`;

  function copy() {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  const qrSrc = `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(
    link
  )}`;

  return (
    <div className="mx-auto max-w-4xl">
      <ServicePageHeader
        icon={QrCode}
        title="UPI Collect"
        description="Generate UPI payment requests and accept payments instantly without a POS machine."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <form
          onSubmit={(e) => e.preventDefault()}
          className="space-y-4 rounded-2xl border border-ink-100 bg-white p-6"
        >
          <div>
            <Label htmlFor="amount">Amount (₹)</Label>
            <Input
              id="amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount"
            />
          </div>
          <div>
            <Label htmlFor="note">Note (optional)</Label>
            <Input
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Bill #4421"
            />
          </div>
          <div>
            <Label>Your UPI ID</Label>
            <div className="flex items-center justify-between rounded-xl border border-ink-200 bg-ink-50 px-4 py-3">
              <span className="font-mono text-sm font-semibold text-ink-900">
                {upiId}
              </span>
              <button
                type="button"
                onClick={copy}
                className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          </div>

          <Button type="button" size="lg" className="w-full">
            Send payment request
          </Button>
        </form>

        <div className="rounded-2xl border border-ink-100 bg-gradient-to-br from-brand-50 to-accent-50 p-6 text-center">
          <h3 className="font-display text-base font-semibold text-ink-900">
            Show this QR to your customer
          </h3>
          <p className="mt-1 text-xs text-ink-600">
            Works with PhonePe, Google Pay, Paytm & all UPI apps.
          </p>
          <div className="mx-auto mt-6 grid h-56 w-56 place-items-center rounded-2xl bg-white shadow-soft">
            <img
              src={qrSrc}
              alt="QR code"
              className="h-44 w-44 rounded-xl"
            />
          </div>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs text-ink-700 shadow-sm">
            Pay to <strong>{upiId}</strong>
            {amount && <span>• ₹{amount}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
