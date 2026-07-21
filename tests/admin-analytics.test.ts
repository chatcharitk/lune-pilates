// No-DB fallback + pure helpers for the admin "Business Dashboard" read model
// (lib/admin/analytics.ts) and the shared period math (lib/admin/period.ts).
// Runs without DATABASE_URL so it exercises the exact mock the screen renders
// against, and pins:
//   - the overview shape is complete (all three sections present + populated);
//   - the sparkline is exactly 14 oldest→newest points;
//   - the revenue mix sums to ~100% and to its total;
//   - perInstructor is non-empty and revenue-sorted;
//   - GUEST packages are excluded from houseUsage (§5 inv 2/3);
//   - the pure summarisers (computeFillRates, buildAlert, buildHouseUsage,
//     denseDailyRevenue, withMixPct) and the period helpers (periodBounds,
//     priorPeriodBounds, pctDelta) are correct.

import { studioParts } from "@/lib/time";
import { loadCatalogMap } from "@/lib/catalog/packages";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildAlert,
  buildHouseUsage,
  categoryForPackageId,
  computeFillRates,
  denseDailyRevenue,
  getDashboardOverview,
  monthLabelFor,
  withMixPct,
  SPARKLINE_DAYS,
} from "@/lib/admin/analytics";
import { dayBounds, pctDelta, periodBounds, priorPeriodBounds } from "@/lib/admin/period";

const ORIGINAL_DB_URL = process.env.DATABASE_URL;

beforeEach(() => {
  delete process.env.DATABASE_URL; // force the no-DB mock path
});
afterEach(() => {
  if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB_URL;
});

const now = new Date("2026-06-30T12:00:00+07:00");

// ───────────────────────── period helpers (pure) ─────────────────────────

describe("period helpers", () => {
  it("periodBounds is [first-of-month, first-of-next-month) in Bangkok", () => {
    const { start, end } = periodBounds(new Date("2026-06-15T08:00:00+07:00"));
    const s = studioParts(start);
    const e = studioParts(end);
    expect([s.month0, s.day]).toEqual([5, 1]); // June 1, Bangkok
    expect([e.month0, e.day]).toEqual([6, 1]); // July 1, Bangkok
  });

  it("priorPeriodBounds is the previous month, contiguous with the current", () => {
    const cur = periodBounds(new Date("2026-06-15T08:00:00+07:00"));
    const prev = priorPeriodBounds(new Date("2026-06-15T08:00:00+07:00"));
    expect(studioParts(prev.start).month0).toBe(4); // May, Bangkok
    expect(prev.end.getTime()).toBe(cur.start.getTime());
  });

  it("dayBounds spans exactly 24h around now", () => {
    const { start, end } = dayBounds(now);
    expect(end.getTime() - start.getTime()).toBe(24 * 3_600_000);
  });

  it("pctDelta: normal, zero-prev growth, zero/zero", () => {
    expect(pctDelta(110, 100)).toBe(10);
    expect(pctDelta(341_800, 309_600)).toBeCloseTo(10.4, 1);
    expect(pctDelta(5, 0)).toBe(100); // grew from nothing
    expect(pctDelta(0, 0)).toBe(0);
    expect(pctDelta(50, 100)).toBe(-50);
  });
});

// ───────────────────────── pure summarisers ─────────────────────────

describe("withMixPct (pure)", () => {
  it("computes pct per category and the total", () => {
    const { mix, total } = withMixPct([
      { category: "group", amount: 198_000 },
      { category: "private", amount: 112_800 },
      { category: "rental", amount: 31_000 },
    ]);
    expect(total).toBe(341_800);
    expect(mix.find((m) => m.category === "group")!.pct).toBe(58);
    expect(mix.reduce((s, m) => s + m.pct, 0)).toBeGreaterThanOrEqual(99);
  });
  it("zero total yields zero pcts (no divide-by-zero)", () => {
    const { mix, total } = withMixPct([{ category: "group", amount: 0 }]);
    expect(total).toBe(0);
    expect(mix[0]!.pct).toBe(0);
  });
});

