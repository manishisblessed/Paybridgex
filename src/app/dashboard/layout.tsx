"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Toaster } from "sonner";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Topbar } from "@/components/dashboard/Topbar";
import { TwoFactorSetupModal } from "@/components/dashboard/TwoFactorSetupModal";
import { ReKycGate } from "@/components/dashboard/ReKycGate";
import { SliderSurface } from "@/components/dashboard/sliders/SliderSurface";
import { SchemeGateBanner } from "@/components/dashboard/SchemeGateBanner";
import { NavigationProgress } from "@/components/dashboard/NavigationProgress";
import { PageTransition } from "@/components/motion/PageTransition";
import { DashboardShellSkeleton } from "@/components/ui/Skeleton";

const SIDEBAR_KEY = "ngp-sidebar-collapsed";

export default function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const { data: session, status } = useSession({ required: true });
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_KEY);
    if (stored === "true") setCollapsed(true);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_KEY, String(next));
      return next;
    });
  }, []);

  const needs2FASetup = status === "authenticated" && !session?.user?.twoFactorEnabled;

  if (status === "loading") {
    return <DashboardShellSkeleton />;
  }

  return (
    <div className="flex min-h-screen bg-ink-50/40">
      <Toaster
        position="top-right"
        richColors
        closeButton
        toastOptions={{
          className: "font-sans",
          duration: 4500,
        }}
      />
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      <Sidebar open={open} onClose={() => setOpen(false)} collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenSidebar={() => setOpen(true)} collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-10">
          <div className="mx-auto w-full max-w-[1400px] min-w-0">
            <SliderSurface />
            <SchemeGateBanner />
            <PageTransition>{children}</PageTransition>
          </div>
        </main>
      </div>

      {needs2FASetup && <TwoFactorSetupModal />}
      {!needs2FASetup && <ReKycGate />}
    </div>
  );
}
