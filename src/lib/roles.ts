import {
  LayoutDashboard,
  Wallet,
  Send,
  Fingerprint,
  Smartphone,
  Receipt,
  Plane,
  History,
  User,
  Settings,
  LifeBuoy,
  QrCode,
  Users,
  ShieldCheck,
  ServerCog,
  KeyRound,
  Megaphone,
  BarChart3,
  Building2,
  CircleDollarSign,
  ScrollText,
  PackagePlus,
  HandCoins,
  Globe,
  UserCog,
  CreditCard,
  Monitor,
  Activity,
  Landmark,
  ListChecks,
  Power,
  Layers,
  Images,
  ShieldAlert,
  FileSignature,
  BookOpenCheck,
  Timer,
  Undo2,
  ReceiptText,
  LineChart,
  ScanSearch,
  SlidersHorizontal,
  Tag,
  TrendingUp,
  Inbox,
  Network,
  type LucideIcon
} from "lucide-react";
import type { Role } from "@/lib/auth";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
};

export type NavGroup = {
  heading: string;
  items: NavItem[];
};

/* ──────────────────────────────────────────────────────────────────────
 * Shared building blocks. Hrefs are load-bearing (service-key filtering
 * and allowedTabs matching key off them) — only labels/grouping/order
 * are presentation and may change.
 * ────────────────────────────────────────────────────────────────────── */

/** Money-in rails — accept payments from customers. */
const moneyInServices: NavItem[] = [
  { href: "/dashboard/qr", label: "QR Collections", icon: QrCode },
  { href: "/dashboard/pg", label: "Payment Gateway", icon: CreditCard },
  { href: "/dashboard/pos", label: "POS Terminals", icon: Monitor },
  { href: "/dashboard/upi", label: "UPI Collect", icon: Send },
  { href: "/dashboard/virtual-account", label: "Virtual Accounts", icon: Building2 }
];

/** Money-out rails — send money to banks, billers and customers. */
const moneyOutServices: NavItem[] = [
  { href: "/dashboard/money-transfer", label: "Money Transfer", icon: Send },
  { href: "/dashboard/payout", label: "Bank Payouts", icon: Landmark },
  { href: "/dashboard/aadhaar-pay", label: "AePS Banking", icon: Fingerprint },
  { href: "/dashboard/recharge/mobile", label: "Recharges", icon: Smartphone },
  { href: "/dashboard/travel/flight", label: "Travel Bookings", icon: Plane }
];

/** BBPS bill-payment rails — retailer only. */
const billPayServices: NavItem[] = [
  { href: "/dashboard/bill-pay/credit-card", label: "Credit Card Bills", icon: CreditCard },
  { href: "/dashboard/bill-pay/cc-pay", label: "Credit Card Direct", icon: CreditCard },
  { href: "/dashboard/bill-pay/bbps-1", label: "Bharat BillPay (BBPS)", icon: Receipt },
  { href: "/dashboard/bill-pay/bbps-2", label: "Utility Bills Hub", icon: Receipt }
];

/** Personal reporting for network roles. */
const insightItems: NavItem[] = [
  { href: "/dashboard/transactions", label: "Transaction History", icon: History },
  { href: "/dashboard/performance", label: "Business Pulse", icon: Activity },
  { href: "/dashboard/reports", label: "Reports & Statements", icon: BarChart3 }
];

const accountItems: NavItem[] = [
  { href: "/dashboard/profile", label: "My Profile", icon: User },
  { href: "/dashboard/settings", label: "Security & Settings", icon: Settings },
  { href: "/dashboard/disputes", label: "Help Desk", icon: LifeBuoy }
];

/** Full account block for staff roles (keeps every legacy destination). */
const staffAccountItems: NavItem[] = [
  { href: "/dashboard/performance", label: "Business Pulse", icon: Activity },
  { href: "/dashboard/transactions", label: "My Transactions", icon: History },
  { href: "/dashboard/ledger", label: "My Ledger", icon: BookOpenCheck },
  { href: "/dashboard/profile", label: "My Profile", icon: User },
  { href: "/dashboard/settings", label: "Security & Settings", icon: Settings },
  { href: "/dashboard/disputes", label: "My Tickets", icon: LifeBuoy }
];

