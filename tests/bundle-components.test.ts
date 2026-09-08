// Bundle components: the model behind the studio's ฿1,800 trial — one private (1:1)
// class valid 14 days from payment, plus a free group class valid 7 days from THAT
// private class (owner, 2026-09-08).
//
// These are the pure pieces: how a component set is validated and ordered, how a
// purchase's shape is frozen onto the charge, and how the debit guard treats a
// balance whose clock has not started. The transactional behaviour (one package row
// per component, unlock on booking, relock on cancel) needs a database and lives in
// the integration suite.

import { describe, expect, it } from "vitest";
import {
  MAIN_COMPONENT_KEY,
  SEED_COMPONENTS,
  TRIAL_ITEM_ID,
  implicitMainComponent,
  isBundle,
  sortComponents,
  topoSortComponents,
  totalHours,
  validateComponentSet,
  type CatalogComponent,
} from "@/lib/catalog/components";
import {
  parseComponentsSnapshot,
  serializeComponentsSnapshot,
} from "@/lib/catalog/componentsSnapshot";
import { packageDebitBlock } from "@/lib/credits/guards";
import { expiryFromValidity } from "@/lib/catalog/validity";
import { studioInstant, studioParts } from "@/lib/time";
import type { CatalogItem } from "@/lib/catalog/packages";

const PLAIN_ITEM: CatalogItem = {
  id: "p10",
  category: "group",
  hours: 10,
  price: 5500,
  perHour: 550,
  validity: { amount: 2, unit: "month" },
  label: { en: "10 hours", th: "10 ชั่วโมง" },
  sublabel: { en: "Valid 2 months", th: "ใช้ได้ 2 เดือน" },
};

function component(over: Partial<CatalogComponent> = {}): CatalogComponent {
  return {
    componentKey: "a",
    category: "group",
    hours: 1,
    validity: { amount: 7, unit: "day" },
    anchorComponentKey: null,
    sortOrder: 0,
    label: { en: "A", th: "A" },
    ...over,
  };
}

// ───────────────────────── the trial, as configured ─────────────────────────

describe("the ฿1,800 trial bundle", () => {
  const trial = SEED_COMPONENTS[TRIAL_ITEM_ID]!;

  it("grants a private class and a free group class", () => {
    expect(trial).toHaveLength(2);
    const priv = trial.find((c) => c.componentKey === "private")!;
    const free = trial.find((c) => c.componentKey === "free_group")!;

    // One credit = one class for every type (lib/credits/cost.ts), so these are
    // exactly one class each.
    expect(priv.category).toBe("private");
    expect(priv.hours).toBe(1);
    expect(free.category).toBe("group");
    expect(free.hours).toBe(1);
  });

  it("starts the private at purchase (14 days) and anchors the free class to it (7 days)", () => {
    const priv = trial.find((c) => c.componentKey === "private")!;
    const free = trial.find((c) => c.componentKey === "free_group")!;

    expect(priv.anchorComponentKey).toBeNull(); // clock starts at payment
    expect(priv.validity).toEqual({ amount: 14, unit: "day" });

    expect(free.anchorComponentKey).toBe("private"); // dormant until the private is used
    expect(free.validity).toEqual({ amount: 7, unit: "day" });
  });

  it("is a coherent set (an anchor that resolves, no cycle, a purchase-anchored root)", () => {
    expect(validateComponentSet(trial)).toBeNull();
  });

  it("is a bundle granting 2 classes in total — one private, one group", () => {
    expect(isBundle(trial)).toBe(true);
    expect(totalHours(trial)).toBe(2);
  });

  it("dates work out: bought 1 Sep, private runs to the 15th; a private taken on the 10th frees a group class to the 17th", () => {
    const bought = studioInstant(2026, 8, 1, 10, 0); // 1 Sep, 10:00 Bangkok
    const priv = trial.find((c) => c.componentKey === "private")!;
    const free = trial.find((c) => c.componentKey === "free_group")!;

    const privExpiry = expiryFromValidity(priv.validity.amount, priv.validity.unit, bought);
    const p = studioParts(privExpiry);
    expect([p.year, p.month0 + 1, p.day]).toEqual([2026, 9, 15]); // 1 + 14 days

    // The free class's clock starts at the private CLASS, not at purchase.
    const privateClassStart = studioInstant(2026, 8, 10, 18, 0); // 10 Sep, 18:00
    const freeExpiry = expiryFromValidity(
      free.validity.amount,
      free.validity.unit,
      privateClassStart,
    );
    const f = studioParts(freeExpiry);
    expect([f.year, f.month0 + 1, f.day]).toEqual([2026, 9, 17]); // 10 + 7 days
  });
});

