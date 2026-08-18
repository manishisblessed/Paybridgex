"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Layers } from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Panel } from "@/components/dashboard/ui";
import { Reveal } from "@/components/motion";

/**
 * Network Schemes page has been deprecated. Schemes are now assigned by admin only.
 * Redirects to the dashboard after a brief message.
 */
export default function NetworkSchemesDeprecated() {
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => router.replace("/dashboard"), 3000);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          eyebrow="Notice"
          title="Scheme Management Moved"
          description="Schemes are now managed and assigned by admin only. You will be redirected to your dashboard."
        />
      </Reveal>
      <Reveal distance={16} duration={0.45}>
        <Panel className="mx-auto max-w-xl p-8 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 text-white shadow-soft">
            <Layers className="h-5 w-5" />
          </span>
          <p className="mt-4 text-sm text-ink-600">
            The network scheme workspace has been removed. Your scheme is assigned directly by admin.
            Contact your admin if you need scheme changes.
          </p>
        </Panel>
      </Reveal>
    </div>
  );
}
