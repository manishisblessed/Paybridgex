import {
  Banknote,
  Smartphone,
  Wifi,
  Tv,
  Lightbulb,
  Droplets,
  Flame,
  CreditCard,
  Bus,
  Hotel,
  Plane,
  Wallet,
  QrCode,
  Building2,
  Receipt,
  GraduationCap,
  Send,
  Fingerprint,
  ShieldCheck,
  Monitor,
  type LucideIcon
} from "lucide-react";

export const company = {
  legalName: "JMP NEXTGENPAY PRIVATE LIMITED",
  brand: "NextGenPay",
  tradeName: "jmpnextgenpay",
  domain: "nxtgpay.com",
  email: "Info@nxtgpay.com",
  supportEmail: "support@nxtgpay.com",
  legalEmail: "legal@nxtgpay.com",
  grievanceEmail: "grievance@nxtgpay.com",
  nodalEmail: "nodal@nxtgpay.com",
  phone: "8780224955",
  cin: "U66190GJ2025PTC170905",
  gstin: "24AAHCJ1843N1ZC",
  incorporated: "2025",
  jurisdiction: "Surat, Gujarat",
  address:
    "2nd Floor, 201, Devi Arcade, Ashwini Kumar Road, Modi Maholla, Surat, Gujarat - 395008",
  shortAddress: "Devi Arcade, Ashwini Kumar Road, Surat"
};

// Mandatory under IT Rules 2021 (Intermediary Guidelines) & RBI Master Direction
// on Customer Service in Banks, 2024.
export const grievanceOfficer = {
  name: "Mr. Rakesh Patel",
  designation: "Grievance Redressal Officer",
  email: "grievance@nxtgpay.com",
  phone: "+91 8780224955",
  hours: "Monday to Saturday, 10:00 AM – 6:00 PM IST",
  address:
    "2nd Floor, 201, Devi Arcade, Ashwini Kumar Road, Modi Maholla, Surat, Gujarat – 395008",
  responseSla: "Acknowledgement within 24 hours · Resolution within 15 working days"
};

export const nodalOfficer = {
  name: "Ms. Priya Sharma",
  designation: "Principal Nodal Officer",
  email: "nodal@nxtgpay.com",
  phone: "+91 8780224955"
};

export type ServiceItem = {
  slug: string;
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
  category: "banking" | "recharge" | "bills" | "travel" | "other";
  badge?: string;
};

export const services: ServiceItem[] = [
  {
    slug: "payment-gateway",
    title: "Payment Gateway",
    description:
      "Accept UPI, cards, net banking & wallets with real-time tracking and T+1 settlement.",
    icon: CreditCard,
    href: "/dashboard/pg",
    category: "banking",
    badge: "New"
  },
  {
    slug: "pos",
    title: "POS Terminals",
    description:
      "Android POS machines on rental with card, UPI, BharatQR & Tap-and-Pay acceptance.",
    icon: Monitor,
    href: "/dashboard/pos",
    category: "banking",
    badge: "New"
  },
  {
    slug: "qr-payments",
    title: "QR Code Payments",
    description:
      "Branded static & dynamic UPI QR codes with instant alerts and settlement reports.",
    icon: QrCode,
    href: "/dashboard/qr",
    category: "banking",
    badge: "New"
  },
  {
    slug: "aadhaar-pay",
    title: "Aadhaar Pay (AePS)",
    description:
      "Cash withdrawal, balance inquiry & mini statement using Aadhaar biometric.",
    icon: Fingerprint,
    href: "/dashboard/aadhaar-pay",
    category: "banking"
  },
  {
    slug: "money-transfer",
    title: "Money Transfer (DMT)",
    description: "Send money instantly to any Indian bank account 24x7.",
    icon: Send,
    href: "/dashboard/money-transfer",
    category: "banking"
  },
  {
    slug: "upi",
    title: "UPI Collect",
    description: "Generate UPI requests and accept payments without a POS.",
    icon: QrCode,
    href: "/dashboard/upi",
    category: "banking"
  },
  {
    slug: "wallet",
    title: "Wallet Pay",
    description: "Top-up your NextGenPay wallet and pay anywhere instantly.",
    icon: Wallet,
    href: "/dashboard/wallet",
    category: "banking"
  },
  {
    slug: "virtual-account",
    title: "Virtual Account",
    description: "Get a unique IFSC + account number to receive payments.",
    icon: Building2,
    href: "/dashboard/virtual-account",
    category: "banking",
    badge: "New"
  },
  {
    slug: "credit-card",
    title: "Credit Card Bill",
    description: "Pay any credit card bill across all major banks.",
    icon: CreditCard,
    href: "/dashboard/bill-pay/credit-card",
    category: "bills"
  },
  {
    slug: "mobile-recharge",
    title: "Mobile Recharge",
    description: "Prepaid recharge for Jio, Airtel, Vi, BSNL with cashback.",
    icon: Smartphone,
    href: "/dashboard/recharge/mobile",
    category: "recharge"
  },
  {
    slug: "dth",
    title: "DTH Recharge",
    description: "Recharge Tata Play, Dish TV, d2h, Sun Direct & Airtel DTH.",
    icon: Tv,
    href: "/dashboard/recharge/dth",
    category: "recharge"
  },
  {
    slug: "broadband",
    title: "Broadband / OTT",
    description: "Postpaid broadband, landline & OTT subscriptions.",
    icon: Wifi,
    href: "/dashboard/recharge/broadband",
    category: "recharge"
  },
  {
    slug: "electricity",
    title: "Electricity",
    description: "Pay state & private electricity bills across India.",
    icon: Lightbulb,
    href: "/dashboard/bill-pay/electricity",
    category: "bills"
  },
  {
    slug: "water",
    title: "Water",
    description: "Pay municipal water bills with instant confirmation.",
    icon: Droplets,
    href: "/dashboard/bill-pay/water",
    category: "bills"
  },
  {
    slug: "gas",
    title: "Gas (Piped & LPG)",
    description: "Book LPG cylinders or pay piped gas bills in seconds.",
    icon: Flame,
    href: "/dashboard/bill-pay/gas",
    category: "bills"
  },
  {
    slug: "flight",
    title: "Flight Booking",
    description: "Search and book domestic flights with best fares.",
    icon: Plane,
    href: "/dashboard/travel/flight",
    category: "travel"
  },
  {
    slug: "hotel",
    title: "Hotel Booking",
    description: "Browse 50,000+ hotels across India at agent rates.",
    icon: Hotel,
    href: "/dashboard/travel/hotel",
    category: "travel"
  },
  {
    slug: "bus",
    title: "Bus Booking",
    description: "Book AC sleeper, semi-sleeper & seater buses pan-India.",
    icon: Bus,
    href: "/dashboard/travel/bus",
    category: "travel"
  },
  {
    slug: "education",
    title: "Education Fees",
    description: "Pay school & college fees with auto reminders.",
    icon: GraduationCap,
    href: "/dashboard/bill-pay/education",
    category: "bills"
  },
  {
    slug: "insurance",
    title: "Insurance Premium",
    description: "Pay life insurance premiums across major insurers instantly.",
    icon: ShieldCheck,
    href: "/dashboard/bill-pay/insurance",
    category: "bills"
  },
  {
    slug: "broadband-bill",
    title: "Broadband Bill",
    description: "Pay postpaid broadband & landline bills via BBPS.",
    icon: Wifi,
    href: "/dashboard/bill-pay/broadband",
    category: "bills"
  }
];

export type FaqItem = { q: string; a: string };

