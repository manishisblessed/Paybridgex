"use client";

import type { ReactNode } from "react";

/* ----------------------------------------------------------------------- */
/*  Column descriptor for exports                                           */
/* ----------------------------------------------------------------------- */

export type ReportColumn<T> = {
  /** Object key used as a fallback when no `render` is supplied. */
  key: keyof T | string;
  /** Display header in CSV / PDF / preview. */
  header: string;
  /** Cell renderer — should return a primitive serialisable value. */
  render?: (row: T) => ReactNode;
  /**
   * Optional value semantics. Drives right-alignment + native numeric cells
   * (with a number format) in the XLSX export. Purely additive — columns
   * without a `format` keep the previous string-based behaviour everywhere.
   */
  format?: "text" | "money" | "int" | "number" | "date" | "datetime";
};

/* ----------------------------------------------------------------------- */
/*  Cell stringification                                                    */
/* ----------------------------------------------------------------------- */

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function cellValue<T>(col: ReportColumn<T>, row: T): string {
  const raw = col.render
    ? col.render(row)
    : (row as Record<string, unknown>)[String(col.key)];
  return stringify(raw);
}

/* ----------------------------------------------------------------------- */
/*  CSV                                                                     */
/* ----------------------------------------------------------------------- */

function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCSV<T>(rows: T[], columns: ReportColumn<T>[]): string {
  const header = columns.map((c) => csvEscape(c.header)).join(",");
  const body = rows
    .map((row) =>
      columns.map((c) => csvEscape(cellValue(c, row))).join(",")
    )
    .join("\n");
  return `${header}\n${body}`;
}

export function downloadCSV<T>(
  filename: string,
  rows: T[],
  columns: ReportColumn<T>[]
) {
  if (typeof window === "undefined") return;
  const csv = toCSV(rows, columns);
  const blob = new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8;"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ----------------------------------------------------------------------- */
/*  PDF (via browser print dialog)                                          */
/* ----------------------------------------------------------------------- */

export function downloadPDF<T>(
  title: string,
  rows: T[],
  columns: ReportColumn<T>[],
  meta?: { generatedFor?: string; subtitle?: string }
) {
  if (typeof window === "undefined") return;

  const win = window.open("", "_blank", "width=1024,height=768");
  if (!win) {
    alert(
      "Please allow pop-ups to download the PDF report. Falling back to CSV."
    );
    return;
  }

  const generatedAt = new Date().toLocaleString("en-IN");
  const totalRows = rows.length;

  const head = columns
    .map(
      (c) =>
        `<th style="text-align:left;padding:8px 10px;border-bottom:1px solid #d8dde5;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#5a6675;">${escapeHtml(
          c.header
        )}</th>`
    )
    .join("");

  const body = rows
    .map(
      (row) =>
        `<tr>${columns
          .map(
            (c) =>
              `<td style="padding:8px 10px;border-bottom:1px solid #eef0f4;font-size:12px;color:#1f2733;">${escapeHtml(
                cellValue(c, row)
              )}</td>`
          )
          .join("")}</tr>`
    )
    .join("");

  win.document.write(`<!doctype html>
<html><head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;color:#1f2733;margin:24px;}
  header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #185df5;padding-bottom:12px;margin-bottom:16px;}
  h1{font-size:20px;margin:0 0 4px;color:#0b1320;}
  .meta{font-size:11px;color:#5a6675;line-height:1.5;text-align:right;}
  .brand{font-weight:700;color:#185df5;font-size:12px;letter-spacing:.08em;text-transform:uppercase;}
  table{width:100%;border-collapse:collapse;}
  thead{background:#f4f6fa;}
  tfoot td{font-size:11px;color:#5a6675;padding-top:10px;}
  @media print {
    body{margin:12mm;}
    .noprint{display:none !important;}
  }
  .actions{margin:16px 0;display:flex;gap:8px;}
  .btn{font:inherit;border:1px solid #d8dde5;background:#fff;border-radius:8px;padding:6px 12px;cursor:pointer;}
  .btn.primary{background:#185df5;color:#fff;border-color:#185df5;}
</style>
</head>
<body>
  <header>
    <div>
      <p class="brand">JMP NEXTGENPAY PRIVATE LIMITED</p>
      <h1>${escapeHtml(title)}</h1>
      ${meta?.subtitle ? `<p style="margin:2px 0 0;font-size:12px;color:#5a6675;">${escapeHtml(meta.subtitle)}</p>` : ""}
    </div>
    <div class="meta">
      <div>Generated: ${escapeHtml(generatedAt)}</div>
      ${meta?.generatedFor ? `<div>For: ${escapeHtml(meta.generatedFor)}</div>` : ""}
      <div>${totalRows} record${totalRows === 1 ? "" : "s"}</div>
    </div>
  </header>

  <div class="actions noprint">
    <button class="btn primary" onclick="window.print()">Save as PDF / Print</button>
    <button class="btn" onclick="window.close()">Close</button>
  </div>

  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>${body || `<tr><td colspan="${columns.length}" style="padding:32px;text-align:center;color:#5a6675;">No records to display.</td></tr>`}</tbody>
  </table>

  <p style="margin-top:24px;font-size:10px;color:#94a0af;">
    This is a system-generated report from the JMP NextGenPay dashboard.
    Confidential — for internal use only.
  </p>
</body></html>`);

  win.document.close();
  win.focus();
}

/* ----------------------------------------------------------------------- */
/*  ZIP (CSV bundled in a zip archive via jszip — dynamically imported)      */
/* ----------------------------------------------------------------------- */

export async function downloadZIP<T>(
  filename: string,
  rows: T[],
  columns: ReportColumn<T>[]
) {
  if (typeof window === "undefined") return;

  const mod: any = await import("jszip");
  const JSZip = mod.default ?? mod;

  const zip = new JSZip();
  const csvContent = "\uFEFF" + toCSV(rows, columns);
  const baseName = filename.replace(/\.(zip|csv)$/i, "");
  zip.file(`${baseName}.csv`, csvContent);

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${baseName}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
