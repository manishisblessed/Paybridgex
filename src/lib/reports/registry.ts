/**
 * Client-facing report registry.
 *
 * Drives the reports hub grid, the per-report page (columns + filters + KPIs)
 * and the CSV/PDF/XLSX export column definitions. Kept declarative so adding a
 * report is a single entry here plus a query function in server.ts.
 */
import {
  BarChart3,
  HandCoins,
  CreditCard,
  Landmark,
  Receipt,
  ReceiptText,
  QrCode,
  Monitor,
  Banknote,
  CircleDollarSign,
  BookText,
  CalendarClock,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { ReportType, ReportFieldFormat } from "./types";

export type Accent = "brand" | "accent" | "emerald" | "violet";

export type ReportColumnDef = {
  key: string;
  header: string;
  format?: ReportFieldFormat;
  align?: "left" | "right" | "center";
};

export type FilterOption = { value: string; label: string };

export type ReportFilterConfig = {
  search?: string; // placeholder; presence enables the search box
  dateRange?: boolean;
  status?: { label: string; options: FilterOption[] };
  service?: { label: string; options: FilterOption[] };
  mode?: { label: string; options: FilterOption[] };
};

export type ReportConfig = {
  type: ReportType;
  title: string;
  short: string;
  description: string;
  icon: LucideIcon;
  accent: Accent;
  columns: ReportColumnDef[];
  filters: ReportFilterConfig;
};

/* ------- option helpers --------------------------------------------- */

const ACRONYMS = new Set([
  "AEPS", "DMT", "UPI", "DTH", "PAN", "GST", "IMPS", "NEFT", "RTGS",
  "POS", "QR", "PG", "BBPS", "ID",
]);
function humanize(code: string): string {
  return code
    .split("_")
    .map((w) => (ACRONYMS.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(" ");
}
const opts = (values: string[]): FilterOption[] =>
  values.map((v) => ({ value: v, label: humanize(v) }));

const TXN_STATUS = ["INITIATED", "PROCESSING", "SUCCESS", "FAILED", "REFUNDED", "HOLD"];
const PAYOUT_STATUS = [
  "DRAFT", "PENDING_APPROVAL", "APPROVED", "PROCESSING", "SUCCESS", "FAILED", "REJECTED", "REVERSED",
];
const FUND_STATUS = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"];
const FUND_MODE = ["UTR", "UPI", "CASH"];
const PAYOUT_MODE = ["IMPS", "NEFT", "RTGS", "UPI"];
const POS_STATUS = ["active", "inactive", "maintenance", "decommissioned"];
const WALLET_REASON = [
  "TOPUP", "WITHDRAW", "TRANSACTION", "COMMISSION", "REVERSAL", "ADJUSTMENT",
  "FUND_TRANSFER_IN", "FUND_TRANSFER_OUT", "FEE", "PENALTY", "PAYOUT",
];
const SERVICE_CODES = [
  "AEPS_WITHDRAW", "AEPS_BALANCE", "AEPS_MINI_STMT", "DMT_IMPS", "DMT_NEFT", "DMT_RTGS",
  "UPI_COLLECT", "UPI_PAYOUT", "WALLET_TOPUP", "WALLET_WITHDRAW",
  "RECHARGE_MOBILE", "RECHARGE_DTH", "RECHARGE_BROADBAND",
  "BILL_ELECTRICITY", "BILL_WATER", "BILL_GAS", "BILL_CREDIT_CARD", "BILL_EDUCATION", "BILL_INSURANCE",
  "TRAVEL_FLIGHT", "TRAVEL_HOTEL", "TRAVEL_BUS", "TRAVEL_TRAIN", "PAN_CARD", "INSURANCE", "POS",
];
/** Bill-payment service codes (BBPS categories + broadband), shared with the query layer. */
export const BILL_SERVICE_CODES = [
  "BILL_ELECTRICITY", "BILL_WATER", "BILL_GAS", "BILL_CREDIT_CARD",
  "BILL_EDUCATION", "BILL_INSURANCE", "RECHARGE_BROADBAND",
];
const NETWORK_ROLES = [
  "RETAILER", "DISTRIBUTOR", "MASTER_DISTRIBUTOR", "SUPER_DISTRIBUTOR",
];

/* ------- registry ---------------------------------------------------- */

export const REPORTS: Record<ReportType, ReportConfig> = {
  "daily-user": {
    type: "daily-user",
    title: "Daily User Report",
    short: "Daily User Report",
    description:
      "Per-user daily activity on the Primary wallet: opening, credits by reason, service-wise debits & commission, closing. Reconciles against the ledger.",
    icon: CalendarClock,
    accent: "brand",
    columns: [
      { key: "code", header: "User ID", format: "mono" },
      { key: "name", header: "Name" },
      { key: "role", header: "Role", format: "badge" },
      { key: "opening", header: "Opening", format: "money", align: "right" },
      { key: "creditsTotal", header: "Credits", format: "money", align: "right" },
      { key: "topup", header: "Top-up", format: "money", align: "right" },
      { key: "commissionEarned", header: "Commission", format: "money", align: "right" },
      { key: "debitsTotal", header: "Debits", format: "money", align: "right" },
      { key: "servicesUsed", header: "Services used", format: "text" },
      { key: "closing", header: "Closing", format: "money", align: "right" },
    ],
    filters: {
      dateRange: true,
      search: "Search name / ID / shop…",
      status: { label: "Role", options: opts(NETWORK_ROLES) },
      service: { label: "Service used", options: opts(SERVICE_CODES) },
    },
  },

  summary: {
    type: "summary",
    title: "Summary Report",
    short: "Summary",
    description: "Service-wise turnover, success rates and commission across your network.",
    icon: BarChart3,
    accent: "brand",
    columns: [
      { key: "service", header: "Service" },
      { key: "txns", header: "Txns", format: "int", align: "right" },
      { key: "success", header: "Success", format: "int", align: "right" },
      { key: "failed", header: "Failed", format: "int", align: "right" },
      { key: "successRate", header: "Success %", format: "percent", align: "right" },
      { key: "gross", header: "Turnover", format: "money", align: "right" },
      { key: "fee", header: "Fees", format: "money", align: "right" },
      { key: "commission", header: "Commission", format: "money", align: "right" },
    ],
    filters: { dateRange: true, service: { label: "Service", options: opts(SERVICE_CODES) } },
  },

  fund: {
    type: "fund",
    title: "Fund Report",
    short: "Fund",
    description: "Wallet top-up / fund requests raised across your network with approval status.",
    icon: HandCoins,
    accent: "violet",
    columns: [
      { key: "date", header: "Date", format: "datetime" },
      { key: "requester", header: "Requester" },
      { key: "amount", header: "Amount", format: "money", align: "right" },
      { key: "mode", header: "Mode" },
      { key: "utr", header: "UTR", format: "mono" },
      { key: "bankName", header: "Bank" },
      { key: "status", header: "Status", format: "badge" },
    ],
    filters: {
      dateRange: true,
      search: "Search UTR, bank, requester…",
      status: { label: "Status", options: opts(FUND_STATUS) },
      mode: { label: "Mode", options: opts(FUND_MODE) },
    },
  },

  pg: {
    type: "pg",
    title: "Payment Gateway Report",
    short: "Payment Gateway",
    description: "Online collections via Razorpay / UPI collect, with fees and success rate.",
    icon: CreditCard,
    accent: "emerald",
    columns: [
      { key: "date", header: "Date", format: "datetime" },
      { key: "refId", header: "Txn ID", format: "mono" },
      { key: "partner", header: "Gateway" },
      { key: "service", header: "Mode" },
      { key: "customer", header: "Customer" },
      { key: "amount", header: "Amount", format: "money", align: "right" },
      { key: "fee", header: "Fee", format: "money", align: "right" },
      { key: "status", header: "Status", format: "badge" },
    ],
    filters: {
      dateRange: true,
      search: "Search txn / customer…",
      status: { label: "Status", options: opts(TXN_STATUS) },
    },
  },

  payout: {
    type: "payout",
    title: "Payout Report",
    short: "Payout",
    description: "Bank / UPI disbursals via BulkPe with service charge, GST and settlement UTR.",
    icon: Landmark,
    accent: "accent",
    columns: [
      { key: "date", header: "Date", format: "datetime" },
      { key: "beneficiaryName", header: "Beneficiary" },
      { key: "accountLast4", header: "Account", format: "mono" },
      { key: "mode", header: "Mode" },
      { key: "amount", header: "Amount", format: "money", align: "right" },
      { key: "serviceCharge", header: "Charge", format: "money", align: "right" },
      { key: "gst", header: "GST", format: "money", align: "right" },
      { key: "totalDebit", header: "Total debit", format: "money", align: "right" },
      { key: "status", header: "Status", format: "badge" },
      { key: "utr", header: "UTR", format: "mono" },
    ],
    filters: {
      dateRange: true,
      search: "Search beneficiary / UTR…",
      status: { label: "Status", options: opts(PAYOUT_STATUS) },
      mode: { label: "Mode", options: opts(PAYOUT_MODE) },
    },
  },

  "bill-payment": {
    type: "bill-payment",
    title: "Bill Payment Report",
    short: "Bill Payment",
    description:
      "Line-item BBPS bill payments (electricity, water, gas, credit-card, education, insurance, broadband) with charge, GST, total debit and provider reference for full traceability.",
    icon: ReceiptText,
    accent: "accent",
    columns: [
      { key: "sno", header: "S.No" },
      { key: "retailerId", header: "Retailer ID", format: "mono" },
      { key: "refId", header: "Transaction ID", format: "mono" },
      { key: "operator", header: "Operator / Provider" },
      { key: "bankName", header: "Bank" },
      { key: "bankLogo", header: "Logo", format: "avatar", align: "center" },
      { key: "customerName", header: "Customer" },
      { key: "card", header: "Card No.", format: "mono" },
      { key: "mobile", header: "Mobile", format: "mono" },
      { key: "charge", header: "Charge", format: "money", align: "right" },
      { key: "gst", header: "GST", format: "money", align: "right" },
      { key: "totalDebit", header: "Total Debit", format: "money", align: "right" },
      { key: "referenceNo", header: "Reference No", format: "mono" },
      { key: "status", header: "Status", format: "badge" },
    ],
    filters: {
      dateRange: true,
      search: "Search txn / ref / retailer / bank…",
      status: { label: "Status", options: opts(TXN_STATUS) },
      service: { label: "Bill type", options: opts(BILL_SERVICE_CODES) },
    },
  },

  "credit-card": {
    type: "credit-card",
    title: "Credit Card Report",
    short: "Credit Card",
    description: "Credit-card bill payments routed via NEFT / IMPS, with fees and commission.",
    icon: Receipt,
    accent: "brand",
    columns: [
      { key: "sno", header: "S.No" },
      { key: "retailerId", header: "Retailer ID", format: "mono" },
      { key: "refId", header: "Transaction ID", format: "mono" },
      { key: "operator", header: "Operator / Provider" },
      { key: "bankName", header: "Bank" },
      { key: "bankLogo", header: "Logo", format: "avatar", align: "center" },
      { key: "customerName", header: "Customer" },
      { key: "card", header: "Card No.", format: "mono" },
      { key: "mobile", header: "Mobile", format: "mono" },
      { key: "charge", header: "Charge", format: "money", align: "right" },
      { key: "gst", header: "GST", format: "money", align: "right" },
      { key: "totalDebit", header: "Total Debit", format: "money", align: "right" },
      { key: "referenceNo", header: "Reference No", format: "mono" },
      { key: "status", header: "Status", format: "badge" },
    ],
    filters: {
      dateRange: true,
      search: "Search txn / ref / retailer / card / bank…",
      status: { label: "Status", options: opts(TXN_STATUS) },
    },
  },

  qr: {
    type: "qr",
    title: "QR Codes Report",
    short: "QR Codes",
    description: "Static & dynamic UPI QR collections per outlet (source pending a later phase).",
    icon: QrCode,
    accent: "violet",
    columns: [
      { key: "id", header: "QR ID", format: "mono" },
      { key: "label", header: "Label" },
      { key: "type", header: "Type" },
      { key: "vpa", header: "UPI VPA", format: "mono" },
      { key: "payments", header: "Payments", format: "int", align: "right" },
      { key: "collected", header: "Collected", format: "money", align: "right" },
      { key: "status", header: "Status", format: "badge" },
    ],
    filters: { dateRange: true, search: "Search QR / VPA…" },
  },

  pos: {
    type: "pos",
    title: "POS Machines Report",
    short: "POS Machines",
    description: "Physical terminals assigned across your network with status and location.",
    icon: Monitor,
    accent: "emerald",
    columns: [
      { key: "tid", header: "TID", format: "mono" },
      { key: "mid", header: "MID", format: "mono" },
      { key: "serial", header: "Serial", format: "mono" },
      { key: "model", header: "Model" },
      { key: "provider", header: "Provider" },
      { key: "status", header: "Status", format: "badge" },
      { key: "assignee", header: "Assigned to" },
      { key: "location", header: "Location" },
      { key: "assignedAt", header: "Assigned on", format: "date" },
    ],
    filters: {
      search: "Search TID / MID / serial…",
      status: { label: "Status", options: opts(POS_STATUS) },
    },
  },

  "wallet-settlement": {
    type: "wallet-settlement",
    title: "Wallet Settlement Report",
    short: "Wallet Settlement",
    description: "Daily settlement of successful transactions into your wallet (T+1 cycle).",
    icon: Banknote,
    accent: "accent",
    columns: [
      { key: "date", header: "Settlement date", format: "date" },
      { key: "cycle", header: "Cycle" },
      { key: "txns", header: "Txns", format: "int", align: "right" },
      { key: "gross", header: "Gross", format: "money", align: "right" },
      { key: "fee", header: "Fees", format: "money", align: "right" },
      { key: "gst", header: "GST", format: "money", align: "right" },
      { key: "net", header: "Net settled", format: "money", align: "right" },
      { key: "status", header: "Status", format: "badge" },
    ],
    filters: { dateRange: true },
  },

  commission: {
    type: "commission",
    title: "Commission Report",
    short: "Commission",
    description: "Commission credited to wallets across your network, from the ledger.",
    icon: CircleDollarSign,
    accent: "emerald",
    columns: [
      { key: "date", header: "Date", format: "datetime" },
      { key: "user", header: "Earned by" },
      { key: "amount", header: "Commission", format: "money", align: "right" },
      { key: "balanceAfter", header: "Balance after", format: "money", align: "right" },
      { key: "refType", header: "Source" },
      { key: "refId", header: "Reference", format: "mono" },
      { key: "note", header: "Note" },
    ],
    filters: { dateRange: true, search: "Search note / reference…" },
  },

  tds: {
    type: "tds",
    title: "TDS Report (194H)",
    short: "TDS (194H)",
    description:
      "Section 194H TDS withheld on commissions, per deductee (PAN-wise). Set the date range to a quarter and export for Form 26Q filing.",
    icon: ShieldCheck,
    accent: "accent",
    columns: [
      { key: "deductee", header: "Deductee" },
      { key: "code", header: "User ID", format: "mono" },
      { key: "pan", header: "PAN", format: "mono" },
      { key: "role", header: "Role", format: "badge" },
      { key: "section", header: "Section", format: "mono" },
      { key: "deductions", header: "Deductions", format: "int", align: "right" },
      { key: "gross", header: "Gross commission", format: "money", align: "right" },
      { key: "tds", header: "TDS withheld", format: "money", align: "right" },
    ],
    filters: {
      dateRange: true,
      search: "Search deductee / PAN / ID…",
      service: { label: "Service", options: opts(SERVICE_CODES) },
    },
  },

  account: {
    type: "account",
    title: "Account Report",
    short: "Account (Passbook)",
    description: "Full wallet passbook from the ledger with running balance after each entry.",
    icon: BookText,
    accent: "brand",
    columns: [
      { key: "date", header: "Date", format: "datetime" },
      { key: "direction", header: "Type", format: "badge" },
      { key: "reason", header: "Reason", format: "badge" },
      { key: "amount", header: "Amount", format: "money", align: "right" },
      { key: "balanceAfter", header: "Balance after", format: "money", align: "right" },
      { key: "refType", header: "Source" },
      { key: "refId", header: "Reference", format: "mono" },
      { key: "note", header: "Note" },
    ],
    filters: {
      dateRange: true,
      search: "Search note / reference…",
      status: { label: "Direction", options: opts(["CREDIT", "DEBIT"]) },
      service: { label: "Reason", options: opts(WALLET_REASON) },
    },
  },
};

/** Ordered list for the hub grid. */
export const REPORT_LIST: ReportConfig[] = Object.values(REPORTS);