// ───────────────────────── plain items are untouched ─────────────────────────

describe("items without components behave exactly as before", () => {
  it("resolves to a single implicit 'main' component mirroring the item", () => {
    const main = implicitMainComponent(PLAIN_ITEM);
    expect(main.componentKey).toBe(MAIN_COMPONENT_KEY);
    expect(main.category).toBe(PLAIN_ITEM.category);
    expect(main.hours).toBe(PLAIN_ITEM.hours);
    expect(main.validity).toEqual(PLAIN_ITEM.validity);
    expect(main.anchorComponentKey).toBeNull();
    expect(isBundle([main])).toBe(false);
  });
});

// ───────────────────────── validation ─────────────────────────

describe("validateComponentSet", () => {
  it("rejects an empty set", () => {
    expect(validateComponentSet([])).toBe("EMPTY");
  });

  it("rejects duplicate keys", () => {
    expect(
      validateComponentSet([component({ componentKey: "a" }), component({ componentKey: "a" })]),
    ).toBe("DUPLICATE_KEY");
  });

  it("rejects an anchor naming a component that isn't in the set", () => {
    expect(
      validateComponentSet([component({ componentKey: "a", anchorComponentKey: "ghost" })]),
    ).toBe("UNKNOWN_ANCHOR");
  });

  it("rejects a set where nothing starts at purchase — every balance would be dormant forever", () => {
    expect(
      validateComponentSet([
        component({ componentKey: "a", anchorComponentKey: "b" }),
        component({ componentKey: "b", anchorComponentKey: "a" }),
      ]),
    ).toBe("NO_PURCHASE_ANCHORED_COMPONENT");
  });

  it("rejects a cycle hanging off a valid root", () => {
    expect(
      validateComponentSet([
        component({ componentKey: "root", anchorComponentKey: null }),
        component({ componentKey: "a", anchorComponentKey: "b" }),
        component({ componentKey: "b", anchorComponentKey: "a" }),
      ]),
    ).toBe("ANCHOR_CYCLE");
  });

  it("accepts a chain", () => {
    expect(
      validateComponentSet([
        component({ componentKey: "a", anchorComponentKey: null }),
        component({ componentKey: "b", anchorComponentKey: "a" }),
        component({ componentKey: "c", anchorComponentKey: "b" }),
      ]),
    ).toBeNull();
  });
});

// ───────────────────────── ordering ─────────────────────────

