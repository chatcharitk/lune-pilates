// No-DB unit tests for the admin Sales history + CSV export (Group D #1): the pure
// CSV escaping/column order, the date-range bounds, and the no-DB listSales shape.
// The owner-gate + live data are covered by the route handler / integration paths.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { csvCell, salesRowsToCsv } from "@/lib/admin/csv";
import { rangeBounds } from "@/lib/admin/period";
import { listSales, type SalesRow } from "@/lib/admin/sales";

describe("csvCell (RFC 4180 escaping)", () => {
  it("passes plain values through verbatim", () => {
    expect(csvCell("abc")).toBe("abc");
    expect(csvCell(2950)).toBe("2950");
  });
  it("quotes + doubles internal quotes", () => {
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
  });
  it("quotes values with a comma or newline", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });
  it("passes Thai text through unquoted (no special chars)", () => {
    expect(csvCell("พิม ศรีใส")).toBe("พิม ศรีใส");
  });
  it("renders null/undefined as an empty cell", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
  it("neutralises formula-injection (leading = + - @) with a quote prefix", () => {
    expect(csvCell("=cmd()")).toBe("\"'=cmd()\"");
    expect(csvCell("@SUM(A1)")).toBe("\"'@SUM(A1)\"");
    expect(csvCell("+1")).toBe("\"'+1\"");
  });
});

describe("salesRowsToCsv (header + columns)", () => {
  const row = (over: Partial<SalesRow>): SalesRow => ({
    id: "c1",
    when: "2026-06-20T09:12:00.000Z",
    whenDisplay: "09:12",
    customerName: "พิม ศรีใส",
    customerId: "u1",
    packageLabel: { en: "10 hours", th: "10 ชั่วโมง" },
    packageId: "p10",
    method: "promptpay",
    amount: 5500,
    status: "paid",
    ...over,
  });

  it("emits the fixed header first", () => {
    const csv = salesRowsToCsv([row({})], "en");
    expect(csv.split("\r\n")[0]).toBe("Date,Customer,Package,Method,Amount,Status");
  });
  it("includes a Thai customer name + integer amount with no separators", () => {
    const csv = salesRowsToCsv([row({ amount: 12000 })], "en");
    const line = csv.split("\r\n")[1]!;
    expect(line).toContain("พิม ศรีใส");
    expect(line).toContain(",12000,"); // no thousands separator, no ฿
    expect(line).toContain("10 hours"); // en label
  });
  it("selects the package label by lang", () => {
    const csv = salesRowsToCsv([row({})], "th");
    expect(csv.split("\r\n")[1]).toContain("10 ชั่วโมง");
  });
});

describe("rangeBounds (half-open [start, end), end inclusive day)", () => {
  it("spans the given days with an exclusive end = endDay + 1", () => {
    const { start, end } = rangeBounds("2026-06-01", "2026-06-15");
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(5); // June
    expect(start.getDate()).toBe(1);
    expect(end.getMonth()).toBe(5);
    expect(end.getDate()).toBe(16); // 15th inclusive → 16th 00:00 exclusive
  });
  it("defaults to first-of-month → tomorrow when unset", () => {
    const now = new Date(2026, 5, 20, 14, 30);
    const { start, end } = rangeBounds(undefined, undefined, now);
    expect(start.getDate()).toBe(1);
    expect(start.getMonth()).toBe(5);
    expect(end.getDate()).toBe(21); // today (20th) inclusive → 21st exclusive
  });
});

describe("listSales (no-DB)", () => {
  const ORIGINAL_DB_URL = process.env.DATABASE_URL;
  beforeEach(() => delete process.env.DATABASE_URL);
  afterEach(() => {
    if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL_DB_URL;
  });

  it("returns mock rows, newest-first, with integer amounts", async () => {
    const rows = await listSales({ start: new Date("2000-01-01"), end: new Date("2100-01-01") });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(Number.isInteger(r.amount)).toBe(true);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.when >= rows[i]!.when).toBe(true);
    }
  });
});
