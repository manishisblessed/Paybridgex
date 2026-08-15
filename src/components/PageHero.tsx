import { Container } from "@/components/ui/Container";

/**
 * Inner-page hero — left-aligned on a soft two-tone wash with the
 * Paybridgex bridge-arc watermark in the corner.
 */
export function PageHero({
  eyebrow,
  title,
  description
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <section className="relative overflow-hidden border-b border-ink-100 bg-gradient-to-br from-brand-50/70 via-white to-accent-50/50 pb-12 pt-12 md:pb-16 md:pt-20">
      {/* bridge-arc watermark */}
      <svg
        viewBox="0 0 800 240"
        className="pointer-events-none absolute -right-24 -top-10 -z-0 w-[560px] opacity-[0.08]"
        fill="none"
        aria-hidden
      >
        <path d="M0 220 C 220 40, 580 40, 800 220" stroke="#1b45ea" strokeWidth="6" />
        <path d="M40 240 H760" stroke="#10b981" strokeWidth="6" />
        {["160", "280", "400", "520", "640"].map((x) => (
          <line key={x} x1={x} y1="90" x2={x} y2="240" stroke="#1b45ea" strokeWidth="3" />
        ))}
      </svg>
      <Container className="relative">
        <div className="max-w-3xl">
          {eyebrow && (
            <span className="inline-flex items-center gap-2 rounded-full border border-accent-200 bg-accent-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent-700">
              {eyebrow}
            </span>
          )}
          <h1 className="heading-xl mt-5">{title}</h1>
          {description && <p className="lead mt-5">{description}</p>}
        </div>
      </Container>
    </section>
  );
}
