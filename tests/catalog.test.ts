import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SEED_CATALOG,
  getCatalogItem,
  listPackageCatalog,
  loadCatalogMap,
  sublabelForValidity,
  type CatalogItem,
} from "@/lib/catalog/packages";
import { expiryFromValidity } from "@/lib/catalog/validity";
import { studioInstant, studioParts } from "@/lib/time";

// ───────────────────────── validity → expiry ─────────────────────────

describe("expiryFromValidity — inclusive whole Bangkok day (owner's rule, 2026-09-07)", () => {
  // 18 Jun 2026, 16:30 Bangkok (09:30 UTC).
  const now = new Date("2026-06-18T09:30:00Z");

  /** The Bangkok calendar date of an instant, as "YYYY-MM-DD". */
  function bkkDate(d: Date): string {
    const { year, month0, day } = studioParts(d);
    return `${year}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  it("THE OWNER'S EXAMPLE: bought 1 Sep with 15 days expires on the 16th, and the whole 16th is still valid", () => {
    // Bought at 10:00 Bangkok on 1 September.
    const boughtSep1 = studioInstant(2026, 8, 1, 10, 0);
    const exp = expiryFromValidity(15, "day", boughtSep1);

    expect(bkkDate(exp)).toBe("2026-09-16");

    // Still usable at the very last minute of the 16th …
    const lateOnThe16th = studioInstant(2026, 8, 16, 23, 59);
    expect(exp.getTime()).toBeGreaterThan(lateOnThe16th.getTime());

    // … and no longer usable once the 17th begins.
    const startOfThe17th = studioInstant(2026, 8, 17, 0, 0);
    expect(exp.getTime()).toBeLessThan(startOfThe17th.getTime());
  });

  it("expires at the last millisecond of the Bangkok day (23:59:59.999 +07 = 16:59:59.999Z)", () => {
    const exp = expiryFromValidity(15, "day", studioInstant(2026, 8, 1, 10, 0));
    expect(exp.toISOString()).toBe("2026-09-16T16:59:59.999Z");
  });

  it("ignores the time of day bought: 08:00 and 23:50 on the same day expire together", () => {
    const early = expiryFromValidity(15, "day", studioInstant(2026, 8, 1, 8, 0));
    const late = expiryFromValidity(15, "day", studioInstant(2026, 8, 1, 23, 50));
    expect(early.toISOString()).toBe(late.toISOString());
  });

  it("a purchase late on a Bangkok evening still counts that day as day zero", () => {
    // 23:50 Bangkok on 1 Sep is 16:50 UTC on 1 Sep — the UTC date happens to agree
    // here, but the rule must follow the BANGKOK day either way.
    const exp = expiryFromValidity(1, "day", studioInstant(2026, 8, 1, 23, 50));
    expect(bkkDate(exp)).toBe("2026-09-02");
  });

  it("a purchase just after Bangkok midnight belongs to the NEW day, not the UTC one", () => {
    // 00:30 Bangkok on 2 Sep is 17:30 UTC on 1 Sep — a naive UTC reading would
    // anchor this to the 1st and expire the package a day early.
    const exp = expiryFromValidity(15, "day", studioInstant(2026, 8, 2, 0, 30));
    expect(bkkDate(exp)).toBe("2026-09-17");
  });

  it("applies the same inclusive-day rule to months", () => {
    const exp = expiryFromValidity(1, "month", studioInstant(2026, 8, 1, 10, 0));
    expect(bkkDate(exp)).toBe("2026-10-01");
    expect(exp.getTime()).toBeGreaterThan(studioInstant(2026, 9, 1, 23, 59).getTime());
    expect(exp.getTime()).toBeLessThan(studioInstant(2026, 9, 2, 0, 0).getTime());
  });

  it("month expiries land on the same day-of-month, Bangkok", () => {
    expect(bkkDate(expiryFromValidity(1, "month", now))).toBe("2026-07-18");
    expect(bkkDate(expiryFromValidity(2, "month", now))).toBe("2026-08-18");
    expect(bkkDate(expiryFromValidity(3, "month", now))).toBe("2026-09-18");
  });

  it("is pure: does not mutate the passed `now`", () => {
    const before = now.getTime();
    expiryFromValidity(3, "month", now);
    expiryFromValidity(30, "day", now);
    expect(now.getTime()).toBe(before);
  });

  it("always returns a future expiry strictly after `now`", () => {
    for (const [amount, unit] of [
      [1, "month"],
      [2, "month"],
      [3, "month"],
      [1, "day"],
      [90, "day"],
    ] as const) {
      expect(expiryFromValidity(amount, unit, now).getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it("never SHORTENS a package vs the old purchase-time-of-day rule", () => {
    // The inclusive-day rule must only ever extend, never cut short — otherwise
    // shipping it would retroactively disadvantage a customer mid-package.
    for (const [amount, unit] of [
      [1, "month"],
      [3, "month"],
      [1, "day"],
      [15, "day"],
      [90, "day"],
    ] as const) {
      const oldRule =
        unit === "day"
          ? new Date(now.getTime() + amount * 24 * 3_600_000)
          : (() => {
              const d = new Date(now.getTime());
              d.setUTCMonth(d.getUTCMonth() + amount);
              return d;
            })();
      expect(expiryFromValidity(amount, unit, now).getTime()).toBeGreaterThanOrEqual(
        oldRule.getTime(),
      );
    }
  });

  it("rolls month overflow forward, never shortening the window (Jan 31 + 1mo)", () => {
    // 2025 is not a leap year: Jan 31 + 1 month normalises into early March, not Feb.
    const jan31 = studioInstant(2025, 0, 31, 12, 0);
    const exp = expiryFromValidity(1, "month", jan31);
    expect(exp.getTime()).toBeGreaterThan(jan31.getTime());
    expect(studioParts(exp).month0).toBe(2); // March (0-indexed)
  });

  it("crosses a year boundary correctly (Dec + 2mo → Feb next year)", () => {
    const dec = studioInstant(2026, 11, 10, 12, 0);
    const exp = expiryFromValidity(2, "month", dec);
    expect(studioParts(exp).year).toBe(2027);
    expect(studioParts(exp).month0).toBe(1); // February
  });
});

// ───────────────────────── catalog price/hours lookup ─────────────────────────
// The catalog is now DB-backed and owner-editable (catalog_items). These tests run
// with no DATABASE_URL, so they exercise the SEED_CATALOG fallback — the behaviour
// a fresh/unseeded install must still have, byte-for-byte with the old constant.

const ORIGINAL_DB_URL = process.env.DATABASE_URL;

beforeEach(() => {
  delete process.env.DATABASE_URL; // force the seed-constant fallback path
});
afterEach(() => {
  if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB_URL;
});

describe("getCatalogItem (server-side price/hours source of truth)", () => {
  it("returns canonical price + hours for a group pack (p10)", async () => {
    const item = await getCatalogItem("p10");
    expect(item).toBeDefined();
    expect(item?.category).toBe("group");
    expect(item?.hours).toBe(10);
    expect(item?.price).toBe(5500);
    expect(item?.perHour).toBe(550);
    expect(item?.tag).toBe("popular");
  });

  it("returns canonical numbers for a private format pack (pv8)", async () => {
    const item = await getCatalogItem("pv8");
    expect(item?.category).toBe("private");
    expect(item?.hours).toBe(8);
    expect(item?.price).toBe(12000);
    expect(item?.validity).toEqual({ amount: 2, unit: "month" });
  });

  it("maps duo/trio packs to the private category (they debit the private pool)", async () => {
    expect((await getCatalogItem("duo8"))?.category).toBe("private");
    expect((await getCatalogItem("trio8"))?.category).toBe("private");
  });

  it("returns the rental category for rental items", async () => {
    const item = await getCatalogItem("r-duo");
    expect(item?.category).toBe("rental");
    expect(item?.hours).toBe(1);
    expect(item?.price).toBe(800);
  });

  it("returns undefined for an unknown id (so checkout fails closed)", async () => {
    expect(await getCatalogItem("not-a-real-package")).toBeUndefined();
    expect(await getCatalogItem("")).toBeUndefined();
  });

  it("rental items are now PURCHASABLE again (un-hidden 2026-07-23)", async () => {
    const listed = (await listPackageCatalog()).flatMap((c) => c.items).map((i) => i.id);
    expect(listed).toContain("r-solo");
    expect((await getCatalogItem("r-solo"))?.price).toBe(600);
  });

  it("keys the 1+1 trial promo item: 'drop' resolves to the 1h group drop-in", async () => {
    // promoBonusHours (lib/credits/creditPackage.ts) keys off this LITERAL id.
    const drop = await getCatalogItem("drop");
    expect(drop?.category).toBe("group");
    expect(drop?.hours).toBe(1);
    expect(drop?.price).toBe(650);
  });
});

describe("listPackageCatalog", () => {
  it("groups items under the visible categories in display order (rental un-hidden)", async () => {
    const cats = await listPackageCatalog();
    expect(cats.map((c) => c.id)).toEqual(["group", "private", "rental"]);
  });

  it("every item's id resolves back through getCatalogItem to an equal item", async () => {
    const all = (await listPackageCatalog()).flatMap((c) => c.items);
    expect(all.length).toBe(13); // 4 group + 6 private + 3 rental (rental un-hidden 2026-07-23)
    for (const item of all) {
      expect(await getCatalogItem(item.id)).toEqual(item);
    }
  });

  it("orders items within a category by sortOrder", async () => {
    const group = (await listPackageCatalog()).find((c) => c.id === "group");
    expect(group?.items.map((i) => i.id)).toEqual(["drop", "p5", "p10", "p15"]);
  });

  it("each item carries bilingual EN+TH label and sublabel (no missing copy)", async () => {
    const all = (await listPackageCatalog()).flatMap((c) => c.items);
    for (const item of all) {
      expectBilingual(item.label);
      expectBilingual(item.sublabel);
    }
  });

  it("perHour is DERIVED consistently from price/hours", async () => {
    const all = (await listPackageCatalog()).flatMap((c) => c.items);
    for (const item of all) {
      expect(item.perHour).toBe(Math.round(item.price / item.hours));
    }
  });

  it("sublabel is DERIVED from validity (never stored, never drifts)", async () => {
    const all = (await listPackageCatalog()).flatMap((c) => c.items);
    for (const item of all) {
      expect(item.sublabel).toEqual(sublabelForValidity(item.validity));
    }
  });
});

describe("SEED_CATALOG (the seed + empty-table fallback constant)", () => {
  it("carries all 13 canonical items", () => {
    expect(SEED_CATALOG.length).toBe(13);
  });

  it("has unique ids (they become packages.type / charges.package_id)", () => {
    const ids = SEED_CATALOG.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses only whole-integer hours and prices (no floats in the money path)", () => {
    for (const item of SEED_CATALOG) {
      expect(Number.isInteger(item.hours)).toBe(true);
      expect(Number.isInteger(item.price)).toBe(true);
      expect(item.hours).toBeGreaterThan(0);
      expect(item.price).toBeGreaterThanOrEqual(0);
    }
  });

  it("carries non-empty EN and TH labels for every item (CLAUDE.md §6)", () => {
    for (const item of SEED_CATALOG) expectBilingual(item.label);
  });
});

describe("loadCatalogMap", () => {
  it("indexes the WHOLE catalog including hidden/archived-capable items", async () => {
    const map = await loadCatalogMap();
    expect(map.size).toBe(13); // all 13, not just the 10 purchasable ones
    expect(map.get("r-solo")?.price).toBe(600);
  });
});

function expectBilingual(b: CatalogItem["label"]): void {
  expect(typeof b.en).toBe("string");
  expect(b.en.length).toBeGreaterThan(0);
  expect(typeof b.th).toBe("string");
  expect(b.th.length).toBeGreaterThan(0);
}
