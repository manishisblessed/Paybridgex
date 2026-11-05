/**
 * /pay/return?ref=TOPUPXXXXXXXXXX
 *
 * Public (no auth) landing page that Chagans redirects back to after a
 * successful payment.  Works for both Comet (full-page redirect) and Star
 * (iframe embed).
 *
 * - When NOT framed (Comet):  ReturnRedirect auto-navigates to the wallet in
 *   2.5 s, while the user sees a confirmation screen.
 * - When framed (Star):       The iframe stays put; the user clicks the
 *   "Go to Wallet" button which carries target="_top" to escape the iframe.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import ReturnRedirect from "./ReturnRedirect";

export const metadata: Metadata = {
  title: "Payment Received — Paybridgex",
  robots: { index: false },
};

export default function PayReturnPage({
  searchParams,
}: {
  searchParams: { ref?: string };
}) {
  const ref = searchParams.ref ?? "";
  const walletHref = "/dashboard/wallet" + (ref ? `?topup=${ref}` : "");

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 bg-gradient-to-br from-brand-950 via-brand-900 to-brand-800 px-4">
      <ReturnRedirect to={walletHref} />

      {/* Logo */}
      <Logo variant="light" />

      {/* Status card */}
      <div className="w-full max-w-sm rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm p-8 flex flex-col items-center gap-5 text-center shadow-2xl">
        <div className="rounded-full bg-emerald-500/15 p-4">
          <CheckCircle className="w-10 h-10 text-emerald-400" strokeWidth={1.5} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-white">Payment received!</h1>
          <p className="mt-1.5 text-sm text-white/60">
            Your wallet will be credited shortly.
          </p>
        </div>
        <Link
          href={walletHref}
          target="_top"
          className="mt-2 inline-flex items-center justify-center w-full rounded-xl bg-brand-500 hover:bg-brand-400 text-white font-medium py-3 px-6 transition-colors"
        >
          Go to Wallet
        </Link>
      </div>

      <p className="text-xs text-white/30">Redirecting automatically…</p>
    </div>
  );
}
