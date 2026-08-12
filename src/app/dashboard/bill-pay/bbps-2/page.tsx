"use client";

import { useState } from "react";
import {
  Receipt,
  Lightbulb,
  Droplets,
  Flame,
  GraduationCap,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import { ServicePageHeader } from "@/components/dashboard/ServicePage";
import { BbpsBillForm } from "@/components/dashboard/BbpsBillForm";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "electricity",  label: "Electricity",  icon: Lightbulb,     category: "ELECTRICITY"  as const, consumer: "Consumer number",       ref: "ELEC" },
  { key: "water",        label: "Water",         icon: Droplets,      category: "WATER"        as const, consumer: "K-number / Connection #", ref: "WATR" },
  { key: "gas",          label: "Gas",           icon: Flame,         category: "GAS"          as const, consumer: "Consumer / Booking #",  ref: "GAS"  },
  { key: "education",    label: "Education",     icon: GraduationCap, category: "EDUCATION"    as const, consumer: "Student / Enrolment #", ref: "EDU"  },
  { key: "insurance",    label: "Insurance",     icon: ShieldCheck,   category: "INSURANCE"    as const, consumer: "Policy number",         ref: "INS"  },
  { key: "broadband",    label: "Broadband",     icon: Wifi,          category: "BROADBAND"    as const, consumer: "Account / Customer ID", ref: "BB"   },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function Bbps2Page() {
  const [tab, setTab] = useState<TabKey>("electricity");
  const active = TABS.find((t) => t.key === tab)!;

  return (
    <div className="mx-auto max-w-3xl">
      <ServicePageHeader
        icon={Receipt}
        title="Unified Bill Payment Platform"
        description="Utility bill payments via Unified Bill Payment Platform — electricity, water, gas, education, insurance, and broadband."
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

      <BbpsBillForm
        key={active.key}
        category={active.category}
        serviceTitle={active.label}
        consumerLabel={active.consumer}
        refPrefix={active.ref}
        route={SERVICE_KEYS.BBPS_BULKPE}
      />
    </div>
  );
}