export const faqs: FaqItem[] = [
  {
    q: "What is NextGenPay?",
    a: "NextGenPay (operated by JMP NEXTGENPAY PRIVATE LIMITED) is a digital banking & utility fintech platform that helps retailers and consumers access 60+ services — money transfer, AePS, recharges, bill payments, travel bookings — all from a single dashboard, with zero hidden fees."
  },
  {
    q: "Is it safe to use the platform?",
    a: "Yes. We use bank-grade 256-bit TLS encryption, RBI-licensed payment partners, and 2-factor authentication on every login & high-value transaction. Your data is never sold or shared."
  },
  {
    q: "Which utility services can I pay for?",
    a: "Electricity, water, piped gas & LPG, broadband, DTH, postpaid mobile, landline, credit-card bills, education fees, insurance premiums, FASTag, municipal taxes and more — across 1,200+ billers."
  },
  {
    q: "How do I become a NextGenPay agent?",
    a: "Sign up with your PAN, Aadhaar and shop details, complete KYC in under 5 minutes, and start earning commissions on every transaction. There is no joining fee."
  },
  {
    q: "How are commissions paid?",
    a: "Commissions are credited to your NextGenPay wallet in real-time on every successful transaction. You can withdraw to your bank account 24x7 with instant IMPS settlement."
  },
  {
    q: "Do you charge any hidden fees?",
    a: "No. Our pricing is fully transparent — every service shows the exact convenience fee (if any) before you confirm. There are zero hidden charges, ever."
  }
];

export type Testimonial = {
  name: string;
  role: string;
  quote: string;
  rating: number;
};

export const testimonials: Testimonial[] = [
  {
    name: "Kasendar Prasad",
    role: "Owner, Rishabh Telecom & Money Transfer",
    quote:
      "Working with NextGenPay has transformed my business. The platform is fast, the commissions are great, and the support team is always there when I need them.",
    rating: 5
  },
  {
    name: "Mukesh Kumar",
    role: "Founder, Satkartar Telecom",
    quote:
      "Every service works flawlessly — AePS settlement is instant and the dashboard is the cleanest I've used. Highly recommended for any retail outlet.",
    rating: 5
  },
  {
    name: "Priya Sharma",
    role: "Owner, Sharma Mobile World",
    quote:
      "I doubled my monthly income within 3 months of joining NextGenPay. The training and onboarding is top-notch.",
    rating: 5
  },
  {
    name: "Rohit Verma",
    role: "Distributor, Verma Enterprises",
    quote:
      "The wallet top-up is instant and the commission structure is the best in the industry. A genuine partner for retailers.",
    rating: 5
  }
];

export type Stat = { value: string; label: string };

export const heroStats: Stat[] = [
  { value: "38M+", label: "Businesses joined" },
  { value: "1,200+", label: "Live billers" },
  { value: "60+", label: "Digital services" },
  { value: "99.9%", label: "Uptime SLA" }
];

export type PricingPlan = {
  name: string;
  price: string;
  cadence: string;
  description: string;
  features: string[];
  highlighted?: boolean;
  cta: string;
};

export const pricingPlans: PricingPlan[] = [
  {
    name: "Starter",
    price: "₹0",
    cadence: "forever free",
    description: "Perfect for individuals starting their fintech journey.",
    features: [
      "Access to 30+ services",
      "Standard commission rates",
      "UPI & wallet payments",
      "Email support",
      "Basic transaction reports"
    ],
    cta: "Get started"
  },
  {
    name: "Retailer",
    price: "₹499",
    cadence: "/year",
    description: "Best for shops & local retail outlets.",
    features: [
      "All Starter features",
      "AePS & money transfer enabled",
      "Higher commission slabs",
      "Priority WhatsApp support",
      "Advanced reports & exports",
      "Free RuPay card"
    ],
    highlighted: true,
    cta: "Become a retailer"
  },
  {
    name: "Distributor",
    price: "₹2,499",
    cadence: "/year",
    description: "For distributors managing multiple retailers.",
    features: [
      "All Retailer features",
      "Multi-retailer management",
      "Commission overrides",
      "Dedicated account manager",
      "API access",
      "Co-branded white-label"
    ],
    cta: "Talk to sales"
  }
];

export type BlogPost = {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  readTime: string;
  category: string;
};

export const blogPosts: BlogPost[] = [
  {
    slug: "how-aeps-is-changing-rural-banking",
    title: "How AePS is changing rural banking in Bharat",
    excerpt:
      "Aadhaar-enabled Payment System has brought formal banking to villages where ATMs never reached. Here's how retailers can ride the wave.",
    date: "Apr 02, 2026",
    readTime: "5 min read",
    category: "Banking"
  },
  {
    slug: "ten-tips-to-grow-your-csp",
    title: "10 tips to grow your customer service point in 2026",
    excerpt:
      "Practical, retailer-tested strategies to bring more footfall and increase per-customer revenue at your CSP.",
    date: "Mar 18, 2026",
    readTime: "7 min read",
    category: "Growth"
  },
  {
    slug: "upi-vs-cards-which-wins",
    title: "UPI vs cards — which wins in 2026?",
    excerpt:
      "We crunch the numbers across 12M transactions to see how UPI and cards stack up on cost, speed and customer love.",
    date: "Feb 28, 2026",
    readTime: "6 min read",
    category: "Insights"
  }
];

export type NavLink = {
  label: string;
  href: string;
  children?: NavLink[];
};

export const mainNav: NavLink[] = [
  { label: "Home", href: "/" },
  { label: "About", href: "/about" },
  {
    label: "Services",
    href: "/services",
    children: [
      { label: "Aadhaar Pay (AePS)", href: "/services#aadhaar-pay" },
      { label: "Money Transfer", href: "/services#money-transfer" },
      { label: "UPI & Wallet", href: "/services#upi" },
      { label: "Recharges & Bills", href: "/services#bills" },
      { label: "Travel Bookings", href: "/services#travel" }
    ]
  },
  { label: "Products", href: "/products" },
  { label: "Career", href: "/career" },
  { label: "Team", href: "/team" },
  { label: "Contact", href: "/contact" }
];

export const footerLinks = {
  legal: [
    { label: "Privacy Policy", href: "/legal/privacy" },
    { label: "Terms & Conditions", href: "/legal/terms" },
    { label: "Refunds & Cancellation", href: "/legal/refunds" },
    { label: "Charges & Fees", href: "/legal/charges" },
    { label: "Grievance Redressal", href: "/legal/grievance" }
  ],
  services: [
    { label: "AePS", href: "/services#aadhaar-pay" },
    { label: "Money Transfer", href: "/services#money-transfer" },
    { label: "Bill Payments (BBPS)", href: "/services#bills" },
    { label: "Recharges", href: "/services#bills" },
    { label: "Travel Bookings", href: "/services#travel" }
  ],
  company: [
    { label: "About Us", href: "/about" },
    { label: "Products", href: "/products" },
    { label: "Career", href: "/career" },
    { label: "Team", href: "/team" },
    { label: "Contact", href: "/contact" }
  ],
  resources: [
    { label: "Pricing", href: "/#pricing" },
    { label: "Become an Agent", href: "/register" },
    { label: "Developer APIs", href: "/dashboard/api" },
    { label: "Blog & Insights", href: "/#blog" },
    { label: "Press & Media", href: "/contact" }
  ]
};

// Compact certification chips shown in the footer compliance strip.
export const footerCertifications = [
  "RBI Authorised",
  "NPCI Certified",
  "UIDAI Sub-AUA",
  "PCI-DSS v4.0",
  "ISO 27001:2022",
  "DPDP Act 2023",
  "CERT-In Audited",
  "Made in India"
];

export const trustBadges = [
  { label: "RBI Licensed Partners", icon: ShieldCheck },
  { label: "256-bit Encryption", icon: ShieldCheck },
  { label: "PCI-DSS Compliant", icon: ShieldCheck },
  { label: "ISO 27001 Certified", icon: ShieldCheck }
];

// India-first missions powering Digital Bharat.
export type IndiaMission = {
  code: string;
  title: string;
  body: string;
  stat: string;
  statLabel: string;
};

export const indiaMissions: IndiaMission[] = [
  {
    code: "01",
    title: "Digital India",
    body:
      "Aligned with the Government of India's Digital India initiative — bridging Bharat's last-mile, one panchayat at a time.",
    stat: "1,250+",
    statLabel: "Gram Panchayats served"
  },
  {
    code: "02",
    title: "Jan Dhan – Aadhaar – Mobile (JAM)",
    body:
      "Built natively on the JAM trinity. Every retailer can onboard a customer using just an Aadhaar and a fingerprint.",
    stat: "₹0",
    statLabel: "Cost to open a Jan-Dhan account"
  },
  {
    code: "03",
    title: "UPI · BBPS · AePS",
    body:
      "Direct certified integrations with NPCI rails — UPI 2.0, Bharat BillPay v2, Aadhaar Enabled Payment System & FASTag.",
    stat: "60+",
    statLabel: "Live NPCI services"
  },
  {
    code: "04",
    title: "Aatmanirbhar Bharat",
    body:
      "100% Made-in-India fintech stack. Data resident on Indian soil, engineered in Surat, processed in India only.",
    stat: "🇮🇳",
    statLabel: "Proudly Made in India"
  }
];

