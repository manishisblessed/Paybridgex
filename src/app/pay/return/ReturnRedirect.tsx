"use client";

import { useEffect } from "react";

/**
 * Auto-redirects to `to` after a short delay ONLY when the page is NOT in an
 * iframe (Chagans Comet — full-page redirect).
 *
 * When framed (Chagans Star renders inside an iframe) we intentionally do NOT
 * navigate — cross-origin iframe navigation is blocked by the browser and would
 * silently fail.  Instead the static "Go to Wallet" button on the parent page
 * uses target="_top" so the user can click out manually.
 */
export default function ReturnRedirect({ to }: { to: string }) {
  useEffect(() => {
    const inFrame = window.self !== window.top;
    if (inFrame) return;
    const t = setTimeout(() => {
      window.location.assign(to);
    }, 2500);
    return () => clearTimeout(t);
  }, [to]);

  return null;
}
