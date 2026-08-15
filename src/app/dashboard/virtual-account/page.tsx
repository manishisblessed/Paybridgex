"use client";

import { Building2, Copy, Share2 } from "lucide-react";
import { useState } from "react";
import { ServicePageHeader } from "@/components/dashboard/ServicePage";
import { Button } from "@/components/ui/Button";

const account = {
  ifsc: "YESB0CMSNOC",
  number: "PPRSMV456789012345",
  beneficiary: "Paybridgex - Aman Sharma",
  branch: "Virtual Branch, Delhi"
};

export default function VirtualAccountPage() {
  const [copied, setCopied] = useState<string | null>(null);

  function copy(label: string, val: string) {
    navigator.clipboard.writeText(val);
    setCopied(label);
    setTimeout(() => setCopied(null), 1200);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <ServicePageHeader
        icon={Building2}
        title="Virtual Account"
        description="A unique IFSC + account number that auto-credits your wallet on every NEFT/IMPS deposit."
      />

      <div className="overflow-hidden rounded-3xl border border-ink-100 bg-gradient-to-br from-brand-700 via-brand-600 to-accent-500 p-6 text-white shadow-glow">
        <p className="text-xs font-semibold uppercase tracking-widest opacity-80">
          Beneficiary
        </p>
        <p className="mt-1 font-display text-lg font-semibold">
          {account.beneficiary}
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {[
            { k: "Account number", v: account.number },
            { k: "IFSC", v: account.ifsc },
            { k: "Branch", v: account.branch },
            { k: "Type", v: "Virtual current" }
          ].map((row) => (
            <div key={row.k} className="rounded-2xl bg-white/15 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest opacity-80">
                {row.k}
              </p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="font-mono text-sm font-semibold">{row.v}</p>
                <button
                  type="button"
                  onClick={() => copy(row.k, row.v)}
                  className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-1 text-[10px] font-semibold hover:bg-white hover:text-brand-700"
                >
                  <Copy className="h-3 w-3" />
                  {copied === row.k ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button>
          <Share2 className="h-4 w-4" />
          Share details
        </Button>
        <Button variant="outline">Generate QR for collection</Button>
      </div>

      <div className="mt-8 rounded-2xl border border-ink-100 bg-white p-6">
        <h3 className="font-display text-base font-semibold text-ink-900">
          How it works
        </h3>
        <ol className="mt-4 space-y-3 text-sm text-ink-700">
          {[
            "Share the above account number & IFSC with your customer.",
            "Customer transfers via UPI / IMPS / NEFT from any bank app.",
            "Funds auto-credit to your Paybridgex wallet within 30 seconds.",
            "You earn standard collection commission on every credit."
          ].map((s, i) => (
            <li key={s} className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