/** Canonical tab slugs (without role prefix) used for permission assignment */
export const ASSIGNABLE_ADMIN_TABS = [
  { href: "invites", label: "Onboarding Invites" },
  { href: "join-requests", label: "Join Requests" },
  { href: "users", label: "User Directory" },
  { href: "network", label: "Network Tree" },
  { href: "sub-admins", label: "Sub-Admin Desk" },
  { href: "wallet-ops", label: "Wallet Operations" },
  { href: "ledger", label: "Ledger Explorer" },
  { href: "pg", label: "Payment Gateway" },
  { href: "pos", label: "POS Fleet" },
  { href: "pos-rental", label: "POS Rental & Billing" },
  { href: "kyc", label: "KYC Approvals" },
  { href: "schemes", label: "Pricing Schemes" },
  { href: "brands", label: "Brands & MDR" },
  { href: "settlement-ops", label: "Settlement Desk" },
  { href: "pos-settlement", label: "POS Settlements" },
  { href: "reversals", label: "Reversal Desk" },
  { href: "aeps", label: "AePS Centre" },
  { href: "qr", label: "QR Collections" },
  { href: "disputes", label: "Support Desk" },
  { href: "aml", label: "AML Monitoring" },
  { href: "commission-report", label: "Commission Payouts" },
  { href: "earnings", label: "Per-Txn Earnings" },
  { href: "analytics", label: "Business Analytics" },
  { href: "agreements", label: "Agreements Vault" },
  { href: "verify", label: "Identity Toolkit" },
  { href: "services", label: "Service Switches" },
  { href: "controls", label: "Platform Controls" },
  { href: "slider", label: "Banners & Pop-ups" },
  { href: "audit", label: "Audit Trail" },
  { href: "system", label: "System Health" },
] as const;

/** Tabs a master-admin creator can assign to another master-admin.
 *  Includes everything from ASSIGNABLE_ADMIN_TABS + the "admins" tab. */
export const ASSIGNABLE_MASTER_ADMIN_TABS = [
  { href: "admins", label: "Admin Team" },
  // "Company Earnings" (Revenue Wallet) is owner-only — assignable to master
  // admins, but never to plain admins/sub-admins (not in ASSIGNABLE_ADMIN_TABS).
  { href: "revenue", label: "Company Earnings" },
  ...ASSIGNABLE_ADMIN_TABS,
] as const;

/** Tab slugs an admin (or master-admin) can grant to a sub-admin. Sub-admins
 *  can now be granted any admin tab; sensitive money-movement pages stay
 *  view-only for the SUPPORT role via the per-endpoint requireRole guards. */
export const ASSIGNABLE_SUB_ADMIN_TABS = ASSIGNABLE_ADMIN_TABS;

/* ──────────────────────────────────────────────────────────────────────
 * Staff (master-admin / admin / sub-admin) groups — journey-based:
 * Command Centre → People & Onboarding → Money Desk → Payment Rails →
 * Risk & Compliance → Insights → Account.
 * ────────────────────────────────────────────────────────────────────── */

const adminCommand: NavItem[] = [
  { href: "/dashboard", label: "Command Centre", icon: LayoutDashboard },
  { href: "/dashboard/admin/analytics", label: "Business Analytics", icon: LineChart },
  { href: "/dashboard/admin/system", label: "System Health", icon: ServerCog },
  { href: "/dashboard/admin/audit", label: "Audit Trail", icon: ScrollText }
];

const adminPeople: NavItem[] = [
  { href: "/dashboard/admin/invites", label: "Onboarding Invites", icon: PackagePlus },
  { href: "/dashboard/admin/join-requests", label: "Join Requests", icon: Inbox },
  { href: "/dashboard/admin/users", label: "User Directory", icon: Users },
  { href: "/dashboard/admin/network", label: "Network Tree", icon: Network },
  { href: "/dashboard/admin/kyc", label: "KYC Approvals", icon: ShieldCheck },
  { href: "/dashboard/admin/agreements", label: "Agreements Vault", icon: FileSignature },
  { href: "/dashboard/admin/sub-admins", label: "Sub-Admin Desk", icon: UserCog }
];

