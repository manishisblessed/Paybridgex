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
    default: "NextGenPay — Payment Gateway, POS & QR Payments",
    template: "%s · NextGenPay"
  },
  description:
    "NextGenPay (JMP NEXTGENPAY PRIVATE LIMITED, Surat) is a fintech distribution platform offering payment gateway, POS machines, QR collections, AePS, money transfer, recharges and bill payments for retailers and merchants across India.",
  keywords: [
    "NextGenPay",
    "nxtgpay",
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
  metadataBase: new URL("https://nxtgpay.com"),
  openGraph: {
    title: "NextGenPay — Payment Gateway, POS & QR Payments",
    description:
      "Payment gateway, POS machines, QR collections and 60+ digital services for retailers, distributors and merchants.",
    url: "https://nxtgpay.com",
    siteName: "NextGenPay",
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