// Regulatory & security certifications proudly displayed on the home page.
export type Certification = {
  code: string;
  name: string;
  authority: string;
  status: string;
  description: string;
};

export const certifications: Certification[] = [
  {
    code: "RBI",
    name: "RBI Authorised Partners",
    authority: "Reserve Bank of India",
    status: "Live",
    description:
      "All money-movement is settled through RBI-licensed sponsor banks holding a valid PA / PPI / BBPOU licence."
  },
  {
    code: "NPCI",
    name: "NPCI Certified",
    authority: "National Payments Corporation of India",
    status: "Certified",
    description:
      "Direct certified member rails for UPI 2.0, AePS, IMPS, NACH, RuPay, BBPS, NETC FASTag and APBS."
  },
  {
    code: "UIDAI",
    name: "UIDAI · AUA / KUA",
    authority: "Unique Identification Authority of India",
    status: "Sub-AUA",
    description:
      "Aadhaar authentication performed under a licensed AUA/KUA with mandatory STQC-certified biometric devices."
  },
  {
    code: "DPDP",
    name: "DPDP Act 2023 Ready",
    authority: "Ministry of Electronics & IT",
    status: "Compliant",
    description:
      "Data minimisation, purpose-limited consent, principal rights & breach notification — all baked in."
  },
  {
    code: "PCI",
    name: "PCI-DSS v4.0 Level 1",
    authority: "PCI Security Standards Council",
    status: "Certified",
    description:
      "Card data tokenised at issuer per RBI CoFT guidelines. Quarterly ASV scans & annual on-site audit."
  },
  {
    code: "ISO",
    name: "ISO/IEC 27001:2022",
    authority: "International Standards Organisation",
    status: "Certified",
    description:
      "Information Security Management System audited and certified by an accredited Indian certification body."
  },
  {
    code: "CERT",
    name: "CERT-In Empanelled",
    authority: "Indian Computer Emergency Response Team",
    status: "Audited",
    description:
      "Annual VAPT by a CERT-In empanelled auditor. 6-hour incident reporting protocol as per CERT-In 2022 directions."
  },
  {
    code: "PMLA",
    name: "PMLA / KYC / AML",
    authority: "Financial Intelligence Unit – India",
    status: "Reporting",
    description:
      "Full KYC, transaction-monitoring, sanctions screening and STR/CTR reporting per PMLA Rules 2005."
  }
];

// Pan-India coverage data — fuels Coverage.tsx
export type CoverageRegion = {
  zone: string;
  states: number;
  retailers: string;
  topCities: string[];
};

export const coverageZones: CoverageRegion[] = [
  {
    zone: "North",
    states: 7,
    retailers: "9.4 L",
    topCities: ["Delhi", "Lucknow", "Jaipur", "Chandigarh", "Dehradun"]
  },
  {
    zone: "West",
    states: 6,
    retailers: "11.2 L",
    topCities: ["Mumbai", "Pune", "Ahmedabad", "Surat", "Indore"]
  },
  {
    zone: "South",
    states: 5,
    retailers: "8.6 L",
    topCities: ["Bengaluru", "Chennai", "Hyderabad", "Kochi", "Coimbatore"]
  },
  {
    zone: "East",
    states: 6,
    retailers: "5.1 L",
    topCities: ["Kolkata", "Patna", "Ranchi", "Bhubaneswar", "Guwahati"]
  },
  {
    zone: "North-East",
    states: 4,
    retailers: "0.9 L",
    topCities: ["Guwahati", "Shillong", "Aizawl", "Imphal", "Itanagar"]
  }
];

export const languagesSupported = [
  "English",
  "हिन्दी",
  "ગુજરાતી",
  "मराठी",
  "தமிழ்",
  "తెలుగు",
  "ಕನ್ನಡ",
  "বাংলা",
  "മലയാളം"
];

// Real, India-compliant legal page content rendered by /legal/[slug].
export type LegalSection = {
  id: string;
  heading: string;
  body: Array<string | { list: string[] } | { table: { headers: string[]; rows: string[][] } }>;
};

export type LegalDocument = {
  slug: string;
  title: string;
  eyebrow: string;
  description: string;
  lastUpdated: string;
  governedBy: string[];
  sections: LegalSection[];
};

