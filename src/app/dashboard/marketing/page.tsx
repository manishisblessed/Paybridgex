"use client";

import { Megaphone, Mail, MessageSquare, Image as ImageIcon } from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Button } from "@/components/ui/Button";
import { StatTile, TablePro, StatusPill, type StatTone } from "@/components/dashboard/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";

const campaigns = [
  { id: "C1", name: "AePS double cashback weekend", channel: "WhatsApp", reach: 8420, ctr: "12.4%", status: "Live" },
  { id: "C2", name: "Recharge ₹100 + ₹10 cashback", channel: "SMS", reach: 24812, ctr: "4.8%", status: "Live" },
  { id: "C3", name: "Distributor onboarding drive", channel: "Email", reach: 1248, ctr: "8.1%", status: "Scheduled" },
  { id: "C4", name: "BBPS bills ka dhamaka", channel: "In-app", reach: 38400, ctr: "15.2%", status: "Ended" }
];

export default function MarketingPage() {
  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          eyebrow="Platform"
          title="Marketing tools"
          description="WhatsApp / SMS / Email blasts, in-app banners, and ready-made creatives for your network."
          actions={<Button><Megaphone className="h-4 w-4" /> New campaign</Button>}
        />
      </Reveal>

      <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" stagger={0.05}>
        {(
          [
            { icon: MessageSquare, l: "WhatsApp templates", v: 24, tone: "emerald" },
            { icon: Mail, l: "Email campaigns (MTD)", v: 12, tone: "brand" },
            { icon: ImageIcon, l: "Creative assets", v: 182, tone: "violet" },
            { icon: Megaphone, l: "Active push", v: 6, tone: "amber" }
          ] as { icon: typeof Megaphone; l: string; v: number; tone: StatTone }[]
        ).map((s) => (
          <StaggerItem key={s.l} distance={14} duration={0.35}>
            <StatTile label={s.l} countTo={s.v} icon={s.icon} tone={s.tone} className="h-full" />
          </StaggerItem>
        ))}
      </Stagger>

      <Reveal distance={16} duration={0.45}>
        <TablePro title="Recent campaigns">
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Channel</th>
                <th className="text-right">Reach</th>
                <th className="text-right">CTR</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td className="font-semibold text-ink-900">{c.name}</td>
                  <td>{c.channel}</td>
                  <td className="text-right">{c.reach.toLocaleString("en-IN")}</td>
                  <td className="text-right">{c.ctr}</td>
                  <td>
                    <StatusPill
                      status={c.status}
                      tone={c.status === "Scheduled" ? "warning" : undefined}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TablePro>
      </Reveal>
    </div>
  );
}
