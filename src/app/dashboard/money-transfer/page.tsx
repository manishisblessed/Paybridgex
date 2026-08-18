"use client";

import { useState } from "react";
import { Send, Info } from "lucide-react";
import { ServicePageHeader } from "@/components/dashboard/ServicePage";
import { Reveal } from "@/components/motion";
import { Input, Label, Select } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  TransactionResult,
  type TxnResult
} from "@/components/dashboard/TransactionResult";
import { generateRefId, formatINR } from "@/lib/utils";

const banks = [
  "State Bank of India",
  "HDFC Bank",
  "ICICI Bank",
  "Axis Bank",
  "Punjab National Bank",
  "Bank of Baroda",
  "Canara Bank",
  "Kotak Mahindra Bank",
  "Yes Bank",
  "IndusInd Bank"
];

export default function MoneyTransferPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TxnResult>(null);
  const [form, setForm] = useState({
    name: "",
    account: "",
    ifsc: "",
    bank: banks[0],
    amount: "",
    mode: "IMPS"
  });

  function update<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await new Promise((r) => setTimeout(r, 900));
    setLoading(false);
    setResult({
      refId: generateRefId("DMT"),
      service: `Money Transfer (${form.mode}) — ${form.bank}`,
      amount: Number(form.amount),
      customer: form.name,
      meta: {
        Account: form.account,
        IFSC: form.ifsc,
        Charges: "₹ 5"
      }
    });
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Reveal distance={14} duration={0.4}>
        <ServicePageHeader
          icon={Send}
          title="Domestic Money Transfer"
          description="Send money instantly to any bank account in India via IMPS, NEFT or RTGS."
        />
      </Reveal>

      <Reveal distance={16} duration={0.45} className="grid gap-6 lg:grid-cols-3">
        <form
          onSubmit={submit}
          className="lg:col-span-2 grid gap-4 rounded-2xl border border-ink-100 bg-white p-6 shadow-sm sm:grid-cols-2"
        >
          <div className="sm:col-span-2">
            <Label htmlFor="name">Beneficiary name</Label>
            <Input
              id="name"
              required
              placeholder="As per bank records"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="account">Account number</Label>
            <Input
              id="account"
              required
              placeholder="9-18 digits"
              value={form.account}
              onChange={(e) => update("account", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="ifsc">IFSC code</Label>
            <Input
              id="ifsc"
              required
              placeholder="e.g. SBIN0001234"
              value={form.ifsc}
              onChange={(e) => update("ifsc", e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <Label htmlFor="bank">Bank</Label>
            <Select
              id="bank"
              value={form.bank}
              onChange={(e) => update("bank", e.target.value)}
            >
              {banks.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="mode">Transfer mode</Label>
            <Select
              id="mode"
              value={form.mode}
              onChange={(e) => update("mode", e.target.value)}
            >
              {["IMPS", "NEFT", "RTGS"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="amount">Amount (₹)</Label>
            <Input
              id="amount"
              required
              type="number"
              min={1}
              placeholder="Enter amount"
              value={form.amount}
              onChange={(e) => update("amount", e.target.value)}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {[500, 1000, 2000, 5000, 10000].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => update("amount", String(v))}
                  className="rounded-full border border-ink-200 bg-white px-3 py-1 text-xs font-medium text-ink-700 transition-all duration-150 hover:-translate-y-0.5 hover:border-brand-300 hover:text-brand-700 hover:shadow-sm"
                >
                  + {formatINR(v)}
                </button>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" size="lg" className="w-full" disabled={loading} isLoading={loading}>
              Send {form.amount ? formatINR(Number(form.amount)) : "money"}
            </Button>
          </div>
        </form>

        <aside className="rounded-2xl border border-ink-100 bg-gradient-to-br from-brand-50 to-accent-50 p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-500 text-white shadow-soft">
              <Info className="h-4 w-4" />
            </span>
            <h3 className="font-display text-base font-semibold text-ink-900">
              Transfer info
            </h3>
          </div>
          <ul className="mt-4 space-y-3 text-sm text-ink-700">
            <li>
              <span className="font-semibold text-ink-900">IMPS:</span>{" "}
              instant, 24×7 (₹1 to ₹2 lakh)
            </li>
            <li>
              <span className="font-semibold text-ink-900">NEFT:</span>{" "}
              batch-based, every 30 mins
            </li>
            <li>
              <span className="font-semibold text-ink-900">RTGS:</span>{" "}
              high-value (₹2 lakh+), instant
            </li>
            <li>
              <span className="font-semibold text-ink-900">Charges:</span>{" "}
              ₹5–₹25 based on amount
            </li>
            <li>
              <span className="font-semibold text-ink-900">
                Commission to you:
              </span>{" "}
              0.4–0.6% per transaction
            </li>
          </ul>
        </aside>
      </Reveal>

      <TransactionResult result={result} onClose={() => setResult(null)} />
    </div>
  );
}