export const legalDocuments: Record<string, LegalDocument> = {
  privacy: {
    slug: "privacy",
    title: "Privacy Policy",
    eyebrow: "Legal · Privacy",
    description:
      "How JMP NEXTGENPAY PRIVATE LIMITED collects, uses, stores and protects your personal data — drafted as per the Digital Personal Data Protection Act, 2023, the Information Technology Act, 2000 and the SPDI Rules, 2011.",
    lastUpdated: "01 April 2026",
    governedBy: [
      "Digital Personal Data Protection Act, 2023",
      "Information Technology Act, 2000",
      "SPDI Rules, 2011",
      "RBI Master Direction on Digital Payment Security Controls, 2021"
    ],
    sections: [
      {
        id: "introduction",
        heading: "1. Introduction",
        body: [
          "This Privacy Policy (\"Policy\") governs the processing of personal data by JMP NEXTGENPAY PRIVATE LIMITED (CIN: U66190GJ2025PTC170905), a company incorporated under the Companies Act, 2013 and having its registered office at 2nd Floor, 201, Devi Arcade, Ashwini Kumar Road, Modi Maholla, Surat, Gujarat – 395008 (\"NextGenPay\", \"Company\", \"We\", \"Us\"), through its website www.nxtgpay.com, mobile applications and APIs (collectively, the \"Platform\").",
          "By accessing or using the Platform, you (the \"Data Principal\") consent to the practices described in this Policy. If you do not agree, please do not use the Platform."
        ]
      },
      {
        id: "data-we-collect",
        heading: "2. Categories of Personal Data we collect",
        body: [
          "We collect only such personal data as is reasonably necessary to deliver the financial services that you, or the merchant you are transacting with, have requested.",
          {
            list: [
              "Identity data — full name, date of birth, gender, photograph, signature.",
              "Government IDs — Aadhaar number (only for OTP/biometric e-KYC under UIDAI regulations), PAN, Voter ID, Driving Licence, Passport.",
              "Contact data — postal address, mobile number, email address.",
              "Financial data — bank account number, IFSC, UPI VPA, card BIN, transaction history, wallet balances.",
              "Biometric data — fingerprint / iris template captured solely on STQC-certified devices for AePS authentication. Templates are never stored on our servers.",
              "Device & log data — IP address, device ID, OS version, app version, browser, geo-location at the time of transaction, error logs.",
              "KYC documents — proof of address, proof of business, GST certificate, shop & establishment licence (for agents)."
            ]
          }
        ]
      },
      {
        id: "purpose",
        heading: "3. Purpose & lawful basis of processing",
        body: [
          "Your data is processed only for the specific, lawful purposes notified to you at the time of collection, in accordance with Section 7 of the DPDP Act, 2023:",
          {
            list: [
              "Customer onboarding, KYC and re-KYC as required by RBI Master Direction on KYC, 2016 and PMLA, 2002.",
              "Processing payment, AePS, DMT, BBPS, recharge, travel & PAN service requests initiated by you.",
              "Detection and prevention of fraud, money-laundering and terror-financing.",
              "Compliance with statutory and regulatory obligations including responding to lawful requests from RBI, NPCI, UIDAI, FIU-IND, Income-Tax Department, GSTN and law-enforcement agencies.",
              "Customer support, grievance redressal and dispute resolution.",
              "Improving the Platform, security testing and product analytics (only on de-identified data)."
            ]
          },
          "We do not use your personal data for any purpose other than those listed above without your fresh, free, specific, informed and unambiguous consent."
        ]
      },
      {
        id: "sharing",
        heading: "4. Sharing & disclosure",
        body: [
          "We do not sell your personal data. We share it only with the parties listed below and strictly to the extent necessary:",
          {
            list: [
              "Sponsor banks, payment system providers, card networks (Visa, Mastercard, RuPay), NPCI, BBPCU, UIDAI and acquirer banks to execute your transactions.",
              "Statutory authorities — RBI, FIU-IND, Income-Tax Department, GSTN, courts, tribunals and law-enforcement agencies when legally compelled.",
              "Audit, KYC and risk-assessment vendors empanelled by RBI / SEBI / IRDAI, under written confidentiality and DPDP-aligned data processing agreements.",
              "Cloud infrastructure providers operating data centres located within the territory of India."
            ]
          }
        ]
      },
      {
        id: "storage",
        heading: "5. Data localisation, retention & deletion",
        body: [
          "All payment system data is stored only in India in compliance with the RBI circular dated 06 April 2018 on Storage of Payment System Data. End-of-day backups are encrypted at rest using AES-256.",
          "We retain personal data for the period mandated by applicable law — typically ten (10) years from the date of completion of the transaction (per Section 12, PMLA, 2002) — after which it is securely deleted or anonymised."
        ]
      },
      {
        id: "rights",
        heading: "6. Your rights as a Data Principal",
        body: [
          "Under the DPDP Act, 2023 you have the right to:",
          {
            list: [
              "Access a summary of the personal data we process about you.",
              "Correct, complete or update inaccurate or misleading data.",
              "Erase personal data that is no longer required for the original purpose.",
              "Withdraw your consent at any time (without affecting the lawfulness of prior processing).",
              "Nominate another individual to exercise your rights in the event of your death or incapacity.",
              "Lodge a complaint with the Data Protection Board of India."
            ]
          },
          "To exercise any of the above rights, please write to our Grievance Officer at grievance@nxtgpay.com. We will respond within fifteen (15) working days."
        ]
      },
      {
        id: "security",
        heading: "7. Security safeguards",
        body: [
          "We implement reasonable security practices as defined in Rule 8 of the SPDI Rules, 2011 and the RBI Master Direction on Digital Payment Security Controls, 2021, including: ISO/IEC 27001:2022 certified ISMS, PCI-DSS v4.0 Level-1 controls, mTLS-only APIs, HSM-backed key management, role-based access, 24×7 SOC monitoring and annual VAPT by a CERT-In empanelled auditor."
        ]
      },
      {
        id: "breach",
        heading: "8. Data-breach notification",
        body: [
          "Any personal-data breach will be reported to the Data Protection Board of India and to affected Data Principals within seventy-two (72) hours of detection, as required by the DPDP Act, 2023, together with the nature, scope and mitigation measures taken. Cyber-security incidents are reported to CERT-In within six (6) hours as per the directions dated 28 April 2022."
        ]
      },
      {
        id: "children",
        heading: "9. Children's data",
        body: [
          "The Platform is not intended for use by individuals below 18 years of age. We will not knowingly process personal data of a child without the verifiable consent of a parent or lawful guardian."
        ]
      },
      {
        id: "changes",
        heading: "10. Changes to this Policy",
        body: [
          "We may amend this Policy from time to time. Material changes will be notified through the Platform and / or by email at least seven (7) days before they take effect."
        ]
      },
      {
        id: "contact",
        heading: "11. Grievance Officer",
        body: [
          "In accordance with the Information Technology (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011 and the IT (Intermediary Guidelines & Digital Media Ethics Code) Rules, 2021, the contact details of our Grievance Officer are published on this website and on the Grievance Redressal page below."
        ]
      }
    ]
  },
  terms: {
    slug: "terms",
    title: "Terms & Conditions",
    eyebrow: "Legal · Terms of Use",
    description:
      "The contract between you and JMP NEXTGENPAY PRIVATE LIMITED for use of the NextGenPay Platform, drawn up under the Indian Contract Act, 1872 and the Information Technology Act, 2000.",
    lastUpdated: "01 April 2026",
    governedBy: [
      "Indian Contract Act, 1872",
      "Information Technology Act, 2000",
      "Consumer Protection Act, 2019",
      "RBI Payment & Settlement Systems Act, 2007"
    ],
    sections: [
      {
        id: "acceptance",
        heading: "1. Acceptance of Terms",
        body: [
          "These Terms & Conditions (\"Terms\") form a binding electronic record under Section 10A of the Information Technology Act, 2000 between you (\"User\", \"Retailer\", \"Distributor\", \"Customer\") and JMP NEXTGENPAY PRIVATE LIMITED (\"NextGenPay\", \"Company\"). By registering, accessing or using the Platform you accept these Terms in full."
        ]
      },
      {
        id: "eligibility",
        heading: "2. Eligibility",
        body: [
          "You are eligible to use the Platform only if you are: (a) at least 18 years of age; (b) competent to contract under Section 11 of the Indian Contract Act, 1872; and (c) not barred from receiving services under any Indian law, including RBI / FIU / OFAC sanctions lists."
        ]
      },
      {
        id: "services",
        heading: "3. Description of services",
        body: [
          "NextGenPay is a technology aggregator that facilitates digital financial services including, but not limited to, AePS, DMT, BBPS, UPI, recharges, travel bookings and PAN application. The underlying banking / settlement services are provided by RBI-licensed sponsor banks and NPCI rails. NextGenPay does not itself accept deposits or extend credit."
        ]
      },
      {
        id: "account",
        heading: "4. Account, KYC & responsibilities",
        body: [
          {
            list: [
              "You shall complete KYC as required under the RBI Master Direction on KYC, 2016 prior to availing transactional services.",
              "You are responsible for maintaining confidentiality of your login credentials, MPIN, biometric authentication and OTPs. NextGenPay will never ask for these over phone, SMS or e-mail.",
              "Any transaction performed using your credentials shall be deemed to be performed by you.",
              "You shall not share, sublicense or commercially exploit your access in violation of these Terms."
            ]
          }
        ]
      },
      {
        id: "prohibited",
        heading: "5. Prohibited activities",
        body: [
          "You shall not use the Platform for any purpose that is unlawful under Indian law, including:",
          {
            list: [
              "Money-laundering, terror-financing or any activity prohibited under PMLA, 2002 and UAPA, 1967.",
              "Hosting, transmitting or facilitating content prohibited under Rule 3(1)(b) of the IT Intermediary Rules, 2021.",
              "Impersonation, identity theft or unauthorised use of Aadhaar / PAN / KYC data.",
              "Reverse-engineering, scraping, or circumventing the security controls of the Platform.",
              "Use for gambling, crypto-currency trading, adult content, or any activity restricted by RBI / SEBI."
            ]
          }
        ]
      },
      {
        id: "fees",
        heading: "6. Fees, commissions & taxes",
        body: [
          "Service charges, commission slabs and convenience fees are published on the Charges page and within your dashboard, and may be revised on seven (7) days' prior notice. All amounts are exclusive of applicable taxes (GST), which will be charged at the rates prevailing on the date of invoice."
        ]
      },
      {
        id: "intellectual",
        heading: "7. Intellectual property",
        body: [
          "All trademarks, logos, software, designs, content and brand elements on the Platform are the exclusive property of JMP NEXTGENPAY PRIVATE LIMITED or its licensors, and are protected under the Copyright Act, 1957 and the Trade Marks Act, 1999. No part of the Platform may be reproduced without prior written consent."
        ]
      },
      {
        id: "liability",
        heading: "8. Limitation of liability",
        body: [
          "To the maximum extent permitted by law, the aggregate liability of NextGenPay arising out of or relating to the use of the Platform shall not exceed the aggregate commission earned by, or fees paid by, the User in the three (3) months preceding the event giving rise to the claim. NextGenPay shall not be liable for indirect, incidental, consequential, punitive or special damages."
        ]
      },
      {
        id: "force",
        heading: "9. Force majeure",
        body: [
          "NextGenPay shall not be liable for any failure or delay arising out of events beyond its reasonable control, including acts of God, war, pandemics, regulatory action, internet outages, sponsor-bank downtime or NPCI / UIDAI service disruptions."
        ]
      },
      {
        id: "termination",
        heading: "10. Suspension & termination",
        body: [
          "NextGenPay reserves the right to suspend or terminate your account, with or without notice, where it has reasonable grounds to believe that you are in breach of these Terms, applicable law, or any RBI / NPCI / UIDAI direction."
        ]
      },
      {
        id: "law",
        heading: "11. Governing law & dispute resolution",
        body: [
          "These Terms shall be governed by and construed in accordance with the laws of India. Any dispute, controversy or claim arising out of or in connection with these Terms shall first be attempted to be resolved through good-faith negotiation, failing which through arbitration by a sole arbitrator appointed under the Arbitration & Conciliation Act, 1996. The seat and venue of arbitration shall be Surat, Gujarat. The courts at Surat shall have exclusive jurisdiction subject to the arbitration clause."
        ]
      },
      {
        id: "amend",
        heading: "12. Amendments",
        body: [
          "We reserve the right to amend these Terms. Continued use of the Platform after an amendment shall constitute acceptance of the revised Terms."
        ]
      }
    ]
  },
  refunds: {
    slug: "refunds",
    title: "Refund & Cancellation Policy",
    eyebrow: "Legal · Refunds",
    description:
      "Timelines and process for chargebacks, failed transactions and cancellations, drafted in accordance with the RBI Harmonisation of TAT circular dated 20 September 2019 and the Consumer Protection Act, 2019.",
    lastUpdated: "01 April 2026",
    governedBy: [
      "RBI Circular on Harmonisation of TAT, 20 Sept 2019",
      "Consumer Protection Act, 2019",
      "Payment & Settlement Systems Act, 2007"
    ],
    sections: [
      {
        id: "scope",
        heading: "1. Scope",
        body: [
          "This Refund Policy applies to all transactions initiated through the NextGenPay Platform — AePS, DMT, BBPS, UPI, recharges, travel bookings and any value-added services. Refunds for products / services delivered by third-party billers (electricity boards, telecom operators, airlines, IRCTC, hotel chains) are governed by the policies of the respective billers, but NextGenPay will assist you with end-to-end follow-up."
        ]
      },
      {
        id: "failed",
        heading: "2. Failed-transaction auto-reversal — RBI TAT",
        body: [
          "In line with the RBI's circular on Harmonisation of Turn-Around-Time and Customer Compensation for Failed Transactions, the timelines below apply for auto-reversal. Where the auto-reversal fails to happen within the prescribed TAT, you are entitled to compensation of ₹100 per day of delay credited automatically to the same account.",
          {
            table: {
              headers: ["Channel", "Failure scenario", "Auto-reversal TAT"],
              rows: [
                ["UPI", "Customer debited but beneficiary not credited", "T+1 day"],
                ["IMPS / NEFT", "Account debited but beneficiary not credited", "T+1 day"],
                ["AePS / Aadhaar Pay", "Customer debited but cash not paid at agent", "T+5 days"],
                ["Card transactions", "Customer debited but merchant not credited", "T+5 days"],
                ["BBPS bill payment", "Amount debited but biller not updated", "T+1 day"],
                ["Wallet / PPI", "Wallet debited but transaction failed", "T+1 day"]
              ]
            }
          }
        ]
      },
      {
        id: "how",
        heading: "3. How to raise a refund / dispute",
        body: [
          {
            list: [
              "Log in to your NextGenPay dashboard → Transactions → Raise Dispute.",
              "Or e-mail support@nxtgpay.com with the transaction reference number (RRN), date, amount and a short description.",
              "For UPI disputes you may also raise a request directly with the issuer bank, the NPCI UDIR portal or the RBI Digital Ombudsman."
            ]
          }
        ]
      },
      {
        id: "non-refund",
        heading: "4. Non-refundable items",
        body: [
          {
            list: [
              "Successfully delivered services where the obligation has already been performed (e.g. recharge accepted by operator).",
              "Convenience fees / platform fees once a transaction is completed successfully.",
              "Annual membership / subscription fees of distributor or retailer plans, except where cancellation is exercised within 7 days of activation and no service has been used."
            ]
          }
        ]
      },
      {
        id: "mode",
        heading: "5. Refund mode & timeline",
        body: [
          "Refunds are credited back to the original source of payment. Typical credit timelines: UPI / wallet — within 24 hours; IMPS / NEFT — within 2 working days; credit / debit card — 5 to 7 working days, subject to issuer bank."
        ]
      },
      {
        id: "escalation",
        heading: "6. Escalation matrix",
        body: [
          "If you are not satisfied with the resolution provided at L1 support within 7 days, escalate to:",
          {
            list: [
              "L2 — Grievance Officer, grievance@nxtgpay.com (response within 15 working days)",
              "L3 — Principal Nodal Officer, nodal@nxtgpay.com",
              "L4 — RBI Integrated Ombudsman Scheme, 2021 at cms.rbi.org.in or NPCI Digital Ombudsman"
            ]
          }
        ]
      }
    ]
  },
  charges: {
    slug: "charges",
    title: "Charges & Fees",
    eyebrow: "Legal · Pricing transparency",
    description:
      "All convenience fees, commissions and GST that may apply to transactions on the NextGenPay Platform — published in line with RBI's directions on display of charges.",
    lastUpdated: "01 April 2026",
    governedBy: [
      "RBI Master Direction on Issuance & Operation of PPIs, 2021",
      "Consumer Protection (E-Commerce) Rules, 2020",
      "Central Goods & Services Tax Act, 2017"
    ],
    sections: [
      {
        id: "transparency",
        heading: "1. Transparency commitment",
        body: [
          "We publish every applicable charge upfront. No hidden fees, no surprise mark-ups. All amounts are inclusive / exclusive of GST as expressly mentioned in the table below."
        ]
      },
      {
        id: "schedule",
        heading: "2. Schedule of charges",
        body: [
          {
            table: {
              headers: ["Service", "Customer charge", "Retailer commission", "GST"],
              rows: [
                ["AePS — cash withdrawal", "₹0 (free for customer)", "Up to ₹6 per txn", "18% on commission"],
                ["AePS — balance enquiry / mini-statement", "₹0", "₹0.50 per txn", "18%"],
                ["Domestic Money Transfer (DMT)", "1% of amount, min ₹10", "0.40% to retailer", "18%"],
                ["UPI Collect (P2M)", "₹0 up to ₹2,000 · 0.30% above", "0.10% to retailer", "18%"],
                ["BBPS bill payment", "Convenience fee ₹0 – ₹20 by biller", "₹2 – ₹15 per bill", "18%"],
                ["Mobile / DTH recharge", "₹0", "0.5% – 3% by operator", "18%"],
                ["PAN application (NSDL)", "₹107", "₹15 per application", "18%"],
                ["Travel — flight / bus / hotel", "Convenience fee as per OTA", "0.50% – 4% by route", "18%"],
                ["FASTag recharge", "₹0", "1.5% on tag activation", "18%"]
              ]
            }
          },
          "Charges are indicative and may be revised on seven (7) days' prior notice in your dashboard and via e-mail."
        ]
      },
      {
        id: "subscriptions",
        heading: "3. Membership plans",
        body: [
          "Optional annual plans for retailers and distributors are listed on the Pricing section of the home page. Membership fees are non-refundable once activated, except as set out in the Refund Policy."
        ]
      },
      {
        id: "tax",
        heading: "4. Goods & Services Tax (GST)",
        body: [
          "All commissions and platform charges attract GST at 18% in accordance with the CGST Act, 2017. Tax invoices are auto-generated and available for download from your dashboard."
        ]
      }
    ]
  },
  grievance: {
    slug: "grievance",
    title: "Grievance Redressal Policy",
    eyebrow: "Legal · Customer Service",
    description:
      "Our customer-grievance redressal framework drafted as per the RBI Master Direction on Customer Service, the IT Rules 2021 and the Consumer Protection Act, 2019.",
    lastUpdated: "01 April 2026",
    governedBy: [
      "RBI Master Direction on Customer Service in Banks",
      "IT (Intermediary Guidelines) Rules, 2021",
      "Consumer Protection Act, 2019",
      "Integrated Ombudsman Scheme, 2021"
    ],
    sections: [
      {
        id: "principles",
        heading: "1. Principles",
        body: [
          "Every complaint shall be treated with fairness, transparency and empathy. We commit to acknowledging every complaint within 24 hours and providing a final response within 15 working days."
        ]
      },
      {
        id: "channels",
        heading: "2. How to reach us",
        body: [
          {
            list: [
              "In-app — Help → Raise a Ticket",
              "E-mail — support@nxtgpay.com",
              "WhatsApp / Phone — +91 8780224955 (10 AM – 6 PM IST, Mon–Sat)",
              "Letter — Customer Care, JMP NEXTGENPAY PRIVATE LIMITED, 2nd Floor, 201, Devi Arcade, Ashwini Kumar Road, Modi Maholla, Surat – 395008"
            ]
          }
        ]
      },
      {
        id: "matrix",
        heading: "3. Escalation matrix",
        body: [
          {
            table: {
              headers: ["Level", "Officer", "Channel", "TAT"],
              rows: [
                ["Level 1", "Customer Care Executive", "support@nxtgpay.com", "7 working days"],
                ["Level 2", "Grievance Officer", "grievance@nxtgpay.com · +91 8780224955", "15 working days"],
                ["Level 3", "Principal Nodal Officer", "nodal@nxtgpay.com · +91 8780224955", "30 days"],
                ["Level 4", "RBI Integrated Ombudsman", "cms.rbi.org.in · 14448 (toll-free)", "As per scheme"]
              ]
            }
          }
        ]
      },
      {
        id: "consumer",
        heading: "4. Consumer Protection Act, 2019",
        body: [
          "Nothing in this policy shall limit any right available to a consumer under the Consumer Protection Act, 2019, including the right to approach the appropriate District / State / National Commission."
        ]
      }
    ]
  }
};

