"use client";

import { Suspense, useState, useEffect, useRef } from "react";
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
import { StepUpProvider } from "@/components/security/StepUpProvider";
import { AdminActivityTracker } from "@/components/security/AdminActivityTracker";

export default function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const { data: session, status, update } = useSession({ required: true });
  const [open, setOpen] = useState(false);
  // Whether we've re-validated a "2FA appears off" session against the server.
  const [twoFAChecked, setTwoFAChecked] = useState(false);
  const revalidatingRef = useRef(false);

  const twoFactorEnabled = session?.user?.twoFactorEnabled === true;
  // A master-admin may exempt an account from the mandatory-2FA gate and let it
  // log in with a transaction PIN instead. Such users must never see the setup modal.
  const twoFactorExempt = session?.user?.twoFactorExempt === true;

  // A stale JWT (e.g. minted before the user enabled 2FA, or a session cookie
  // that hasn't picked up the current DB value yet) can report
  // twoFactorEnabled=false even though 2FA is actually active. Before forcing
  // the *mandatory* setup modal, refresh the session from the server once so we
  // never nag a user who has already completed 2FA. Only after this re-check
  // still reports it off do we treat setup as required.
  useEffect(() => {
    if (status !== "authenticated") return;
    if (twoFactorEnabled || twoFactorExempt) {
      setTwoFAChecked(true);
      return;
    }
    if (!twoFAChecked && !revalidatingRef.current) {
      revalidatingRef.current = true;
      Promise.resolve(update()).finally(() => {
        revalidatingRef.current = false;
        setTwoFAChecked(true);
      });
    }
  }, [status, twoFactorEnabled, twoFAChecked, update]);

  const needs2FASetup =
    status === "authenticated" && twoFAChecked && !twoFactorEnabled && !twoFactorExempt;

  if (status === "loading") {
    return <DashboardShellSkeleton />;
  }

  return (
    <StepUpProvider>
    <AdminActivityTracker />
    <div className="flex min-h-screen bg-gradient-to-br from-ink-50/70 via-white to-brand-50/30">
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
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenSidebar={() => setOpen(true)} />
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-10">
          <div className="mx-auto w-full max-w-[1400px] min-w-0">
            <SliderSurface />
            <SchemeGateBanner />
            <PageTransition>{children}</PageTransition>
          </div>
        </main>
      </div>

      {needs2FASetup && <TwoFactorSetupModal />}
      {twoFactorEnabled && <ReKycGate />}
    </div>
    </StepUpProvider>
  );
}
