import type { Metadata } from "next";
import { Inter, Manrope } from "next/font/google";
import { AuthProvider } from "@/components/providers/AuthProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans"
});

const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display"
});

export const metadata: Metadata = {
  title: {
    default: "Paybridgex — Smart Payments. Trusted Solutions.",
    template: "%s · Paybridgex"
  },
  description:
    "Paybridgex (K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED, Ahmedabad) is a payments and digital-services platform offering payment gateway, POS machines, QR collections, AePS, money transfer, recharges and bill payments for retailers and merchants across India.",
  keywords: [
    "Paybridgex",
    "paybridgex.in",
    "payment gateway",
    "POS machine",
    "QR payments",
    "UPI",
    "AePS",
    "money transfer",
    "DMT",
    "recharge",
    "bill payment",
    "fintech India",
    "agent banking"
  ],
  metadataBase: new URL("https://paybridgex.in"),
  openGraph: {
    title: "Paybridgex — Smart Payments. Trusted Solutions.",
    description:
      "Payment gateway, POS machines, QR collections and 60+ digital services for retailers, distributors and merchants.",
    url: "https://paybridgex.in",
    siteName: "Paybridgex",
    type: "website"
  }
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${manrope.variable}`}>
      <body><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