export type Transaction = {
  id: string;
  service: string;
  amount: number;
  status: "Success" | "Pending" | "Failed";
  date: string;
  customer: string;
  commission: number;
};

export type NetworkUser = {
  id: string;
  name: string;
  shop: string;
  role: "retailer" | "distributor" | "master-distributor";
  parentId?: string;
  city: string;
  state: string;
  joined: string;
  status: "Active" | "Pending KYC" | "Suspended";
  walletBalance: number;
  monthlyTurnover: number;
  retailers?: number;
};

/** Live network data comes from /api/network — kept empty so dashboards never show seed fiction. */
export const networkUsers: NetworkUser[] = [];

export type FundRequest = {
  id: string;
  fromId: string;
  fromName: string;
  toId: string;
  amount: number;
  mode: "IMPS" | "NEFT" | "UPI" | "RTGS" | "Cash Deposit";
  reference: string;
  date: string;
  status: "Pending" | "Approved" | "Rejected";
  remarks?: string;
};

/** Live fund requests come from /api/fund-request. */
export const fundRequests: FundRequest[] = [];

export type KycRequest = {
  id: string;
  name: string;
  shop: string;
  city: string;
  role: "retailer" | "distributor" | "master-distributor";
  pan: string;
  aadhaar: string;
  submittedOn: string;
  status: "Awaiting Review" | "Verified" | "Rejected";
};