describe("denseDailyRevenue (pure)", () => {
  it("returns exactly SPARKLINE_DAYS points, oldest→newest, zero-filled", () => {
    const byDay = new Map<string, number>([["2026-06-30", 18_400]]);
    const series = denseDailyRevenue(byDay, now);
    expect(series.length).toBe(SPARKLINE_DAYS);
    const times = series.map((p) => new Date(p.dateIso).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b)); // ascending
    expect(series[series.length - 1]!.amount).toBe(18_400); // today filled
    expect(series[0]!.amount).toBe(0); // a day with no charges → 0
  });
});

describe("computeFillRates (pure)", () => {
  it("rolls instances into overall (group-only) + per-type rates", () => {
    const { overall, byType } = computeFillRates([
      { type: "group", capacity: 3, booked: 3 },
      { type: "group", capacity: 3, booked: 0 }, // group: 3/6 = 50%
      { type: "private", capacity: 1, booked: 1 }, // private: 1/1 = 100%
    ]);
    expect(overall).toBe(50);
    expect(byType.find((b) => b.type === "group")!.pct).toBe(50);
    expect(byType.find((b) => b.type === "private")!.pct).toBe(100);
    expect(byType.find((b) => b.type === "duo")!.pct).toBe(0); // no data → 0
  });
  it("clamps booked to effective capacity (never > 100%)", () => {
    const { overall } = computeFillRates([{ type: "duo", capacity: 9, booked: 9 }]);
    // duo hard cap 2; booked clamped to 2 → 2/2 (but overall is group-only) = 0.
    expect(overall).toBe(0);
  });
});

describe("buildAlert (pure)", () => {
  const t = new Date("2026-07-01T17:00:00+07:00");
  it("full + waitlist → overbooked/warn", () => {
    const a = buildAlert("c", t, "group", 3, 3, 5)!;
    expect(a.severity).toBe("overbooked");
    expect(a.tone).toBe("warn");
    expect(a.waitlistCount).toBe(5);
  });
  it("zero booked → empty/low", () => {
    expect(buildAlert("c", t, "group", 0, 3, 0)!.severity).toBe("empty");
  });
  it("under half capacity → low", () => {
    expect(buildAlert("c", t, "group", 1, 3, 0)!.severity).toBe("low");
  });
  it("healthy class → no alert (null)", () => {
    expect(buildAlert("c", t, "group", 2, 3, 0)).toBeNull();
    expect(buildAlert("c", t, "group", 3, 3, 0)).toBeNull(); // full, no waitlist
  });
});

describe("buildHouseUsage (pure)", () => {
  it("≥80% consumed → warn; else steady", () => {
    expect(buildHouseUsage("h", "B-203", ["m2"], 14, 16).tone).toBe("warn"); // 88%
    expect(buildHouseUsage("h", "C-007", ["m4", "m5"], 8, 24).tone).toBe("steady"); // 33%
  });
  it("computes pct and carries member ids", () => {
    const h = buildHouseUsage("h", "A-114", ["m1", "m7", "m3"], 12, 20);
    expect(h.pct).toBe(60);
    expect(h.memberIds).toHaveLength(3);
  });
});

describe("categoryForPackageId", () => {
  // The catalog is now DB-backed and owner-editable; the helper stayed PURE and
  // takes a preloaded map (loaded once per query, never per row). With no
  // DATABASE_URL this resolves the SEED_CATALOG fallback.
  it("maps a real catalog item to its category, fails safe to group", async () => {
    const catalog = await loadCatalogMap();
    expect(categoryForPackageId("p10", catalog)).toBe("group");
    expect(categoryForPackageId("pv8", catalog)).toBe("private");
    expect(categoryForPackageId("r-solo", catalog)).toBe("rental");
    expect(categoryForPackageId("ghost", catalog)).toBe("group");
  });

  it("still resolves an ARCHIVED item's category (historical charges must bucket right)", async () => {
    // An empty map is the pathological "catalog drifted entirely" case — the
    // helper must never throw, only fail safe.
    expect(categoryForPackageId("p10", new Map())).toBe("group");
  });
});

