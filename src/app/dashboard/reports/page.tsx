import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Stagger, StaggerItem } from "@/components/motion";
import { REPORT_LIST, type Accent } from "@/lib/reports/registry";

const ACCENT_BG: Record<Accent, string> = {
  brand: "from-brand-500 to-brand-700",
  accent: "from-accent-500 to-accent-600",
  emerald: "from-emerald-500 to-emerald-700",
  violet: "from-violet-500 to-violet-700",
};
const ACCENT_RING: Record<Accent, string> = {
  brand: "hover:border-brand-300",
  accent: "hover:border-accent-300",
  emerald: "hover:border-emerald-300",
  violet: "hover:border-violet-300",
};

export const dynamic = "force-dynamic";

export default function ReportsHubPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reports"
        title="Business reports"
        description="Real, ownership-scoped reports across funds, payments, payouts, commissions and settlements. Filter by date, preview, then export to CSV, Excel or PDF."
      />

      <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" stagger={0.04}>
        {REPORT_LIST.map((r) => {
          const Icon = r.icon;
          return (
            <StaggerItem key={r.type} distance={14} duration={0.35} className="h-full">
              <Link
                href={`/dashboard/reports/${r.type}`}
                className={`group flex h-full flex-col rounded-2xl border border-ink-100 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft ${ACCENT_RING[r.accent]}`}
              >
                <div className="flex items-start justify-between">
                  <span className={`grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br text-white shadow-soft ${ACCENT_BG[r.accent]}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <ArrowRight className="h-4 w-4 text-ink-300 transition group-hover:translate-x-1 group-hover:text-brand-600" />
                </div>
                <h3 className="mt-4 font-display text-base font-semibold text-ink-900">{r.short}</h3>
                <p className="mt-1 text-xs leading-relaxed text-ink-500">{r.description}</p>
              </Link>
            </StaggerItem>
          );
        })}
      </Stagger>
    </div>
  );
}
