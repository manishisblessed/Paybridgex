"use client";

import { SchemeGateOverlay } from "@/components/dashboard/SchemeGateOverlay";

export default function KnteerPayoutLayout({ children }: { children: React.ReactNode }) {
  return <SchemeGateOverlay>{children}</SchemeGateOverlay>;
}