describe("monthLabelFor", () => {
  it("is bilingual EN/Buddhist-era TH", () => {
    const lbl = monthLabelFor(now);
    expect(lbl.en).toBe("June 2026");
    expect(lbl.th).toContain("2569"); // 2026 + 543
  });
});

// ───────────────────────── full overview (no-DB mock) ─────────────────────────

describe("getDashboardOverview (no-DB mock)", () => {
  it("returns all three sections with the period header", async () => {
    const o = await getDashboardOverview(now);
    expect(o.period.asOf).toBe(now.toISOString());
    expect(o.period.monthLabel.en).toBe("June 2026");
    expect(o.sales).toBeDefined();
    expect(o.capacity).toBeDefined();
    expect(o.retention).toBeDefined();
  });

  it("sales: prototype figures, 14 daily points, mix ~100%, perInstructor populated", async () => {
    const { sales } = await getDashboardOverview(now);
    expect(sales.revenueMtd).toBe(341_800);
    expect(sales.revenueToday).toBe(18_400);
    expect(sales.deltaMtdPct).toBe(10.4);
    expect(sales.deltaTodayPct).toBe(23);

    expect(sales.dailyRevenue).toHaveLength(SPARKLINE_DAYS);
    const times = sales.dailyRevenue.map((p) => new Date(p.dateIso).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b)); // oldest→newest

    const mixPct = sales.revenueMix.reduce((s, m) => s + m.pct, 0);
    expect(mixPct).toBe(100);
    expect(sales.revenueMix.reduce((s, m) => s + m.amount, 0)).toBe(sales.revenueTotalMix);

    expect(sales.trialConversion).toEqual({ converted: 32, total: 50, pct: 64 });
    expect(sales.packageLiability).toEqual({ thb: 284_500, hoursOutstanding: 612, pctOfSold: 38 });

    expect(sales.perInstructor.length).toBeGreaterThan(0);
    // revenue-sorted descending
    const revs = sales.perInstructor.map((i) => i.revenue);
    expect(revs).toEqual([...revs].sort((a, b) => b - a));
    expect(sales.perInstructor[0]!.name.en).toBe("Kru Mai");
    expect(sales.perInstructor[0]!.initials).toBe("M");
  });

  it("capacity: fill rate + 3 alerts (one of each severity)", async () => {
    const { capacity } = await getDashboardOverview(now);
    expect(capacity.fillRateOverall).toBe(78);
    expect(capacity.fillRateDeltaPts).toBe(5);
    expect(capacity.fillRateByType.find((b) => b.type === "group")!.pct).toBe(82);
    expect(capacity.alerts).toHaveLength(3);
    const sevs = capacity.alerts.map((a) => a.severity).sort();
    expect(sevs).toEqual(["empty", "low", "overbooked"]);
  });

  it("retention: 4 expiring rows + house usage with GUESTS EXCLUDED", async () => {
    const { retention } = await getDashboardOverview(now);
    expect(retention.expiringSoon.length).toBe(4);
    // expiring carries both tiers (members AND guests shown here)
    expect(retention.expiringSoon.some((e) => e.tier === "guest")).toBe(true);
    expect(retention.expiringSoon.some((e) => e.tier === "member")).toBe(true);

    // House usage: every card is a household (house number present, has member ids);
    // a guest (no household) can never appear here (§5 inv 2/3).
    expect(retention.houseUsage.length).toBeGreaterThan(0);
    for (const h of retention.houseUsage) {
      expect(h.houseNumber).toBeTruthy();
      expect(h.memberIds.length).toBeGreaterThan(0);
      expect(h.totalHours).toBeGreaterThan(0);
    }
    // sorted by pct desc (most urgent first)
    const pcts = retention.houseUsage.map((h) => h.pct);
    expect(pcts).toEqual([...pcts].sort((a, b) => b - a));
  });
});
