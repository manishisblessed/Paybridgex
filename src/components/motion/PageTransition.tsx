"use client";

import { usePathname } from "next/navigation";
import * as React from "react";

/**
 * Fades/slides the page content in on each navigation.
 *
 * This is a CSS animation (`.pbx-page-enter`), NOT a JS/framer-motion one, on
 * purpose. A JS motion library serializes the hidden `opacity:0` start state
 * into the server HTML and only reveals it once the page bundle has hydrated —
 * so on a heavy page or slow device the ENTIRE tab sits blank for several
 * seconds and then pops in at once. Because this wrapper is mounted around
 * every dashboard page, that made every tab blank on load.
 *
 * A CSS animation runs on the browser's first paint from the SSR HTML, before
 * any JS runs, so content is always visible/animating immediately. Keying the
 * element on `pathname` remounts it on navigation, which restarts the CSS
 * animation for each page — no exit-wait deadlock, no hydration dependency.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="pbx-page-enter min-w-0">
      {children}
    </div>
  );
}