describe("topoSortComponents", () => {
  it("puts every anchor before the components that depend on it, down a chain", () => {
    // Deliberately supplied in reverse, with sortOrder that would mislead a naive sort.
    const out = topoSortComponents([
      component({ componentKey: "c", anchorComponentKey: "b", sortOrder: 0 }),
      component({ componentKey: "b", anchorComponentKey: "a", sortOrder: 1 }),
      component({ componentKey: "a", anchorComponentKey: null, sortOrder: 2 }),
    ]);
    expect(out.map((c) => c.componentKey)).toEqual(["a", "b", "c"]);
  });

  it("keeps every component even if the set were cyclic (credit is never dropped)", () => {
    const out = topoSortComponents([
      component({ componentKey: "a", anchorComponentKey: "b" }),
      component({ componentKey: "b", anchorComponentKey: "a" }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("orders the trial private-then-free so the anchor package exists first", () => {
    const out = topoSortComponents(SEED_COMPONENTS[TRIAL_ITEM_ID]!);
    expect(out.map((c) => c.componentKey)).toEqual(["private", "free_group"]);
  });

  it("sortComponents puts purchase-anchored roots first", () => {
    const out = sortComponents([
      component({ componentKey: "later", anchorComponentKey: "root", sortOrder: 0 }),
      component({ componentKey: "root", anchorComponentKey: null, sortOrder: 9 }),
    ]);
    expect(out[0]!.componentKey).toBe("root");
  });
});

// ───────────────────────── the purchase snapshot ─────────────────────────

describe("components snapshot frozen on the charge", () => {
  const trial = SEED_COMPONENTS[TRIAL_ITEM_ID]!;

  it("round-trips exactly", () => {
    const parsed = parseComponentsSnapshot(serializeComponentsSnapshot(trial));
    expect(parsed).toEqual(trial);
  });

  it("returns null when there is no snapshot (plain items, pre-bundle charges)", () => {
    expect(parseComponentsSnapshot(null)).toBeNull();
    expect(parseComponentsSnapshot("")).toBeNull();
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["not an object", "[1,2,3]"],
    ["empty component list", JSON.stringify({ v: 1, components: [] })],
    ["a future version", JSON.stringify({ v: 99, components: [{ componentKey: "a" }] })],
  ])("falls back to live resolution on %s", (_label, json) => {
    expect(parseComponentsSnapshot(json)).toBeNull();
  });

  it.each([
    ["a bad category", { category: "massage" }],
    ["zero hours", { hours: 0 }],
    ["fractional hours", { hours: 1.5 }],
    ["a bad validity unit", { validityUnit: "fortnight" }],
    ["a non-positive validity", { validityAmount: 0 }],
  ])("refuses a partially-valid payload rather than crediting half a bundle: %s", (_l, over) => {
    const good = {
      componentKey: "a",
      category: "group",
      hours: 1,
      validityAmount: 7,
      validityUnit: "day",
      anchorComponentKey: null,
      sortOrder: 0,
      labelEn: "A",
      labelTh: "A",
    };
    const json = JSON.stringify({ v: 1, components: [{ ...good, ...over }] });
    expect(parseComponentsSnapshot(json)).toBeNull();
  });

  it("refuses a snapshot that no longer forms a coherent set", () => {
    // An anchor naming a component that is not in the payload would leave that
    // balance dormant forever — fall back to live resolution instead.
    const json = JSON.stringify({
      v: 1,
      components: [
        {
          componentKey: "a",
          category: "group",
          hours: 1,
          validityAmount: 7,
          validityUnit: "day",
          anchorComponentKey: "ghost",
          sortOrder: 0,
          labelEn: "A",
          labelTh: "A",
        },
      ],
    });
    expect(parseComponentsSnapshot(json)).toBeNull();
  });
});

// ───────────────────────── the debit guard ─────────────────────────

describe("packageDebitBlock with dormant / not-yet-active balances", () => {
  const now = studioInstant(2026, 8, 10, 12, 0);

  it("blocks a DORMANT component (no expiry — its clock has not started)", () => {
    expect(packageDebitBlock({ hoursLeft: 1, expiresAt: null }, 1, now)).toBe("NOT_YET_ACTIVE");
  });

  it("blocks an unlocked component before its class has started", () => {
    // The private class is booked for tomorrow: the free group class is stamped but
    // must not be spendable until that class actually happens.
    const classStart = studioInstant(2026, 8, 11, 18, 0);
    const block = packageDebitBlock(
      { hoursLeft: 1, expiresAt: expiryFromValidity(7, "day", classStart), activatesAt: classStart },
      1,
      now,
    );
    expect(block).toBe("NOT_YET_ACTIVE");
  });

  it("allows it once the class has started", () => {
    const classStart = studioInstant(2026, 8, 10, 9, 0); // earlier the same day
    const block = packageDebitBlock(
      { hoursLeft: 1, expiresAt: expiryFromValidity(7, "day", classStart), activatesAt: classStart },
      1,
      now,
    );
    expect(block).toBeNull();
  });

  it("still reports EXPIRED and NO_CREDITS for ordinary packages", () => {
    const past = studioInstant(2026, 8, 1, 0, 0);
    const future = studioInstant(2026, 9, 1, 0, 0);
    expect(packageDebitBlock({ hoursLeft: 5, expiresAt: past }, 1, now)).toBe("EXPIRED");
    expect(packageDebitBlock({ hoursLeft: 1, expiresAt: future }, 2, now)).toBe("NO_CREDITS");
    expect(packageDebitBlock({ hoursLeft: 2, expiresAt: future }, 2, now)).toBeNull();
  });

  it("reports NOT_YET_ACTIVE ahead of NO_CREDITS — the most specific true reason", () => {
    expect(packageDebitBlock({ hoursLeft: 0, expiresAt: null }, 2, now)).toBe("NOT_YET_ACTIVE");
  });
});
