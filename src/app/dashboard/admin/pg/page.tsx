"use client";

import { CreditCard, Store, IndianRupee, Percent } from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { DataTable, type Column } from "@/components/dashboard/DataTable";
import { StatTile, StatusPill } from "@/components/dashboard/ui";
import { Button } from "@/components/ui/Button";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { formatINR } from "@/lib/utils";

type PgMerchant = {
  mid: string;
  business: string;
  name: string;
  city: string;
  modes: string[];
  mdr: string;
  volume30d: number;
  status: string;
  onboarded: string;
};

type PgTransaction = {
  id: string;
  merchant: string;
  mode: string;
  amount: number;
  fee: number | null;
  status: string;
  settlement: string;
  date: string;
};

export default function AdminPgPage() {
  const merchants: PgMerchant[] = [];
  const transactions: PgTransaction[] = [];

  const merchantCols: Column<PgMerchant>[] = [
    { key: "mid", header: "MID", render: (r) => <span className="font-mono text-xs">{r.mid}</span> },
    {
      key: "business",
      header: "Merchant",
      render: (r) => (
        <div>
          <p className="font-semibold text-ink-900">{r.business}</p>
          <p className="text-xs text-ink-500">{r.name} · {r.city}</p>
        </div>
      )
    },
    { key: "modes", header: "Modes", render: (r) => <span className="text-xs">{r.modes.join(", ")}</span> },
    { key: "mdr", header: "MDR / Scheme", render: (r) => <span className="text-xs">{r.mdr}</span> },
    { key: "volume30d", header: "Volume (30d)", align: "right", render: (r) => <span className="font-semibold">{formatINR(r.volume30d)}</span> },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <StatusPill
          status={r.status}
          tone={r.status === "Live" ? "success" : r.status === "Pending KYC" ? "warning" : "danger"}
        />
      )
    },
    { key: "onboarded", header: "Onboarded" }
  ];

  const txnCols: Column<PgTransaction>[] = [
    { key: "id", header: "Txn ID", render: (r) => <span className="font-mono text-xs">{r.id}</span> },
    { key: "merchant", header: "Merchant" },
    { key: "mode", header: "Mode" },
    { key: "amount", header: "Amount", align: "right", render: (r) => <span className="font-semibold">{formatINR(r.amount)}</span> },
    { key: "fee", header: "MDR Fee", align: "right", render: (r) => (r.fee ? formatINR(r.fee) : "—") },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <StatusPill
          status={r.status}
          tone={r.status === "Success" ? "success" : r.status === "Pending" ? "warning" : r.status === "Refunded" ? "brand" : "danger"}
        />
      )
    },
    { key: "settlement", header: "Settlement" },
    { key: "date", header: "Date" }
  ];

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          eyebrow="Admin"
          title="Payment Gateway"
          description="Merchant onboarding, MDR & scheme configuration, transaction monitoring and settlement control for the PG vertical."
          actions={
            <Button>
              <Store className="h-4 w-4" /> Onboard merchant
            </Button>
          }
        />
      </Reveal>

      <Stagger stagger={0.05} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StaggerItem distance={14} duration={0.35}>
          <StatTile label="Live Merchants" countTo={0} icon={Store} tone="brand" />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile label="GMV (30d)" value={formatINR(0)} icon={IndianRupee} tone="emerald" />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile label="MDR Revenue (30d)" value={formatINR(0)} icon={Percent} tone="violet" />
        </StaggerItem>
        <StaggerItem distance={14} duration={0.35}>
          <StatTile label="Success Rate" value="—" icon={CreditCard} tone="sky" />
        </StaggerItem>
      </Stagger>

      <Reveal distance={16} duration={0.45}>
        <DataTable
          title="Merchant master"
          description="All PG merchants with KYC status, enabled modes and MDR schemes."
          columns={merchantCols}
          data={merchants}
        />
      </Reveal>

      <Reveal distance={16} duration={0.45}>
        <DataTable
          title="Live transaction feed"
          description="Latest orders across all merchants, with settlement state."
          columns={txnCols}
          data={transactions}
        />
      </Reveal>
    </div>
  );
}
