"use client";

import { useState } from "react";
import {
  Receipt,
  CreditCard,
  Lightbulb,
  Droplets,
  Flame,
  GraduationCap,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import { ServicePageHeader } from "@/components/dashboard/ServicePage";
import { CreditCardBillForm } from "@/components/dashboard/CreditCardBillForm";
import { BbpsBillForm } from "@/components/dashboard/BbpsBillForm";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "credit-card", label: "Credit Card",  icon: CreditCard,    category: "CREDIT_CARD"  as const, consumer: "Card last 4 digits",     ref: "CC",   form: "cc" },
  { key: "electricity", label: "Electricity",   icon: Lightbulb,     category: "ELECTRICITY"  as const, consumer: "Consumer number",         ref: "ELEC", form: "bbps" },
  { key: "water",       label: "Water",          icon: Droplets,      category: "WATER"        as const, consumer: "K-number / Connection #", ref: "WATR", form: "bbps" },
  { key: "gas",         label: "Gas",            icon: Flame,         category: "GAS"          as const, consumer: "Consumer / Booking #",    ref: "GAS",  form: "bbps" },
  { key: "education",   label: "Education",      icon: GraduationCap, category: "EDUCATION"    as const, consumer: "Student / Enrolment #",   ref: "EDU",  form: "bbps" },
  { key: "insurance",   label: "Insurance",      icon: ShieldCheck,   category: "INSURANCE"    as const, consumer: "Policy number",           ref: "INS",  form: "bbps" },
  { key: "broadband",   label: "Broadband",      icon: Wifi,          category: "BROADBAND"    as const, consumer: "Account / Customer ID",   ref: "BB",   form: "bbps" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function Bbps1Page() {
  const [tab, setTab] = useState<TabKey>("credit-card");
  const active = TABS.find((t) => t.key === tab)!;

  return (
    <div className="mx-auto max-w-3xl">
      <ServicePageHeader
        icon={Receipt}
        title="BBPS-Bharat BillPay"
        description="Bill payments powered by Bharat BillPay — pay credit card bills, electricity, water, gas, education, insurance, and broadband via BBPS."
      />

      <div className="mb-6 flex gap-2 overflow-x-auto rounded-xl border border-ink-100 bg-ink-50 p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium transition-all",
                tab === t.key
                  ? "bg-white text-brand-700 shadow-sm"
                  : "text-ink-500 hover:text-ink-900"
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {active.form === "cc" ? (
        <CreditCardBillForm route={SERVICE_KEYS.BBPS_SAMEDAY} />
      ) : (
        <BbpsBillForm
          key={active.key}
          category={active.category as "ELECTRICITY" | "WATER" | "GAS" | "EDUCATION" | "INSURANCE" | "BROADBAND"}
          serviceTitle={active.label}
          consumerLabel={active.consumer}
          refPrefix={active.ref}
          route={SERVICE_KEYS.BBPS_SAMEDAY}
        />
      )}
    </div>
  );
}