const adminMoneyDesk: NavItem[] = [
  { href: "/dashboard/admin/wallet-ops", label: "Wallet Operations", icon: Wallet },
  { href: "/dashboard/admin/ledger", label: "Ledger Explorer", icon: BookOpenCheck },
  { href: "/dashboard/admin/settlement-ops", label: "Settlement Desk", icon: Timer },
  { href: "/dashboard/admin/pos-settlement", label: "POS Settlements", icon: CreditCard },
  { href: "/dashboard/admin/reversals", label: "Reversal Desk", icon: Undo2 },
  { href: "/dashboard/payout-approvals", label: "Payout Approvals", icon: ListChecks }
];

/** Money Desk for the platform OWNER — also surfaces "Company Earnings"
 *  (the Revenue Wallet), which is never shown to plain admins/sub-admins. */
const masterMoneyDesk: NavItem[] = adminMoneyDesk.flatMap((item) =>
  item.href === "/dashboard/admin/ledger"
    ? [item, { href: "/dashboard/admin/revenue", label: "Company Earnings", icon: CircleDollarSign }]
    : [item]
);

const adminRails: NavItem[] = [
  { href: "/dashboard/admin/pg", label: "Payment Gateway", icon: CreditCard },
  { href: "/dashboard/admin/pos", label: "POS Fleet", icon: Monitor },
  { href: "/dashboard/admin/pos-rental", label: "POS Rental & Billing", icon: ReceiptText },
  { href: "/dashboard/admin/qr", label: "QR Collections", icon: QrCode },
  { href: "/dashboard/admin/aeps", label: "AePS Centre", icon: Fingerprint },
  { href: "/dashboard/admin/services", label: "Service Switches", icon: Power },
  { href: "/dashboard/admin/schemes", label: "Pricing Schemes", icon: Layers },
  { href: "/dashboard/admin/brands", label: "Brands & MDR", icon: Tag }
];

const adminRisk: NavItem[] = [
  { href: "/dashboard/admin/aml", label: "AML Monitoring", icon: ShieldAlert },
  { href: "/dashboard/admin/verify", label: "Identity Toolkit", icon: ScanSearch },
  { href: "/dashboard/admin/disputes", label: "Support Desk", icon: LifeBuoy },
  { href: "/dashboard/admin/controls", label: "Platform Controls", icon: SlidersHorizontal }
];

const adminInsights: NavItem[] = [
  { href: "/dashboard/admin/commission-report", label: "Commission Payouts", icon: HandCoins },
  { href: "/dashboard/admin/earnings", label: "Per-Txn Earnings", icon: TrendingUp },
  { href: "/dashboard/reports", label: "Reports Studio", icon: BarChart3 },
  { href: "/dashboard/admin/slider", label: "Banners & Pop-ups", icon: Images }
];

const adminGroups = (moneyDesk: NavItem[], extraCommand: NavItem[] = []): NavGroup[] => [
  { heading: "Command Centre", items: [...adminCommand.slice(0, 1), ...extraCommand, ...adminCommand.slice(1)] },
  { heading: "People & Onboarding", items: adminPeople },
  { heading: "Money Desk", items: moneyDesk },
  { heading: "Payment Rails", items: adminRails },
  { heading: "Risk & Compliance", items: adminRisk },
  { heading: "Insights & Growth", items: adminInsights },
  { heading: "Account", items: staffAccountItems }
];

/* ──────────────────────────────────────────────────────────────────────
 * Network roles (SD / MD / DT) share a common shape; labels flex per tier.
 * ────────────────────────────────────────────────────────────────────── */

