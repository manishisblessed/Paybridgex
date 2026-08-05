/**
 * Shared report contracts used by both the server query layer
 * (src/lib/reports/server.ts) and the client (registry + ReportView).
 *
 * Keep this file free of any server-only or client-only imports so it can be
 * shared across the API route and the dashboard UI without leaking bundles.
 */

/** Machine slugs for every data-backed report. Order drives the hub grid. */
export const REPORT_TYPES = [
  "daily-user",
  "summary",
  "fund",
  "pg",
  "payout",
  "bill-payment",
  "credit-card",
  "qr",
  "pos",
  "wallet-settlement",
  "commission",
  "tds",
  "account",
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export function isReportType(value: string): value is ReportType {
  return (REPORT_TYPES as readonly string[]).includes(value);
}

/** How a column value is formatted in the table / exports. */
export type ReportFieldFormat =
  | "text"
  | "mono"
  | "money"
  | "int"
  | "percent"
  | "date"
  | "datetime"
  | "badge"
  /** Bank / operator logo: renders an <img> when the value is a URL, else an initials chip. */
  | "avatar";

/** Normalised query parameters every report query accepts. */
export type ReportParams = {
  from: Date | null;
  to: Date | null;
  page: number;
  pageSize: number;
  q: string | null;
  status: string | null;
  service: string | null;
  mode: string | null;
  /** When true, return the full (capped) dataset for CSV/PDF/XLSX export. */
  forExport: boolean;
};

/** One headline KPI card rendered above the report table. */
export type ReportSummaryStat = {
  label: string;
  value: string;
  accent?: "brand" | "accent" | "emerald" | "violet";
};

/** A ready-to-plot sparkline series. */
export type ReportTrend = {
  label: string;
  color: string;
  values: number[];
};

/** The shape returned by every report query and the API route. */
export type ReportResult = {
  rows: Record<string, unknown>[];
  /** Total matching records (drives pagination). */
  total: number;
  page: number;
  pageSize: number;
  /**
   * Totals row keyed by column key. Money/number columns carry numeric
   * aggregates; a single label column carries the word "Total".
   */
  totals: Record<string, number | string | null>;
  summary: ReportSummaryStat[];
  trend: ReportTrend | null;
  /** Non-null when a report's source model is not yet implemented. */
  note: string | null;
};

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
/** Hard cap on rows pulled for an export so a huge range can't OOM the box. */
export const EXPORT_ROW_CAP = 5000;