export const kycRequests: KycRequest[] = [
  {
    id: "KYC-001",
    name: "Anita Bose",
    shop: "Bose Tradelink",
    city: "Kolkata",
    role: "distributor",
    pan: "BNPLM4571F",
    aadhaar: "XXXX-XXXX-7891",
    submittedOn: "Apr 18, 2026",
    status: "Awaiting Review"
  },
  {
    id: "KYC-002",
    name: "Kavita Devi",
    shop: "Devi Sewa Kendra",
    city: "Nashik",
    role: "retailer",
    pan: "DKVPS1212K",
    aadhaar: "XXXX-XXXX-1245",
    submittedOn: "Apr 18, 2026",
    status: "Awaiting Review"
  },
  {
    id: "KYC-003",
    name: "Iqbal Khan",
    shop: "Khan Mobile Centre",
    city: "Hyderabad",
    role: "retailer",
    pan: "IKKAJ5621Z",
    aadhaar: "XXXX-XXXX-8910",
    submittedOn: "Apr 17, 2026",
    status: "Awaiting Review"
  },
  {
    id: "KYC-004",
    name: "Vivek Joshi",
    shop: "Joshi Travels",
    city: "Indore",
    role: "retailer",
    pan: "VKJOS9912R",
    aadhaar: "XXXX-XXXX-3344",
    submittedOn: "Apr 16, 2026",
    status: "Verified"
  },
  {
    id: "KYC-005",
    name: "Rashida Begum",
    shop: "RB Sewa Kendra",
    city: "Patna",
    role: "retailer",
    pan: "RBPSK0921L",
    aadhaar: "XXXX-XXXX-5566",
    submittedOn: "Apr 15, 2026",
    status: "Rejected"
  }
];

export type CommissionSlab = {
  service: string;
  retailer: string;
  distributor: string;
  master: string;
};

export const commissionSlabs: CommissionSlab[] = [
  { service: "AePS Withdrawal", retailer: "0.40%", distributor: "0.10%", master: "0.05%" },
  { service: "DMT (IMPS)", retailer: "₹6 / txn", distributor: "₹2 / txn", master: "₹1 / txn" },
  { service: "Mobile Recharge", retailer: "3.00%", distributor: "0.40%", master: "0.20%" },
  { service: "DTH Recharge", retailer: "3.50%", distributor: "0.50%", master: "0.20%" },
  { service: "Electricity Bill", retailer: "0.80%", distributor: "0.20%", master: "0.10%" },
  { service: "LPG Booking", retailer: "₹4 / txn", distributor: "₹1 / txn", master: "₹0.50 / txn" },
  { service: "UPI Collect", retailer: "0.20%", distributor: "0.05%", master: "0.025%" },
  { service: "Travel - Bus", retailer: "5.00%", distributor: "0.80%", master: "0.40%" }
];

export type Biller = {
  category: string;
  count: number;
  routing: string;
  uptime: string;
  status: "Live" | "Degraded" | "Down";
};

export const billers: Biller[] = [
  { category: "Electricity", count: 84, routing: "BBPS · NPCI", uptime: "99.92%", status: "Live" },
  { category: "Water", count: 36, routing: "BBPS · NPCI", uptime: "99.81%", status: "Live" },
  { category: "Gas (Piped + LPG)", count: 24, routing: "BBPS + Direct", uptime: "99.97%", status: "Live" },
  { category: "Telecom", count: 12, routing: "Direct API", uptime: "99.99%", status: "Live" },
  { category: "DTH", count: 6, routing: "Direct API", uptime: "98.42%", status: "Degraded" },
  { category: "Credit Card", count: 41, routing: "BBPS", uptime: "99.95%", status: "Live" },
  { category: "Education", count: 312, routing: "Eduvanz / Direct", uptime: "99.74%", status: "Live" },
  { category: "Insurance", count: 28, routing: "BBPS", uptime: "99.90%", status: "Live" },
  { category: "FASTag", count: 23, routing: "NPCI · NETC", uptime: "99.99%", status: "Live" },
  { category: "Municipal Tax", count: 162, routing: "BBPS", uptime: "98.10%", status: "Degraded" }
];

export type AuditEvent = {
  id: string;
  actor: string;
  action: string;
  target: string;
  ip: string;
  ts: string;
  severity: "info" | "warn" | "danger";
};

export const auditEvents: AuditEvent[] = [
  { id: "AU-94221", actor: "admin@nxtgpay.com", action: "Approved KYC", target: "Vivek Joshi (KYC-004)", ip: "10.18.4.21", ts: "Apr 19, 10:22 AM", severity: "info" },
  { id: "AU-94220", actor: "neha.k@nxtgpay.com", action: "Override commission", target: "DMT IMPS · JNPD2017", ip: "49.207.211.4", ts: "Apr 19, 09:51 AM", severity: "warn" },
  { id: "AU-94219", actor: "admin@nxtgpay.com", action: "Suspended retailer", target: "JNPR3217 (Patil Enterprises)", ip: "10.18.4.21", ts: "Apr 19, 09:14 AM", severity: "danger" },
  { id: "AU-94218", actor: "system", action: "Biller routing failover", target: "DTH · Tata Play → fallback", ip: "n/a", ts: "Apr 19, 08:42 AM", severity: "warn" },
  { id: "AU-94217", actor: "rohit.v@nxtgpay.com", action: "Approved fund request", target: "FR-9003 · ₹15,000", ip: "182.65.21.99", ts: "Apr 18, 06:30 PM", severity: "info" },
  { id: "AU-94216", actor: "system", action: "Settlement run", target: "T+1 · ₹8.42 Cr · 12,481 txns", ip: "n/a", ts: "Apr 18, 11:05 PM", severity: "info" }
];

