// CSV serialisation for the admin sales export (Group D #1). Pure + unit-testable:
// no I/O, no DB, no auth — it turns already-shaped SalesRow records into RFC 4180
// CSV text. The route handler (app/api/admin/sales/export/route.ts) owns the
// auth gate, the date-range parsing, and the BOM/headers; this module owns ONLY
// the escaping and the column order so both are pinned by a unit test.
//
// RFC 4180: fields are comma-separated, rows are CRLF-separated, and a field is
// wrapped in double quotes (with any internal double quote doubled) iff it
// contains a comma, a double quote, a CR, or an LF. We always emit CRLF row
// endings so Excel on every platform renders the rows correctly.

import type { Lang } from "@/lib/i18n";
import type { SalesRow } from "./sales";

/** RFC 4180 row terminator. */
const CRLF = "\r\n";

/**
 * Escape one CSV cell per RFC 4180. The value is stringified, then wrapped in
 * double quotes — with every internal `"` doubled — IFF it contains a comma, a
 * double quote, a CR, or an LF. Plain values (including Thai text, which carries
 * none of those special characters) pass through verbatim. Numbers/booleans are
 * coerced via String(); null/undefined become an empty cell.
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  // CSV/formula-injection guard: a value starting with = + - @ (or a tab/CR) can be
  // executed as a formula by Excel/Sheets when the file is opened. Neutralise it by
  // prefixing a single quote, then force-quote the cell. (A customer name like
  // "=cmd()" is the realistic vector — names flow straight into this export.)
  const isFormula = /^[=+\-@\t\r]/.test(s);
  if (isFormula) s = `'${s}`;
  if (isFormula || /[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** The export columns, in order. EN headers (the file is an English data export). */
const COLUMNS = ["Date", "Customer", "Package", "Method", "Amount", "Status"] as const;

/**
 * Serialise sales rows to an RFC 4180 CSV string: a header line followed by one
 * line per row, all CRLF-joined (no trailing newline). Columns IN ORDER:
 *   - Date    → `row.when` (the ISO 8601 instant; the route may localise display
 *               separately, but the export carries the precise timestamp);
 *   - Customer→ `row.customerName`;
 *   - Package → `row.packageLabel.en` (the catalog label in the export language);
 *   - Method  → `row.method` ("promptpay" | "cash");
 *   - Amount  → the integer THB amount, with NO thousands separators and NO `฿`
 *               symbol (a clean numeric column a spreadsheet can sum);
 *   - Status  → `row.status` ("paid" | "pending" | "awaiting_review" | "rejected").
 *
 * `lang` selects the package label language (en|th); every other column is a raw
 * data value, not user copy. Money stays an integer the whole way — never a float
 * and never reformatted with grouping (CLAUDE.md §8).
 */
export function salesRowsToCsv(rows: readonly SalesRow[], lang: Lang): string {
  const header = COLUMNS.map(csvCell).join(",");
  const body = rows.map((r) =>
    [
      csvCell(r.when),
      csvCell(r.customerName),
      csvCell(r.packageLabel[lang] ?? r.packageLabel.en),
      csvCell(r.method),
      csvCell(r.amount),
      csvCell(r.status),
    ].join(","),
  );
  return [header, ...body].join(CRLF);
}
