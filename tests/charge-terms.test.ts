// The purchased-terms snapshot resolver (lib/catalog/chargeTerms.ts).
//
// This is the pure core of the fix for "a catalog edit retroactively changes what an
// already-paid charge grants". The DB-backed proof lives in
// tests/integration/charge-terms-snapshot.integration.test.ts; this suite pins the
// decision logic itself, which needs no database:
//
//   - a COMPLETE snapshot overrides hours / validity / category and nothing else;
//   - a MISSING snapshot (pre-migration rows) falls back to the live item;
//   - a PARTIAL snapshot is treated as legacy — never stitched together with live
//     values, which would grant terms that were never sold;
//   - the id survives, because the 1+1 promo keys off the literal id "drop"
//     (lib/credits/creditPackage.ts) and packages.type must keep resolving.

import { describe, expect, it } from "vitest";
import { itemForCredit, termsSnapshotFor } from "@/lib/catalog/chargeTerms";
import type { CatalogItem } from "@/lib/catalog/packages";

/** The live catalog item AFTER the owner edited it: 10h → 20h, 2mo → 3mo. */
const LIVE_EDITED: CatalogItem = {
  id: "p10",
  category: "group",
  hours: 20,
  price: 5500,
  perHour: 275,
  validity: { amount: 3, unit: "month" },
  tag: "popular",
  label: { en: "20 hours", th: "20 ชั่วโมง" },
  sublabel: { en: "Valid 3 months", th: "ใช้ได้ 3 เดือน" },
};

/** What the customer actually paid for before that edit (structured snapshot). */
const PAID = {
  hours: 10,
  validity: "two_months",
  validityAmount: 2,
  validityUnit: "month",
  category: "group" as const,
};

describe("itemForCredit — a complete snapshot wins over the live item", () => {
  it("grants the PAID hours, not today's", () => {
    expect(itemForCredit(LIVE_EDITED, PAID).hours).toBe(10);
  });

  it("uses the PAID validity, so the expiry matches what was sold", () => {
    expect(itemForCredit(LIVE_EDITED, PAID).validity).toEqual({ amount: 2, unit: "month" });
  });

  it("uses the PAID category, so the credit lands in the bucket that was bought", () => {
    const crossBucket = { ...LIVE_EDITED, category: "private" as const };
    expect(itemForCredit(crossBucket, PAID).category).toBe("group");
  });

  it("keeps the LIVE id, label and price — display fields, and the promo keys off id", () => {
    const out = itemForCredit({ ...LIVE_EDITED, id: "drop" }, PAID);
    expect(out.id).toBe("drop"); // promoBonusHours matches this literal
    expect(out.label).toEqual(LIVE_EDITED.label);
    expect(out.price).toBe(5500);
  });

  it("supports a custom DAY validity snapshot", () => {
    const out = itemForCredit(LIVE_EDITED, {
      hours: 5,
      validity: "45_day",
      validityAmount: 45,
      validityUnit: "day",
      category: "group",
    });
    expect(out.validity).toEqual({ amount: 45, unit: "day" });
  });

  it("honours a zero-price / comped snapshot without treating 0 hours as missing", () => {
    // hours is validated > 0 at the catalog boundary, but the null-check must be a
    // null-check, not a falsiness check — pinned so a refactor can't regress it.
    const out = itemForCredit(LIVE_EDITED, {
      hours: 1,
      validity: "one_month",
      validityAmount: 1,
      validityUnit: "month",
      category: "group",
    });
    expect(out.hours).toBe(1);
    expect(out.validity).toEqual({ amount: 1, unit: "month" });
  });

  it("falls back to the legacy validity TEXT when the structured columns are null (old snapshot)", () => {
    const out = itemForCredit(LIVE_EDITED, {
      hours: 10,
      validity: "two_months",
      validityAmount: null,
      validityUnit: null,
      category: "group",
    });
    expect(out.validity).toEqual({ amount: 2, unit: "month" });
  });
});

describe("itemForCredit — legacy and partial snapshots fall back", () => {
  it("all-null (a pre-migration charge) credits from the live item, exactly as before", () => {
    const out = itemForCredit(LIVE_EDITED, {
      hours: null,
      validity: null,
      validityAmount: null,
      validityUnit: null,
      category: null,
    });
    expect(out).toEqual(LIVE_EDITED);
  });

  it("a half-written snapshot is legacy, NOT a mix of paid and live terms", () => {
    for (const partial of [
      { hours: 10, validity: null, validityAmount: null, validityUnit: null, category: null },
      { hours: null, validity: "two_months", validityAmount: 2, validityUnit: "month", category: null },
      { hours: 10, validity: null, validityAmount: null, validityUnit: null, category: "group" as const },
    ]) {
      const out = itemForCredit(LIVE_EDITED, partial);
      expect(out).toEqual(LIVE_EDITED); // whole live item, never a stitched hybrid
    }
  });
});

describe("termsSnapshotFor — what every charge-creation site writes", () => {
  it("captures the structured validity plus the legacy text and the other terms", () => {
    expect(termsSnapshotFor(LIVE_EDITED)).toEqual({
      hours: 20,
      validity: "three_months",
      validityAmount: 3,
      validityUnit: "month",
      category: "group",
    });
  });

  it("round-trips: crediting from a fresh snapshot equals crediting from the item", () => {
    expect(itemForCredit(LIVE_EDITED, termsSnapshotFor(LIVE_EDITED))).toEqual(LIVE_EDITED);
  });

  it("round-trips a custom DAY validity too", () => {
    const dayItem: CatalogItem = { ...LIVE_EDITED, validity: { amount: 10, unit: "day" } };
    expect(termsSnapshotFor(dayItem)).toEqual({
      hours: 20,
      validity: "10_day",
      validityAmount: 10,
      validityUnit: "day",
      category: "group",
    });
    expect(itemForCredit(dayItem, termsSnapshotFor(dayItem)).validity).toEqual({
      amount: 10,
      unit: "day",
    });
  });
});