export type Settlement = {
  id: string;
  cycle: string;
  counterparty: string;
  amount: number;
  status: "Settled" | "In Bank" | "Reconciling";
  date: string;
};

export const settlements: Settlement[] = [
  { id: "STL-2026-04-18", cycle: "T+1", counterparty: "ICICI Nodal", amount: 84272340, status: "Settled", date: "Apr 18, 2026" },
  { id: "STL-2026-04-17", cycle: "T+1", counterparty: "ICICI Nodal", amount: 79914000, status: "Settled", date: "Apr 17, 2026" },
  { id: "STL-2026-04-16", cycle: "T+1", counterparty: "ICICI Nodal", amount: 68142890, status: "Settled", date: "Apr 16, 2026" },
  { id: "STL-2026-04-15", cycle: "T+1", counterparty: "Yes Bank Nodal", amount: 14820000, status: "In Bank", date: "Apr 15, 2026" },
  { id: "STL-2026-04-14", cycle: "T+1", counterparty: "Yes Bank Nodal", amount: 12482111, status: "Reconciling", date: "Apr 14, 2026" }
];

export type SystemMetric = {
  service: string;
  uptime: string;
  p95ms: number;
  txnsToday: number;
  errorRate: string;
};

export const systemMetrics: SystemMetric[] = [
  { service: "AePS Switch", uptime: "99.98%", p95ms: 412, txnsToday: 184221, errorRate: "0.04%" },
  { service: "DMT - IMPS", uptime: "99.99%", p95ms: 286, txnsToday: 98412, errorRate: "0.02%" },
  { service: "UPI Collect", uptime: "99.99%", p95ms: 212, txnsToday: 482011, errorRate: "0.01%" },
  { service: "BBPS Gateway", uptime: "99.92%", p95ms: 642, txnsToday: 121088, errorRate: "0.18%" },
  { service: "Recharge Aggregator", uptime: "99.86%", p95ms: 521, txnsToday: 312441, errorRate: "0.12%" },
  { service: "Travel Aggregator", uptime: "99.74%", p95ms: 1421, txnsToday: 8421, errorRate: "0.34%" }
];

export type Integration = {
  name: string;
  category: string;
  href?: string;
  initials: string;
  color: string;
};

export const integrations: Integration[] = [
  { name: "NPCI", category: "Switch", initials: "NPCI", color: "from-brand-500 to-brand-700" },
  { name: "NPCI Bharat BillPay", category: "BBPS", initials: "BBPS", color: "from-brand-600 to-violet-600" },
  { name: "RBI Sandbox", category: "Regulatory", initials: "RBI", color: "from-ink-700 to-ink-900" },
  { name: "ICICI Nodal", category: "Nodal Bank", initials: "ICICI", color: "from-orange-500 to-rose-500" },
  { name: "Yes Bank Nodal", category: "Nodal Bank", initials: "YES", color: "from-blue-500 to-indigo-600" },
  { name: "Axis Bank", category: "DMT Partner", initials: "AXIS", color: "from-rose-500 to-pink-600" },
  { name: "Visa", category: "Card Network", initials: "VISA", color: "from-blue-700 to-blue-900" },
  { name: "Mastercard", category: "Card Network", initials: "MC", color: "from-amber-500 to-rose-500" },
  { name: "RuPay", category: "Card Network", initials: "RUPAY", color: "from-emerald-500 to-brand-500" },
  { name: "Aadhaar / UIDAI", category: "Identity", initials: "UIDAI", color: "from-amber-500 to-orange-600" },
  { name: "Mantra MFS100", category: "Biometric", initials: "MFS", color: "from-violet-500 to-fuchsia-600" },
  { name: "Morpho MSO 1300", category: "Biometric", initials: "MORPH", color: "from-cyan-500 to-blue-600" }
];

/* ── Payment Gateway (PG) ───────────────────────────────────────────── */

export type PgMerchant = {
  id: string;
  name: string;
  business: string;
  city: string;
  mid: string;
  modes: string[];
  mdr: string;
  status: "Live" | "Pending KYC" | "Suspended";
  volume30d: number;
  onboarded: string;
};

export const pgMerchants: PgMerchant[] = [
  {
    id: "MER-1001",
    name: "Hiren Desai",
    business: "Desai Textiles",
    city: "Surat",
    mid: "NGPM84211",
    modes: ["UPI", "Cards", "Net Banking"],
    mdr: "UPI 0% · Cards 1.20%",
    status: "Live",
    volume30d: 4825000,
    onboarded: "May 02, 2026"
  },
  {
    id: "MER-1002",
    name: "Farhan Shaikh",
    business: "FS Electronics",
    city: "Ahmedabad",
    mid: "NGPM84230",
    modes: ["UPI", "Cards", "Wallets"],
    mdr: "UPI 0% · Cards 1.10%",
    status: "Live",
    volume30d: 2214000,
    onboarded: "May 11, 2026"
  },
  {
    id: "MER-1003",
    name: "Bhavna Patel",
    business: "Patel Jewellers",
    city: "Surat",
    mid: "NGPM84274",
    modes: ["UPI", "Cards", "Net Banking", "EMI"],
    mdr: "UPI 0% · Cards 0.95%",
    status: "Live",
    volume30d: 9120000,
    onboarded: "May 19, 2026"
  },
  {
    id: "MER-1004",
    name: "Ravi Iyer",
    business: "Iyer Pharma Mart",
    city: "Vadodara",
    mid: "NGPM84301",
    modes: ["UPI", "Cards"],
    mdr: "UPI 0% · Cards 1.40%",
    status: "Pending KYC",
    volume30d: 0,
    onboarded: "Jun 06, 2026"
  },
  {
    id: "MER-1005",
    name: "Deepak Rana",
    business: "Rana Mobile Hub",
    city: "Rajkot",
    mid: "NGPM84318",
    modes: ["UPI"],
    mdr: "UPI 0%",
    status: "Suspended",
    volume30d: 84000,
    onboarded: "Apr 21, 2026"
  }
];

export type PgTransaction = {
  id: string;
  orderId: string;
  merchant: string;
  mode: "UPI" | "Card" | "Net Banking" | "Wallet";
  amount: number;
  fee: number;
  status: "Success" | "Pending" | "Failed" | "Refunded";
  settlement: "Settled" | "T+1 Queue" | "—";
  date: string;
};

export const pgTransactions: PgTransaction[] = [
  { id: "PGT-88412", orderId: "ORD-20312", merchant: "Desai Textiles", mode: "UPI", amount: 12400, fee: 0, status: "Success", settlement: "T+1 Queue", date: "Jun 12, 2026 · 11:42 AM" },
  { id: "PGT-88409", orderId: "ORD-20309", merchant: "Patel Jewellers", mode: "Card", amount: 86500, fee: 822, status: "Success", settlement: "T+1 Queue", date: "Jun 12, 2026 · 11:18 AM" },
  { id: "PGT-88401", orderId: "ORD-20301", merchant: "FS Electronics", mode: "Net Banking", amount: 23999, fee: 288, status: "Success", settlement: "T+1 Queue", date: "Jun 12, 2026 · 10:52 AM" },
  { id: "PGT-88394", orderId: "ORD-20294", merchant: "Desai Textiles", mode: "UPI", amount: 5600, fee: 0, status: "Pending", settlement: "—", date: "Jun 12, 2026 · 10:31 AM" },
  { id: "PGT-88381", orderId: "ORD-20281", merchant: "Patel Jewellers", mode: "Card", amount: 145000, fee: 1378, status: "Success", settlement: "Settled", date: "Jun 11, 2026 · 06:24 PM" },
  { id: "PGT-88375", orderId: "ORD-20275", merchant: "FS Electronics", mode: "Wallet", amount: 1899, fee: 23, status: "Refunded", settlement: "—", date: "Jun 11, 2026 · 04:12 PM" },
  { id: "PGT-88362", orderId: "ORD-20262", merchant: "Rana Mobile Hub", mode: "UPI", amount: 8500, fee: 0, status: "Failed", settlement: "—", date: "Jun 11, 2026 · 01:08 PM" }
];

