import { describe, expect, it } from "vitest";
import {
  getCatalogItem,
  listPackageCatalog,
  type CatalogItem,
} from "@/lib/catalog/packages";
import { expiryFromValidity } from "@/lib/catalog/validity";

// ───────────────────────── validity → expiry ─────────────────────────

describe("expiryFromValidity", () => {
  const now = new Date("2026-06-18T09:30:00Z");

  it("gives single_visit a 1-month window (drop-in still needs time to use the credit)", () => {
    expect(expiryFromValidity("single_visit", now).toISOString()).toBe("2026-07-18T09:30:00.000Z");
  });
  it("maps one_month → +1 month", () => {
    expect(expiryFromValidity("one_month", now).toISOString()).toBe("2026-07-18T09:30:00.000Z");
  });
  it("maps two_months → +2 months", () => {
    expect(expiryFromValidity("two_months", now).toISOString()).toBe("2026-08-18T09:30:00.000Z");
  });
  it("maps three_months → +3 months", () => {
    expect(expiryFromValidity("three_months", now).toISOString()).toBe("2026-09-18T09:30:00.000Z");
  });

  it("is pure: does not mutate the passed `now`", () => {
    const before = now.getTime();
    expiryFromValidity("three_months", now);
    expect(now.getTime()).toBe(before);
  });

  it("always returns a future expiry strictly after `now`", () => {
    const validities = ["single_visit", "one_month", "two_months", "three_months"] as const;
    for (const v of validities) {
      expect(expiryFromValidity(v, now).getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it("rolls month overflow forward, never shortening the window (Jan 31 + 1mo)", () => {
    // 2025 is not a leap year: Jan 31 + 1 month normalises into early March, not Feb.
    const jan31 = new Date("2025-01-31T00:00:00Z");
    const exp = expiryFromValidity("one_month", jan31);
    expect(exp.getTime()).toBeGreaterThan(jan31.getTime());
    expect(exp.getUTCMonth()).toBe(2); // March (0-indexed)
  });

  it("crosses a year boundary correctly (Dec + 2mo → Feb next year)", () => {
    const dec = new Date("2026-12-10T00:00:00Z");
    const exp = expiryFromValidity("two_months", dec);
    expect(exp.getUTCFullYear()).toBe(2027);
    expect(exp.getUTCMonth()).toBe(1); // February
  });
});

// ───────────────────────── catalog price/hours lookup ─────────────────────────

describe("getCatalogItem (server-side price/hours source of truth)", () => {
  it("returns canonical price + hours for a group pack (p10)", () => {
    const item = getCatalogItem("p10");
    expect(item).toBeDefined();
    expect(item?.category).toBe("group");
    expect(item?.hours).toBe(10);
    expect(item?.price).toBe(5500);
    expect(item?.perHour).toBe(550);
    expect(item?.tag).toBe("popular");
  });

  it("returns canonical numbers for a private format pack (pv8)", () => {
    const item = getCatalogItem("pv8");
    expect(item?.category).toBe("private");
    expect(item?.hours).toBe(8);
    expect(item?.price).toBe(12000);
    expect(item?.validity).toBe("two_months");
  });

  it("maps duo/trio packs to the private category (they debit the private pool)", () => {
    expect(getCatalogItem("duo8")?.category).toBe("private");
    expect(getCatalogItem("trio8")?.category).toBe("private");
  });

  it("returns the rental category for rental items", () => {
    const item = getCatalogItem("r-duo");
    expect(item?.category).toBe("rental");
    expect(item?.hours).toBe(1);
    expect(item?.price).toBe(800);
  });

  it("returns undefined for an unknown id (so checkout fails closed)", () => {
    expect(getCatalogItem("not-a-real-package")).toBeUndefined();
    expect(getCatalogItem("")).toBeUndefined();
  });
});

describe("listPackageCatalog", () => {
  it("groups items under the visible categories in display order (rental hidden)", () => {
    const cats = listPackageCatalog();
    expect(cats.map((c) => c.id)).toEqual(["group", "private"]);
  });

  it("every item's id resolves back through getCatalogItem to the same object", () => {
    const all = listPackageCatalog().flatMap((c) => c.items);
    expect(all.length).toBe(10); // 4 group + 6 private (rental hidden 2026-07-20)
    for (const item of all) {
      expect(getCatalogItem(item.id)).toBe(item);
    }
  });

  it("each item carries bilingual EN+TH label and sublabel (no missing copy)", () => {
    const all = listPackageCatalog().flatMap((c) => c.items);
    for (const item of all) {
      expectBilingual(item.label);
      expectBilingual(item.sublabel);
    }
  });

  it("perHour is consistent with price/hours for whole-hour packs", () => {
    const all = listPackageCatalog().flatMap((c) => c.items);
    for (const item of all) {
      expect(item.perHour).toBe(Math.round(item.price / item.hours));
    }
  });
});

function expectBilingual(b: CatalogItem["label"]): void {
  expect(typeof b.en).toBe("string");
  expect(b.en.length).toBeGreaterThan(0);
  expect(typeof b.th).toBe("string");
  expect(b.th.length).toBeGreaterThan(0);
}
