"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/dashboard/ui";
import { Reveal } from "@/components/motion";
import { formatINR, formatNumber } from "@/lib/utils";
import { RefreshCw, ShieldAlert, Banknote, HandCoins, AlertTriangle } from "lucide-react";

type MoneyAtRisk = {
  generatedAt: string;
  payoutReview: { count: number; exposure: number };
  txnAnomalies: { count: number; exposure: number };
  outstandingLiens: { count: number; amount: number };
  totalAtRisk: number;
};

type Card = {
  key: string;
  label: string;
  value: string;
  sub: string;
  href: string;
  cta: string;
  icon: typeof ShieldAlert;
  tone: "danger" | "warning" | "neutral";
};

const toneRing: Record<Card["tone"], string> = {
  danger: "ring-rose-200/70 bg-rose-50",
  warning: "ring-amber-200/70 bg-amber-50",
  neutral: "ring-ink-200/70 bg-ink-50",
};
const toneIcon: Record<Card["tone"], string> = {
  danger: "bg-rose-100 text-rose-600",
  warning: "bg-amber-100 text-amber-600",
  neutral: "bg-ink-100 text-ink-600",
};

export default function MoneyAtRiskPage() {
  const [data, setData] = useState<MoneyAtRisk | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/exposure");
      const d = await res.json();
      if (!res.ok) throw new Error(typeof d?.error === "string" ? d.error : "Failed to load");
      setData(d);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const cards: Card[] = data
    ? [
        {
          key: "payouts",
          label: "Payouts under review",
          value: formatINR(data.payoutReview.exposure),
          sub: `${formatNumber(data.payoutReview.count)} held after an indeterminate send`,
          href: "/dashboard/admin/payout-review",
          cta: "Open payout review",
          icon: Banknote,
          tone: data.payoutReview.count > 0 ? "warning" : "neutral",
        },
        {
          key: "anomalies",
          label: "Transaction anomalies",
          value: formatINR(data.txnAnomalies.exposure),
          sub: `${formatNumber(data.txnAnomalies.count)} open on the Reversal Desk`,
          href: "/dashboard/admin/reversals",
          cta: "Open Reversal Desk",
          icon: AlertTriangle,
          tone: data.txnAnomalies.count > 0 ? "danger" : "neutral",
        },
        {
          key: "liens",
          label: "Outstanding liens",
          value: formatINR(data.outstandingLiens.amount),
          sub: `${formatNumber(data.outstandingLiens.count)} active · still recovering from retailers`,
          href: "/dashboard/admin/wallet-ops?tab=liens",
          cta: "View liens",
          icon: HandCoins,
          tone: data.outstandingLiens.count > 0 ? "warning" : "neutral",
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          title="Money at Risk"
          description="Every rupee currently exposed but not yet resolved — held payouts, open transaction anomalies, and outstanding liens — in one place."
          actions={
            <Button variant="outline" onClick={load}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
          }
        />
      </Reveal>

      <Reveal distance={16} duration={0.45}>
        <Panel>
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
              <ShieldAlert className="h-6 w-6" />
            </span>
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-500">Total at risk</p>
              <p className="text-3xl font-semibold text-ink-900">
                {loading || !data ? "—" : formatINR(data.totalAtRisk)}
              </p>
              {data && (
                <p className="mt-0.5 text-xs text-ink-400">
                  as of {new Date(data.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                </p>
              )}
            </div>
          </div>
        </Panel>
      </Reveal>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {cards.map((c, i) => {
          const Icon = c.icon;
          return (
            <Reveal key={c.key} distance={16} duration={0.45} delay={0.05 * i}>
              <Panel className={`ring-1 ${toneRing[c.tone]}`}>
                <div className="flex items-start justify-between">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${toneIcon[c.tone]}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                </div>
                <p className="mt-3 text-xs uppercase tracking-wide text-ink-500">{c.label}</p>
                <p className="mt-1 text-2xl font-semibold text-ink-900">{loading ? "—" : c.value}</p>
                <p className="mt-0.5 text-xs text-ink-500">{c.sub}</p>
                <Link href={c.href} className="mt-3 inline-block">
                  <Button size="sm" variant="outline">
                    {c.cta}
                  </Button>
                </Link>
              </Panel>
            </Reveal>
          );
        })}
      </div>
    </div>
  );
}
