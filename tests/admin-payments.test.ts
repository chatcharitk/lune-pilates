// No-DB fallback + pure helpers for the admin "Payments & POS" read model
// (lib/admin/payments.ts). Runs without DATABASE_URL so it exercises the mock path
// the screen renders against, and pins:
//   - rows are newest-first and carry resolved bilingual catalog labels;
//   - the stat tiles roll up correctly (Σ paid, count paid, Σ pending, new members)
//     scoped to the current-month PERIOD;
//   - method/status normalisation fails safe;
//   - the period bounds are a clean [month start, next month start).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getPaymentsOverview,
  getPaymentsStats,
  listPayments,
  normaliseMethod,
  normaliseStatus,
  packageLabelFor,
  periodBounds,
  summarisePayments,
  whenDisplay,
  type PaymentRow,
} from "@/lib/admin/payments";

const ORIGINAL_DB_URL = process.env.DATABASE_URL;

beforeEach(() => {
  delete process.env.DATABASE_URL; // force the no-DB mock path
});
afterEach(() => {
  if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB_URL;
});

// Mid-month so all 5 mock payments (0..3 days ago) fall inside the same month.
const now = new Date("2026-06-22T12:00:00+07:00");

function row(over: Partial<PaymentRow>): PaymentRow {
  return {
    id: "x",
    customer: { userId: "u", name: "U" },
    packageLabel: { en: "x", th: "x" },
    packageId: "p10",
    amount: 100,
    method: "promptpay",
    when: now.toISOString(),
    whenDisplay: "now",
    status: "paid",
    hasSlip: false,
    reviewedAt: null,
    ...over,
  };
}

describe("summarisePayments (pure)", () => {
  it("sums paid revenue + counts sales, sums pending separately", () => {
    const stats = summarisePayments(
      [
        row({ status: "paid", amount: 5500 }),
        row({ status: "paid", amount: 7500 }),
        row({ status: "pending", amount: 2950 }),
      ],
      3,
    );
    expect(stats).toEqual({ revenuePaid: 13000, packageSales: 2, pending: 2950, newMembers: 3 });
  });

  it("empty rows yield zeros (new members still passed through)", () => {
    expect(summarisePayments([], 0)).toEqual({
      revenuePaid: 0,
      packageSales: 0,
      pending: 0,
      newMembers: 0,
    });
  });

  it("awaiting_review counts as pending (uncollected), rejected counts as neither", () => {
    const stats = summarisePayments(
      [
        row({ status: "paid", amount: 5500 }),
        row({ status: "pending", amount: 1000 }),
        row({ status: "awaiting_review", amount: 2950 }),
        row({ status: "rejected", amount: 9999 }),
      ],
      0,
    );
    // Revenue: only the paid row. Pending: pending + awaiting_review. Rejected: ignored.
    expect(stats).toEqual({ revenuePaid: 5500, packageSales: 1, pending: 3950, newMembers: 0 });
  });
});

describe("normalisers (pure, fail safe)", () => {
  it("method: only 'cash' is cash; anything else is promptpay", () => {
    expect(normaliseMethod("cash")).toBe("cash");
    expect(normaliseMethod("promptpay")).toBe("promptpay");
    expect(normaliseMethod("card")).toBe("promptpay");
    expect(normaliseMethod("")).toBe("promptpay");
  });

  it("status: maps the four known states; anything else fails safe to pending", () => {
    expect(normaliseStatus("paid")).toBe("paid");
    expect(normaliseStatus("pending")).toBe("pending");
    expect(normaliseStatus("awaiting_review")).toBe("awaiting_review");
    expect(normaliseStatus("rejected")).toBe("rejected");
    expect(normaliseStatus("expired")).toBe("pending");
    expect(normaliseStatus("")).toBe("pending");
  });
});

