// No-DB unit tests for the admin Sales history + CSV export (Group D #1): the pure
// CSV escaping/column order, the date-range bounds, and the no-DB listSales shape.
// The owner-gate + live data are covered by the route handler / integration paths.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { csvCell, salesRowsToCsv } from "@/lib/admin/csv";
import {
  monthBounds,
  presetRange,
  rangeBounds,
  todayBounds,
  weekBounds,
  yearBounds,
} from "@/lib/admin/period";
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

describe("sales preset range helpers (pure, half-open [start, end))", () => {
  // A fixed Wednesday for deterministic week math.
  const wed = new Date(2026, 5, 24, 14, 30); // 2026-06-24 is a Wednesday

  it("todayBounds is [00:00 today, 00:00 tomorrow)", () => {
    const { start, end } = todayBounds(wed);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(5);
    expect(start.getDate()).toBe(24);
    expect(start.getHours()).toBe(0);
    expect(end.getDate()).toBe(25);
    expect(end.getHours()).toBe(0);
  });

  it("weekBounds spans Monday → next Monday (Mon-first)", () => {
    const { start, end } = weekBounds(wed);
    // Monday of the week containing Wed 2026-06-24 is 2026-06-22.
    expect(start.getDate()).toBe(22);
    expect(start.getDay()).toBe(1); // Monday
    expect(start.getHours()).toBe(0);
    // Next Monday = 2026-06-29 (exclusive).
    expect(end.getDate()).toBe(29);
    expect(end.getDay()).toBe(1);
    // Exactly 7 days wide.
    expect((end.getTime() - start.getTime()) / (24 * 3_600_000)).toBe(7);
  });

  it("weekBounds treats a Sunday as the LAST day of its Mon-first week", () => {
    const sun = new Date(2026, 5, 28, 9, 0); // 2026-06-28 is a Sunday
    const { start, end } = weekBounds(sun);
    expect(start.getDate()).toBe(22); // still that Monday
    expect(end.getDate()).toBe(29); // next Monday
  });

  it("monthBounds = first-of-month → first-of-next-month", () => {
    const { start, end } = monthBounds(wed);
    expect(start.getDate()).toBe(1);
    expect(start.getMonth()).toBe(5); // June
    expect(end.getDate()).toBe(1);
    expect(end.getMonth()).toBe(6); // July
  });

  it("yearBounds = Jan 1 → next-year Jan 1", () => {
    const { start, end } = yearBounds(wed);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(0);
    expect(start.getDate()).toBe(1);
    expect(end.getFullYear()).toBe(2027);
    expect(end.getMonth()).toBe(0);
    expect(end.getDate()).toBe(1);
  });

  it("presetRange returns matching yyyy-mm-dd from/to strings (inclusive end day)", () => {
    expect(presetRange("today", wed)).toMatchObject({
      preset: "today",
      fromDay: "2026-06-24",
      toDay: "2026-06-24",
    });
    expect(presetRange("week", wed)).toMatchObject({
      preset: "week",
      fromDay: "2026-06-22",
      toDay: "2026-06-28", // inclusive last day = Sunday (end is next Monday, exclusive)
    });
    expect(presetRange("month", wed)).toMatchObject({
      preset: "month",
      fromDay: "2026-06-01",
      toDay: "2026-06-30",
    });
    expect(presetRange("year", wed)).toMatchObject({
      preset: "year",
      fromDay: "2026-01-01",
      toDay: "2026-12-31",
    });
  });

  it("presetRange from/to round-trips back through rangeBounds", () => {
    const p = presetRange("month", wed);
    const rt = rangeBounds(p.fromDay, p.toDay, wed);
    expect(rt.start.getTime()).toBe(p.start.getTime());
    expect(rt.end.getTime()).toBe(p.end.getTime());
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