/* ── Point of Sale (POS) ────────────────────────────────────────────── */

export type PosMachine = {
  serial: string;
  model: string;
  assignedTo: string;
  city: string;
  status: "Active" | "In Stock" | "Faulty" | "Returned";
  plan: string;
  monthlyRent: number;
  txns30d: number;
  volume30d: number;
};

export const posMachines: PosMachine[] = [
  { serial: "NGP-POS-30121", model: "PAX A920 Pro", assignedTo: "Desai Textiles", city: "Surat", status: "Active", plan: "Rental · Standard", monthlyRent: 499, txns30d: 1284, volume30d: 2418000 },
  { serial: "NGP-POS-30122", model: "PAX A920 Pro", assignedTo: "Patel Jewellers", city: "Surat", status: "Active", plan: "Rental · Premium", monthlyRent: 799, txns30d: 842, volume30d: 6120000 },
  { serial: "NGP-POS-30126", model: "Verifone X990", assignedTo: "FS Electronics", city: "Ahmedabad", status: "Active", plan: "Rental · Standard", monthlyRent: 499, txns30d: 611, volume30d: 1422000 },
  { serial: "NGP-POS-30131", model: "PAX A77", assignedTo: "—", city: "Warehouse · Surat", status: "In Stock", plan: "—", monthlyRent: 0, txns30d: 0, volume30d: 0 },
  { serial: "NGP-POS-30132", model: "PAX A77", assignedTo: "—", city: "Warehouse · Surat", status: "In Stock", plan: "—", monthlyRent: 0, txns30d: 0, volume30d: 0 },
  { serial: "NGP-POS-30118", model: "Verifone X990", assignedTo: "Rana Mobile Hub", city: "Rajkot", status: "Faulty", plan: "Rental · Standard", monthlyRent: 499, txns30d: 12, volume30d: 31000 },
  { serial: "NGP-POS-30102", model: "PAX A920", assignedTo: "—", city: "Returned · Surat", status: "Returned", plan: "—", monthlyRent: 0, txns30d: 0, volume30d: 0 }
];

export type PosTransaction = {
  id: string;
  terminal: string;
  merchant: string;
  mode: "Card" | "UPI" | "BharatQR" | "Tap & Pay";
  amount: number;
  status: "Approved" | "Declined" | "Voided" | "Refunded";
  settlement: "Settled" | "T+1 Queue" | "—";
  date: string;
};

export const posTransactions: PosTransaction[] = [
  { id: "POS-77231", terminal: "NGP-POS-30122", merchant: "Patel Jewellers", mode: "Card", amount: 58000, status: "Approved", settlement: "T+1 Queue", date: "Jun 12, 2026 · 12:04 PM" },
  { id: "POS-77226", terminal: "NGP-POS-30121", merchant: "Desai Textiles", mode: "UPI", amount: 3450, status: "Approved", settlement: "T+1 Queue", date: "Jun 12, 2026 · 11:48 AM" },
  { id: "POS-77219", terminal: "NGP-POS-30126", merchant: "FS Electronics", mode: "Tap & Pay", amount: 12999, status: "Approved", settlement: "T+1 Queue", date: "Jun 12, 2026 · 11:21 AM" },
  { id: "POS-77204", terminal: "NGP-POS-30121", merchant: "Desai Textiles", mode: "BharatQR", amount: 1860, status: "Approved", settlement: "Settled", date: "Jun 11, 2026 · 07:42 PM" },
  { id: "POS-77198", terminal: "NGP-POS-30122", merchant: "Patel Jewellers", mode: "Card", amount: 24500, status: "Voided", settlement: "—", date: "Jun 11, 2026 · 05:16 PM" },
  { id: "POS-77185", terminal: "NGP-POS-30118", merchant: "Rana Mobile Hub", mode: "Card", amount: 7200, status: "Declined", settlement: "—", date: "Jun 11, 2026 · 02:39 PM" }
];

export type PosRental = {
  invoice: string;
  terminal: string;
  merchant: string;
  plan: string;
  amount: number;
  dueDate: string;
  status: "Paid" | "Due" | "Overdue";
};

export const posRentals: PosRental[] = [
  { invoice: "RNT-2026-06-011", terminal: "NGP-POS-30121", merchant: "Desai Textiles", plan: "Standard", amount: 499, dueDate: "Jun 05, 2026", status: "Paid" },
  { invoice: "RNT-2026-06-012", terminal: "NGP-POS-30122", merchant: "Patel Jewellers", plan: "Premium", amount: 799, dueDate: "Jun 05, 2026", status: "Paid" },
  { invoice: "RNT-2026-06-013", terminal: "NGP-POS-30126", merchant: "FS Electronics", plan: "Standard", amount: 499, dueDate: "Jun 05, 2026", status: "Due" },
  { invoice: "RNT-2026-06-014", terminal: "NGP-POS-30118", merchant: "Rana Mobile Hub", plan: "Standard", amount: 499, dueDate: "May 05, 2026", status: "Overdue" }
];

/* ── QR Code Payments ───────────────────────────────────────────────── */

export type QrCodeItem = {
  id: string;
  type: "Static" | "Dynamic";
  label: string;
  vpa: string;
  amount?: number;
  created: string;
  payments: number;
  collected: number;
  status: "Active" | "Expired" | "Disabled";
};

export const qrCodes: QrCodeItem[] = [
  { id: "QR-5001", type: "Static", label: "Shop Counter 1", vpa: "nextgenpay.desai@icici", created: "May 02, 2026", payments: 1841, collected: 1284500, status: "Active" },
  { id: "QR-5002", type: "Static", label: "Shop Counter 2", vpa: "nextgenpay.desai2@icici", created: "May 02, 2026", payments: 644, collected: 412800, status: "Active" },
  { id: "QR-5014", type: "Dynamic", label: "Invoice #4421", vpa: "nextgenpay.desai@icici", amount: 12400, created: "Jun 12, 2026", payments: 1, collected: 12400, status: "Expired" },
  { id: "QR-5015", type: "Dynamic", label: "Invoice #4427", vpa: "nextgenpay.desai@icici", amount: 8600, created: "Jun 12, 2026", payments: 0, collected: 0, status: "Active" },
  { id: "QR-5009", type: "Static", label: "Delivery Van", vpa: "nextgenpay.desai3@icici", created: "May 22, 2026", payments: 102, collected: 89200, status: "Disabled" }
];

export type QrPayment = {
  id: string;
  qrId: string;
  payer: string;
  amount: number;
  status: "Received" | "Pending" | "Failed";
  settled: boolean;
  date: string;
};

export const qrPayments: QrPayment[] = [
  { id: "QRP-99121", qrId: "QR-5001", payer: "ramesh.k@oksbi", amount: 1250, status: "Received", settled: false, date: "Jun 12, 2026 · 12:10 PM" },
  { id: "QRP-99118", qrId: "QR-5014", payer: "sunita@ybl", amount: 12400, status: "Received", settled: false, date: "Jun 12, 2026 · 11:44 AM" },
  { id: "QRP-99110", qrId: "QR-5001", payer: "arif.m@paytm", amount: 480, status: "Received", settled: false, date: "Jun 12, 2026 · 10:58 AM" },
  { id: "QRP-99094", qrId: "QR-5002", payer: "jay.p@okaxis", amount: 2200, status: "Received", settled: true, date: "Jun 11, 2026 · 08:21 PM" },
  { id: "QRP-99082", qrId: "QR-5001", payer: "meena@upi", amount: 940, status: "Failed", settled: false, date: "Jun 11, 2026 · 06:02 PM" },
  { id: "QRP-99075", qrId: "QR-5002", payer: "vikas.t@ibl", amount: 1675, status: "Received", settled: true, date: "Jun 11, 2026 · 03:47 PM" }
];

/** Live transactions come from /api/transactions. */
export const recentTransactions: Transaction[] = [];
