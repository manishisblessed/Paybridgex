import type { LucideIcon } from "lucide-react";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";

export function ServicePageHeader({
  icon: Icon,
  title,
  description,
  back = "/dashboard"
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  back?: string;
}) {
  return (
    <div className="mb-8 flex items-start justify-between gap-4">
      <div className="flex items-start gap-4">
        <span className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-500 to-accent-500 text-white shadow-glow">
          <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_0%_0%,rgba(255,255,255,0.25)_0%,transparent_60%)]" aria-hidden />
          <Icon className="relative h-6 w-6" />
        </span>
        <div className="min-w-0">
          <Link
            href={back}
            className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 transition-colors hover:text-brand-700"
          >
            <ChevronLeft className="h-3 w-3" /> Back
          </Link>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900 md:text-3xl">
            {title}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-500">{description}</p>
        </div>
      </div>
    </div>
  );
}
