"use client";

import { useEffect, useState } from "react";
import {
  CreditCard,
  Link2,
  Copy,
  Check,
  IndianRupee,
  ArrowLeftRight,
  Percent,
  Banknote,
  RefreshCw,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { StatTile } from "@/components/dashboard/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { formatINR, generateRefId, formatIST } from "@/lib/utils";

// ── API types ─────────────────────────────────────────────────────────────────

type PgStats = {
  gross: number;
  mdr: number;
  net: number;
  count: number;
};

type PgTxn = {
  id: string;
  ref: string;
  gross: number;
  mdr: number;
  net: number;
  status: string;
  mode: string;
  paymentMode: string;
  provider: string;
  createdAt: string;
  settledAt: string | null;
};

type PgOverview = {
  today: PgStats;
  transactions: PgTxn[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
};

// ── Columns ───────────────────────────────────────────────────────────────────

const cols: Column<PgTxn>[] = [
  {
    key: "ref",
    header: "Reference",
    render: (r) => (
      <span className="font-mono text-xs text-ink-700">{r.ref.slice(0, 20)}</span>
    ),
  },
  {
    key: "paymentMode",
    header: "Mode",
    render: (r) => <span className="text-xs">{r.paymentMode}</span>,
  },
  {
    key: "provider",
    header: "Gateway",
    render: (r) => (
      <span className="text-xs font-medium text-brand-700">{r.provider}</span>
    ),
  },
  {
    key: "gross",
    header: "Gross",
    align: "right",
    render: (r) => (
      <span className="font-semibold text-ink-900">{formatINR(r.gross)}</span>
    ),
  },
  {
    key: "mdr",
    header: "Fee",
    align: "right",
    render: (r) => (
      <span className="text-amber-700">{r.mdr > 0 ? formatINR(r.mdr) : "—"}</span>
    ),
  },
  {
    key: "net",
    header: "Net credited",
    align: "right",
    render: (r) => (
      <span className="font-semibold text-emerald-700">{formatINR(r.net)}</span>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (r) => (
      <Badge
        variant={
          r.status === "SETTLED"
            ? "success"
            : r.status === "PENDING"
            ? "warning"
            : "danger"
        }
      >
        {r.status}
      </Badge>
    ),
  },
  {
    key: "mode",
    header: "Settlement",
    render: (r) => <span className="text-xs text-ink-500">{r.mode}</span>,
  },
  {
    key: "createdAt",
    header: "Date",
    render: (r) => (
      <span className="text-xs text-ink-500">
        {formatIST(r.createdAt, { dateStyle: "medium", timeStyle: "short" })}
      </span>
    ),
  },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PgPage() {
  const [overview, setOverview] = useState<PgOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  // Payment link state (kept from original — useful utility)
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);

  async function fetchOverview(p = 1) {
    setLoading(true);
    try {
      const res = await fetch(`/api/pg/overview?page=${p}`);
      if (res.ok) {
        const d = await res.json();
        setOverview(d);
        setPage(p);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchOverview(1);
  }, []);

  function createLink() {
    if (!amount) return;
    const ref = generateRefId("PAY");
    setLink(`https://pay.paybridgex.in/l/${ref.toLowerCase()}?am=${amount}`);
    setCopied(false);
  }

  function copy() {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  const today = overview?.today ?? { gross: 0, mdr: 0, net: 0, count: 0 };
  const successRate =
    today.count > 0 ? Math.round((today.count / today.count) * 100) : 0;

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
        <div className="flex items-center justify-between gap-3">
          <PageHeader
            eyebrow="Payment Gateway"
            title="PG Collections"
            description="Accept UPI, cards, net banking and wallets. Track every order with real-time status and automated T0 settlement."
          />
          <button
            onClick={() => fetchOverview(page)}
            disabled={loading}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-600 transition hover:bg-ink-200 disabled:animate-spin"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </Reveal>

      <Stagger stagger={0.05} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StaggerItem distance={14} duration={0.35}>
          <StatTile
            label="Today's Collections"
            value={loading ? "—" : formatINR(today.gross)}
            hint={
              today.net > 0 ? (
                <span className="text-emerald-600 font-semibold">
                  Net {formatINR(today.net)}
                </span>
              ) : undefined
            }
            icon={IndianRupee}
            tone="brand"
          />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile
            label="Gateway Fee"
            value={loading ? "—" : formatINR(today.mdr)}
            hint={
              today.gross > 0 ? (
                <span className="text-amber-600 font-semibold">
                  {((today.mdr / today.gross) * 100).toFixed(2)}% MDR
                </span>
              ) : undefined
            }
            icon={Percent}
            tone="amber"
          />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile
            label="Transactions Today"
            value={loading ? "—" : String(today.count)}
            hint={
              successRate > 0 ? (
                <span className="text-emerald-600 font-semibold">
                  {successRate}% settled
                </span>
              ) : undefined
            }
            icon={ArrowLeftRight}
            tone="violet"
          />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile
            label="Net Wallet Credit"
            value={loading ? "—" : formatINR(today.net)}
            icon={Banknote}
            tone="emerald"
          />
        </StaggerItem>
      </Stagger>

      <Reveal distance={16} duration={0.45}>
        <div className="grid gap-6 lg:grid-cols-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createLink();
            }}
            className="space-y-4 rounded-2xl border border-ink-100 bg-white p-6 shadow-sm"
          >
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white">
                <Link2 className="h-4 w-4" />
              </span>
              <h3 className="font-display text-base font-semibold text-ink-900">
                Create payment link
              </h3>
            </div>
            <div>
              <Label htmlFor="pg-amount">Amount (₹)</Label>
              <Input
                id="pg-amount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Enter amount"
              />
            </div>
            <div>
              <Label htmlFor="pg-purpose">Purpose (optional)</Label>
              <Input
                id="pg-purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="e.g. Invoice #4427"
              />
            </div>
            <Button type="submit" size="lg" className="w-full">
              <CreditCard className="h-4 w-4" /> Generate link
            </Button>
          </form>

          <div className="rounded-2xl border border-ink-100 bg-gradient-to-br from-brand-50 to-accent-50 p-6 shadow-sm">
            <h3 className="font-display text-base font-semibold text-ink-900">
              Share with your customer
            </h3>
            <p className="mt-1 text-xs text-ink-600">
              Customers can pay via UPI, debit/credit cards, net banking and
              wallets. You get notified instantly.
            </p>
            {link ? (
              <div className="mt-6 space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3">
                  <span className="truncate font-mono text-xs font-semibold text-ink-900">
                    {link}
                  </span>
                  <button
                    type="button"
                    onClick={copy}
                    className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-brand-700"
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs text-ink-700 shadow-sm">
                  {purpose || "Payment request"} · ₹{amount}
                </div>
              </div>
            ) : (
              <div className="mt-6 grid h-32 place-items-center rounded-xl border border-dashed border-ink-200 bg-white/60 text-xs text-ink-500">
                Enter an amount and generate a link to see it here.
              </div>
            )}
          </div>
        </div>
      </Reveal>

      <Reveal distance={16} duration={0.45}>
        <DataTable<PgTxn>
          title="PG Settlement history"
          description={
            overview
              ? `${overview.pagination.total} total entries — page ${page} of ${overview.pagination.pages}`
              : "Loading…"
          }
          columns={cols}
          data={overview?.transactions ?? []}
          loading={loading}
          empty="No PG settlements yet. Top-up your wallet via a Chagans gateway to see entries here."
          action={
            overview && overview.pagination.pages > 1 ? (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => fetchOverview(page - 1)}
                >
                  Prev
                </Button>
                <span className="text-xs text-ink-500">
                  {page} / {overview.pagination.pages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  disabled={page >= overview.pagination.pages}
                  onClick={() => fetchOverview(page + 1)}
                >
                  Next
                </Button>
              </div>
            ) : undefined
          }
        />
      </Reveal>
    </div>
  );
}
