"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Container, Section, SectionHeading } from "@/components/ui/Container";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { faqs } from "@/lib/data";
import { cn } from "@/lib/utils";

const easeOut = [0.22, 1, 0.36, 1] as const;

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <Section id="faq" className="bg-ink-50/50">
      <Container>
        <Reveal>
          <SectionHeading
            eyebrow="Frequently asked questions"
            title="Everything you need to know"
            description="Can't find your answer? Our support team replies in under 15 minutes on WhatsApp."
          />
        </Reveal>

        <Stagger
          stagger={0.06}
          className="mx-auto max-w-3xl divide-y divide-ink-100 overflow-hidden rounded-3xl border border-ink-100 bg-white shadow-sm"
        >
          {faqs.map((f, i) => {
            const isOpen = open === i;
            return (
              <StaggerItem key={f.q}>
                <div>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition hover:bg-ink-50"
                    onClick={() => setOpen(isOpen ? null : i)}
                    aria-expanded={isOpen}
                  >
                    <span className="font-display text-base font-semibold text-ink-900">
                      {f.q}
                    </span>
                    <motion.span
                      animate={{ rotate: isOpen ? 45 : 0 }}
                      transition={{ duration: 0.3, ease: easeOut }}
                      className={cn(
                        "grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors",
                        isOpen
                          ? "bg-brand-600 text-white"
                          : "bg-ink-100 text-ink-700"
                      )}
                    >
                      <Plus className="h-4 w-4" />
                    </motion.span>
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        key="content"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.35, ease: easeOut }}
                        className="overflow-hidden"
                      >
                        <p className="px-6 pb-5 text-sm leading-relaxed text-ink-600">
                          {f.a}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </StaggerItem>
            );
          })}
        </Stagger>
      </Container>
    </Section>
  );
}
