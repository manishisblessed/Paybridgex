"use client";

import { useState } from "react";
import {
  CreditCard,
  Link2,
  Copy,
  Check,
  IndianRupee,
  ArrowLeftRight,
  Percent,
  Banknote
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { StatTile } from "@/components/dashboard/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { pgTransactions, type PgTransaction } from "@/lib/data";
import { formatINR, generateRefId } from "@/lib/utils";

export default function PgPage() {
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);

  function createLink() {
    if (!amount) return;
    const ref = generateRefId("PAY");
    setLink(
      `https://pay.paybridgex.in/l/${ref.toLowerCase()}?am=${amount}`
    );
    setCopied(false);
  }

  function copy() {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  const cols: Column<PgTransaction>[] = [
    { key: "id", header: "Txn ID", render: (r) => <span className="font-mono text-xs">{r.id}</span> },
    { key: "orderId", header: "Order", render: (r) => <span className="font-mono text-xs">{r.orderId}</span> },
    { key: "mode", header: "Mode" },
    { key: "amount", header: "Amount", align: "right", render: (r) => <span className="font-semibold">{formatINR(r.amount)}</span> },
    { key: "fee", header: "Fee", align: "right", render: (r) => (r.fee ? formatINR(r.fee) : "—") },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge
          variant={
            r.status === "Success"
              ? "success"
              : r.status === "Pending"
                ? "warning"
                : r.status === "Refunded"
                  ? "brand"
                  : "danger"
          }
        >
          {r.status}
        </Badge>
      )
    },
    { key: "settlement", header: "Settlement" },
    { key: "date", header: "Date" }
  ];

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          eyebrow="Payment Gateway"
          title="PG Collections"
          description="Accept UPI, cards, net banking and wallets. Track every order with real-time status and automated T+1 settlement."
        />
      </Reveal>

      <Stagger stagger={0.05} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StaggerItem distance={14} duration={0.35}>
          <StatTile label="Today's Collections" value="₹1.28 L" hint={<span className="font-semibold text-emerald-600">+14.2%</span>} icon={IndianRupee} tone="brand" />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile label="Success Rate" value="96.8%" hint={<span className="font-semibold text-emerald-600">+0.6%</span>} icon={Percent} tone="emerald" />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile label="Transactions Today" value="42" hint={<span className="font-semibold text-emerald-600">+8</span>} icon={ArrowLeftRight} tone="violet" />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile label="Pending Settlement" value="₹2.69 L" icon={Banknote} tone="amber" />
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
                {purpose || "Payment request"} • ₹{amount}
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
        <DataTable
          title="Recent PG transactions"
          description="All orders collected through your payment gateway."
          columns={cols}
          data={pgTransactions}
        />
      </Reveal>
    </div>
  );
}