describe("packageLabelFor", () => {
  it("resolves a real catalog item's bilingual label", () => {
    expect(packageLabelFor("p10")).toEqual({ en: "10 hours", th: "10 ชั่วโมง" });
  });
  it("falls back to the raw id when the catalog has drifted", () => {
    expect(packageLabelFor("ghost")).toEqual({ en: "ghost", th: "ghost" });
  });
});

describe("periodBounds", () => {
  it("is [first-of-month 00:00, first-of-next-month 00:00)", () => {
    const { start, end } = periodBounds(new Date("2026-06-22T12:00:00"));
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(5); // June (0-based)
    expect(start.getDate()).toBe(1);
    expect(end.getMonth()).toBe(6); // July
    expect(end.getDate()).toBe(1);
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });
});

// Anchors use explicit-Z instants and assert Bangkok-pinned output, so they hold
// under both the default TZ and TZ=UTC (the time-of-day + day-bucketing are ICT).
describe("whenDisplay", () => {
  it("same Bangkok day → Bangkok HH:MM", () => {
    // 09:12 ICT and 18:00 ICT, both on 22 Jun (Bangkok).
    expect(
      whenDisplay(new Date("2026-06-22T02:12:00Z"), new Date("2026-06-22T11:00:00Z")),
    ).toBe("09:12");
  });
  it("prior Bangkok day → 'Yesterday'", () => {
    // 16:30 ICT 21 Jun vs 18:00 ICT 22 Jun.
    expect(
      whenDisplay(new Date("2026-06-21T09:30:00Z"), new Date("2026-06-22T11:00:00Z")),
    ).toBe("Yesterday");
  });
  it("earlier this year → 'D MMM'", () => {
    // 10:00 ICT 31 May.
    expect(
      whenDisplay(new Date("2026-05-31T03:00:00Z"), new Date("2026-06-22T11:00:00Z")),
    ).toBe("31 May");
  });
});

describe("listPayments (no-DB mock)", () => {
  it("returns the mock rows, newest first", async () => {
    const rows = await listPayments(now);
    expect(rows.length).toBe(7);
    // Strictly descending by `when`.
    const times = rows.map((r) => new Date(r.when).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("each row carries a resolved bilingual label + the raw packageId", async () => {
    const rows = await listPayments(now);
    const p15 = rows.find((r) => r.packageId === "p15")!;
    expect(p15.packageLabel).toEqual({ en: "15 hours", th: "15 ชั่วโมง" });
    expect(p15.amount).toBe(7500);
  });

  it("includes a cash row + a pending row (both tenders/states render)", async () => {
    const rows = await listPayments(now);
    expect(rows.some((r) => r.method === "cash")).toBe(true);
    expect(rows.some((r) => r.status === "pending")).toBe(true);
  });

  it("includes awaiting_review rows that carry a slip (Feature 3 verification queue)", async () => {
    const rows = await listPayments(now);
    const review = rows.filter((r) => r.status === "awaiting_review");
    expect(review.length).toBeGreaterThanOrEqual(2);
    expect(review.every((r) => r.hasSlip)).toBe(true);
  });
});

describe("getPaymentsStats (no-DB mock)", () => {
  it("rolls up the mock period: Σ paid, count paid, Σ pending, new members", async () => {
    const stats = await getPaymentsStats(now);
    // Paid mock amounts: 7500 + 5500 + 5500 + 650 = 19150 across 4 paid sales.
    expect(stats.revenuePaid).toBe(19150);
    expect(stats.packageSales).toBe(4);
    // Pending tile = pending (2950) + the two awaiting_review (5500 + 2950) = 11400.
    expect(stats.pending).toBe(11400);
    expect(stats.newMembers).toBe(3);
  });
});

describe("getPaymentsOverview (no-DB mock)", () => {
  it("returns stats + rows together", async () => {
    const overview = await getPaymentsOverview(now);
    expect(overview.rows.length).toBe(7);
    expect(overview.stats.packageSales).toBe(4);
  });
});
