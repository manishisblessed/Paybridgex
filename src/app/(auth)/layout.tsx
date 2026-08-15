import Link from "next/link";
import { Logo } from "@/components/layout/Logo";

export default function AuthLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-brand-50 via-white to-accent-50">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -left-32 top-1/4 h-96 w-96 rounded-full bg-brand-200/40 blur-3xl" />
        <div className="absolute -right-32 bottom-1/4 h-96 w-96 rounded-full bg-accent-200/40 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.35] [background-image:linear-gradient(to_right,rgba(30,64,175,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(30,64,175,0.06)_1px,transparent_1px)] [background-size:48px_48px]" />
      </div>
      <div className="container-x relative flex h-16 items-center justify-between md:h-20">
        <Logo withTagline />
        <Link
          href="/"
          className="text-sm font-medium text-ink-600 hover:text-ink-900"
        >
          ← Back to home
        </Link>
      </div>
      <main className="container-x relative flex min-h-[calc(100vh-5rem)] items-center justify-center py-10">
        {children}
      </main>
    </div>
  );
}
