"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X, ChevronDown } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/Button";
import { mainNav } from "@/lib/data";
import { cn } from "@/lib/utils";

const easeOut = [0.22, 1, 0.36, 1] as const;

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();
  const reduce = useReducedMotion();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // The landing hero is dark navy — render light-on-dark until scrolled.
  const onDark = pathname === "/" && !scrolled;

  return (
    <motion.header
      initial={false}
      animate={{
        backgroundColor: scrolled ? "rgba(255,255,255,0.78)" : "rgba(255,255,255,0)",
        borderBottomColor: scrolled ? "rgb(234 238 244)" : "rgba(234,238,244,0)",
        backdropFilter: scrolled ? "saturate(180%) blur(16px)" : "saturate(100%) blur(0px)",
        boxShadow: scrolled
          ? "0 8px 28px -22px rgba(15,23,42,0.25)"
          : "0 0 0 rgba(0,0,0,0)"
      }}
      transition={{ duration: reduce ? 0 : 0.35, ease: easeOut }}
      className="sticky top-0 z-50 w-full border-b"
      style={{
        WebkitBackdropFilter: scrolled ? "saturate(180%) blur(16px)" : undefined
      }}
    >
      <motion.div
        animate={{ height: scrolled ? 64 : 80 }}
        transition={{ duration: reduce ? 0 : 0.35, ease: easeOut }}
        className="container-x flex items-center justify-between gap-6"
      >
        <Logo
          variant={onDark ? "light" : "dark"}
          className="transition-transform hover:scale-[1.02]"
        />

        <nav className="hidden lg:flex">
          <ul className="flex items-center gap-1">
            {mainNav.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href));
              return (
                <li key={item.label} className="relative group">
                  <Link
                    href={item.href}
                    data-active={isActive}
                    className={cn(
                      "link-underline inline-flex items-center gap-1 rounded-full px-4 py-2 text-sm font-medium transition",
                      onDark
                        ? isActive
                          ? "text-white"
                          : "text-white/75 hover:bg-white/10 hover:text-white"
                        : isActive
                          ? "text-ink-900"
                          : "text-ink-700 hover:bg-ink-100/70 hover:text-ink-900"
                    )}
                  >
                    {item.label}
                    {item.children && (
                      <ChevronDown className="h-3.5 w-3.5 opacity-60 transition-transform duration-300 group-hover:rotate-180" />
                    )}
                  </Link>
                  {item.children && (
                    <div className="invisible absolute left-1/2 top-full z-40 w-64 -translate-x-1/2 pt-2 opacity-0 transition-all duration-300 ease-out group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                      <div className="origin-top rounded-2xl border border-ink-100 bg-white/95 p-2 shadow-soft backdrop-blur-md">
                        {item.children.map((child, i) => (
                          <Link
                            key={child.label}
                            href={child.href}
                            style={{ transitionDelay: `${i * 30}ms` }}
                            className="block translate-x-0 rounded-xl px-3 py-2 text-sm text-ink-700 transition-all duration-200 hover:translate-x-0.5 hover:bg-brand-50 hover:text-brand-700"
                          >
                            {child.label}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Link href="/login">
            <Button
              variant="ghost"
              size="sm"
              className={onDark ? "!text-white/85 hover:!bg-white/10 hover:!text-white" : undefined}
            >
              Login
            </Button>
          </Link>
          <Link href="/register">
            <Button size="sm" variant={onDark ? "accent" : "primary"} className={onDark ? "!text-white" : undefined}>
              Get started free
            </Button>
          </Link>
        </div>

        <button
          type="button"
          aria-label="Toggle menu"
          aria-expanded={open}
          className={cn(
            "lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-xl border transition active:scale-95",
            onDark
              ? "border-white/25 bg-white/10 text-white hover:border-accent-300/60"
              : "border-ink-200 bg-white text-ink-900 hover:border-brand-300 hover:text-brand-700"
          )}
          onClick={() => setOpen((o) => !o)}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={open ? "x" : "menu"}
              initial={{ rotate: -45, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 45, opacity: 0 }}
              transition={{ duration: 0.18, ease: easeOut }}
              className="grid place-items-center"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </motion.span>
          </AnimatePresence>
        </button>
      </motion.div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="mobile-menu"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: easeOut }}
            className="overflow-hidden border-t border-ink-100 bg-white lg:hidden"
          >
            <motion.div
              initial="hidden"
              animate="show"
              variants={{
                hidden: {},
                show: { transition: { staggerChildren: 0.04 } }
              }}
              className="container-x flex flex-col gap-1 py-4"
            >
              {mainNav.map((item) => (
                <motion.div
                  key={item.label}
                  variants={{
                    hidden: { opacity: 0, x: -8 },
                    show: { opacity: 1, x: 0 }
                  }}
                >
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="block rounded-xl px-3 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-100"
                  >
                    {item.label}
                  </Link>
                </motion.div>
              ))}
              <motion.div
                variants={{
                  hidden: { opacity: 0, y: 8 },
                  show: { opacity: 1, y: 0 }
                }}
                className="mt-2 flex gap-2"
              >
                <Link href="/login" className="flex-1" onClick={() => setOpen(false)}>
                  <Button variant="outline" className="w-full">
                    Login
                  </Button>
                </Link>
                <Link
                  href="/register"
                  className="flex-1"
                  onClick={() => setOpen(false)}
                >
                  <Button className="w-full">Join now</Button>
                </Link>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
