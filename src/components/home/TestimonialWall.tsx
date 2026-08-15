import { Star } from "lucide-react";
import { Container, Section, SectionHeading } from "@/components/ui/Container";
import { Stagger, StaggerItem } from "@/components/motion";
import { testimonials } from "@/lib/data";

export function TestimonialWall() {
  return (
    <Section className="bg-white">
      <Container>
        <SectionHeading
          eyebrow="From the counter"
          title="Partners who crossed over"
          description="Retailers and distributors across Gujarat and beyond run their daily business on Paybridgex."
        />

        <Stagger stagger={0.1} className="grid gap-5 md:grid-cols-2">
          {testimonials.map((t, i) => (
            <StaggerItem key={t.name}>
              <figure
                className={`relative h-full overflow-hidden rounded-3xl border p-8 transition hover:-translate-y-1 hover:shadow-soft ${
                  i % 2 === 0
                    ? "border-brand-100 bg-brand-50/50"
                    : "border-accent-100 bg-accent-50/50"
                }`}
              >
                <span
                  aria-hidden
                  className={`absolute -top-4 right-6 font-display text-[120px] font-extrabold leading-none ${
                    i % 2 === 0 ? "text-brand-100" : "text-accent-100"
                  }`}
                >
                  &rdquo;
                </span>
                <div className="flex gap-1">
                  {Array.from({ length: t.rating }).map((_, s) => (
                    <Star
                      key={s}
                      className="h-4 w-4 fill-amber-400 text-amber-400"
                    />
                  ))}
                </div>
                <blockquote className="relative mt-4 text-[15px] leading-relaxed text-ink-700">
                  {t.quote}
                </blockquote>
                <figcaption className="mt-6 flex items-center gap-3">
                  <span
                    className={`grid h-10 w-10 place-items-center rounded-full font-display text-sm font-bold text-white ${
                      i % 2 === 0 ? "bg-brand-600" : "bg-accent-600"
                    }`}
                  >
                    {t.name
                      .split(" ")
                      .map((w) => w[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-ink-900">{t.name}</p>
                    <p className="text-xs text-ink-500">{t.role}</p>
                  </div>
                </figcaption>
              </figure>
            </StaggerItem>
          ))}
        </Stagger>
      </Container>
    </Section>
  );
}
