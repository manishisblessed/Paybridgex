"use client";

import Link from "next/link";
import { Settings, Bell, ShieldCheck, KeyRound, Mail, Lock, ChevronRight } from "lucide-react";
import { ServicePageHeader } from "@/components/dashboard/ServicePage";
import { Panel } from "@/components/dashboard/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";

const groups = [
  {
    title: "Notifications",
    icon: Bell,
    items: [
      { label: "Transaction alerts (SMS)", on: true },
      { label: "Daily summary email", on: true },
      { label: "Marketing & offers", on: false },
      { label: "Commission credit alerts", on: true }
    ]
  },
  {
    title: "Security",
    icon: ShieldCheck,
    items: [
      { label: "Two-factor authentication (2FA)", on: true },
      { label: "Login alerts to email", on: true },
      { label: "Trusted devices remembered", on: true },
      { label: "Auto-logout after 15 min idle", on: false }
    ]
  },
  {
    title: "Communication preferences",
    icon: Mail,
    items: [
      { label: "WhatsApp updates", on: true },
      { label: "Voice call OTP fallback", on: false }
    ]
  }
];

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <Reveal distance={14} duration={0.4}>
        <ServicePageHeader
          icon={Settings}
          title="Settings"
          description="Manage your notification, security and communication preferences."
        />
      </Reveal>

      <Stagger className="space-y-6" stagger={0.05}>
        {groups.map((g) => {
          const Icon = g.icon;
          return (
            <StaggerItem key={g.title} distance={14} duration={0.35}>
              <Panel flush className="overflow-hidden">
                <div className="flex items-center gap-3 border-b border-ink-100 px-6 py-4">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-soft">
                    <Icon className="h-4 w-4" />
                  </span>
                  <h3 className="font-display text-base font-semibold text-ink-900">
                    {g.title}
                  </h3>
                </div>
                <ul className="divide-y divide-ink-100 px-2 py-1">
                  {g.items.map((it) => (
                    <li
                      key={it.label}
                      className="flex items-center justify-between rounded-xl px-4 py-4 text-sm transition hover:bg-ink-50/60"
                    >
                      <span className="text-ink-700">{it.label}</span>
                      <Toggle defaultOn={it.on} />
                    </li>
                  ))}
                </ul>
              </Panel>
            </StaggerItem>
          );
        })}

        <StaggerItem distance={14} duration={0.35}>
          <Link
            href="/dashboard/settings/txn-pin"
            className="flex items-center justify-between rounded-2xl border border-brand-200 bg-gradient-to-r from-brand-50/70 to-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-soft"
          >
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-500 text-white shadow-soft">
                <Lock className="h-4 w-4" />
              </span>
              <div>
                <h3 className="font-display text-base font-semibold text-ink-900">
                  Transaction PIN
                </h3>
                <p className="mt-1 text-xs text-ink-500">
                  The 4-digit PIN that confirms every payment — bill pay, recharge,
                  transfers and payouts. Set it up or change it here.
                </p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-ink-400" />
          </Link>
        </StaggerItem>

        <StaggerItem distance={14} duration={0.35}>
          <Panel className="p-6">
            <h3 className="font-display text-base font-semibold text-ink-900">
              Change password
            </h3>
            <p className="mt-1 text-xs text-ink-500">
              Use a strong password you don't reuse anywhere else.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <KeyRound className="h-4 w-4 text-ink-500" />
              <button className="text-sm font-semibold text-brand-700 hover:underline">
                Send reset link to my email
              </button>
            </div>
          </Panel>
        </StaggerItem>
      </Stagger>
    </div>
  );
}

function Toggle({ defaultOn }: { defaultOn: boolean }) {
  return (
    <label className="relative inline-flex cursor-pointer items-center">
      <input type="checkbox" defaultChecked={defaultOn} className="peer sr-only" />
      <div className="h-6 w-11 rounded-full bg-ink-200 transition peer-checked:bg-brand-600" />
      <div className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
    </label>
  );
}
