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
import { TabNav } from "@/components/dashboard/ui";
import { Reveal } from "@/components/motion";
import { SERVICE_KEYS } from "@/lib/services/catalog";

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
      <Reveal distance={14} duration={0.4}>
        <ServicePageHeader
          icon={Receipt}
          title="Unified Bill Payment Platform"
          description="Utility bill payments via Unified Bill Payment Platform — electricity, water, gas, education, insurance, and broadband."
        />
      </Reveal>

      <TabNav
        className="mb-6"
        tabs={TABS.map((t) => ({ key: t.key, label: t.label, icon: t.icon }))}
        active={tab}
        onChange={(k) => setTab(k as TabKey)}
      />

      <Reveal distance={16} duration={0.45}>
        <BbpsBillForm
          key={active.key}
          category={active.category}
          serviceTitle={active.label}
          consumerLabel={active.consumer}
          refPrefix={active.ref}
          route={SERVICE_KEYS.BBPS_BULKPE}
        />
      </Reveal>
    </div>
  );
}