const networkGroups = ({
  directoryLabel,
  onboardLabel,
  commissionLabel,
  platform
}: {
  directoryLabel: string;
  onboardLabel: string;
  commissionLabel: string;
  platform?: boolean;
}): NavGroup[] => [
  {
    heading: "Home",
    items: [
      { href: "/dashboard", label: "Home", icon: LayoutDashboard },
      { href: "/dashboard/earnings", label: "My Earnings", icon: CircleDollarSign },
      { href: "/dashboard/my-scheme", label: "My Pricing Plan", icon: Layers }
    ]
  },
  {
    heading: "My Network",
    items: [
      { href: "/dashboard/network", label: directoryLabel, icon: Users },
      { href: "/dashboard/network/onboard", label: onboardLabel, icon: PackagePlus },
      { href: "/dashboard/funds-request", label: "Fund Requests", icon: HandCoins },
      { href: "/dashboard/payout-approvals", label: "Payout Approvals", icon: ListChecks },
      { href: "/dashboard/approvals", label: "Declaration Approvals", icon: FileSignature },
      { href: "/dashboard/commissions", label: commissionLabel, icon: TrendingUp },
      { href: "/dashboard/pos-rental", label: "POS Rental Billing", icon: ReceiptText }
    ]
  },
  { heading: "Money In", items: moneyInServices },
  { heading: "Money Out", items: moneyOutServices },
  {
    heading: "Wallet",
    items: [
      { href: "/dashboard/wallet", label: "My Wallet", icon: Wallet },
      { href: "/dashboard/ledger", label: "Wallet Ledger", icon: BookOpenCheck }
    ]
  },
  ...(platform
    ? [
        {
          heading: "Platform",
          items: [
            { href: "/dashboard/api", label: "API & Integrations", icon: KeyRound },
            { href: "/dashboard/whitelabel", label: "White-label Portal", icon: Globe },
            { href: "/dashboard/marketing", label: "Marketing Studio", icon: Megaphone }
          ]
        } satisfies NavGroup
      ]
    : []),
  { heading: "Reports", items: insightItems },
  { heading: "Account", items: accountItems }
];

export const navByRole: Record<Role, NavGroup[]> = {
  "master-admin": adminGroups(masterMoneyDesk, [
    { href: "/dashboard/admin/admins", label: "Admin Team", icon: ShieldCheck }
  ]),

  admin: adminGroups(adminMoneyDesk),

  "sub-admin": adminGroups(adminMoneyDesk),

  retailer: [
    {
      heading: "Home",
      items: [
        { href: "/dashboard", label: "Home", icon: LayoutDashboard },
        { href: "/dashboard/earnings", label: "My Earnings", icon: CircleDollarSign },
        { href: "/dashboard/my-scheme", label: "My Pricing Plan", icon: Layers }
      ]
    },
    { heading: "Money In", items: moneyInServices },
    { heading: "Money Out", items: moneyOutServices },
    { heading: "Bill Payments", items: billPayServices },
    {
      heading: "Wallet",
      items: [
        { href: "/dashboard/wallet", label: "My Wallet", icon: Wallet },
        { href: "/dashboard/funds-request", label: "Add Funds", icon: HandCoins },
        { href: "/dashboard/ledger", label: "Wallet Ledger", icon: BookOpenCheck }
      ]
    },
    { heading: "Reports", items: insightItems },
    { heading: "Account", items: accountItems }
  ],

  distributor: networkGroups({
    directoryLabel: "My Retailers",
    onboardLabel: "Add Retailer",
    commissionLabel: "Commission Grid"
  }),

  "master-distributor": networkGroups({
    directoryLabel: "My Distributors",
    onboardLabel: "Add Distributor",
    commissionLabel: "Commission Structure",
    platform: true
  }),

  "super-distributor": networkGroups({
    directoryLabel: "My Network",
    onboardLabel: "Add Master Distributor",
    commissionLabel: "Commission Structure",
    platform: true
  }),

  finance: [
    {
      heading: "Finance Desk",
      items: [
        { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
        { href: "/dashboard/admin/wallet-ops", label: "Wallet Balances", icon: Wallet },
        { href: "/dashboard/admin/ledger", label: "Ledger Explorer", icon: BookOpenCheck },
        // "Company Earnings" (Revenue Wallet) is owner-only; finance uses the
        // Commission Payouts + Per-Txn Earnings reports instead.
        { href: "/dashboard/admin/commission-report", label: "Commission Payouts", icon: HandCoins },
        { href: "/dashboard/admin/earnings", label: "Per-Txn Earnings", icon: TrendingUp },
        { href: "/dashboard/admin/analytics", label: "Business Analytics", icon: LineChart },
        { href: "/dashboard/reports", label: "Reports Studio", icon: BarChart3 }
      ]
    },
    { heading: "Account", items: staffAccountItems }
  ]
};
