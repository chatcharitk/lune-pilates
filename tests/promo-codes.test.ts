// Promo codes for studio events (lib/promos/codes.ts).
//
// These are the money rules: what a code is worth, and when it may be applied.
// Both are pure — the client only ever sends the code string and the server
// recomputes from the stored code plus the catalog item (CLAUDE.md §8).

import { describe, expect, it } from "vitest";
import {
  MIN_CHARGED_THB,
  discountFor,
  discountedAmount,
  evaluatePromoCode,
  isValidPromoCodeShape,
  normalizePromoCode,
  type PromoCode,
} from "@/lib/promos/codes";

const NOW = new Date("2026-10-10T05:00:00Z");

function code(over: Partial<PromoCode> = {}): PromoCode {
  return {
    code: "GRANDOPEN",
    label: { en: "Grand opening", th: "เปิดร้านใหญ่" },
    kind: "percent",
    value: 20,
    startsAt: null,
    endsAt: null,
    maxRedemptions: null,
    maxPerCustomer: 1,
    appliesToCategory: null,
    appliesToItemId: null,
    firstPurchaseOnly: false,
    active: true,
    ...over,
  };
}

const ITEM = { id: "p10", category: "group" as const, price: 5500 };

function evaluate(over: Partial<PromoCode> = {}, ctx: Partial<Parameters<typeof evaluatePromoCode>[0]> = {}) {
  return evaluatePromoCode({
    code: code(over),
    item: ITEM,
    redemptionsUsed: 0,
    redemptionsByCustomer: 0,
    hasPurchasedBefore: false,
    now: NOW,
    ...ctx,
  });
}

describe("what a code is worth", () => {
  it("takes a percentage off", () => {
    expect(discountFor({ kind: "percent", value: 20 }, 5500)).toBe(1100);
    expect(discountedAmount({ kind: "percent", value: 20 }, 5500)).toBe(4400);
  });

  it("takes a fixed amount off", () => {
    expect(discountFor({ kind: "fixed", value: 500 }, 5500)).toBe(500);
    expect(discountedAmount({ kind: "fixed", value: 500 }, 5500)).toBe(5000);
  });

  it("rounds a percentage DOWN, so rounding never gives away more than advertised", () => {
    // 33% of 700 is 231.0; 33% of 701 is 231.33 → 231, not 232.
    expect(discountFor({ kind: "percent", value: 33 }, 701)).toBe(231);
  });

  it("never takes the price to zero — a ฿0 QR is meaningless", () => {
    expect(discountedAmount({ kind: "percent", value: 100 }, 5500)).toBe(MIN_CHARGED_THB);
    expect(discountedAmount({ kind: "fixed", value: 99999 }, 700)).toBe(MIN_CHARGED_THB);
  });

  it("never returns a negative discount", () => {
    expect(discountFor({ kind: "fixed", value: 500 }, 1)).toBe(0);
  });
});

describe("when a code may be applied", () => {
  it("applies in the simple case", () => {
    expect(evaluate()).toEqual({ ok: true, discount: 1100, amount: 4400 });
  });

  it("refuses one the owner switched off", () => {
    expect(evaluate({ active: false })).toEqual({ ok: false, reason: "INACTIVE" });
  });

  it("refuses before its window opens and after it closes", () => {
    expect(evaluate({ startsAt: new Date("2026-10-11T00:00:00Z") })).toEqual({
      ok: false,
      reason: "NOT_STARTED",
    });
    expect(evaluate({ endsAt: new Date("2026-10-09T23:59:59Z") })).toEqual({
      ok: false,
      reason: "EXPIRED",
    });
  });

  it("accepts on the last usable instant of its window", () => {
    const res = evaluate({ endsAt: NOW });
    expect(res.ok).toBe(true);
  });

  it("refuses once the overall cap is used up — 'first 30'", () => {
    expect(evaluate({ maxRedemptions: 30 }, { redemptionsUsed: 30 })).toEqual({
      ok: false,
      reason: "EXHAUSTED",
    });
    expect(evaluate({ maxRedemptions: 30 }, { redemptionsUsed: 29 }).ok).toBe(true);
  });

  it("refuses a customer who already used it", () => {
    expect(evaluate({}, { redemptionsByCustomer: 1 })).toEqual({
      ok: false,
      reason: "ALREADY_USED",
    });
    expect(evaluate({ maxPerCustomer: 2 }, { redemptionsByCustomer: 1 }).ok).toBe(true);
  });

  it("honours first-purchase-only", () => {
    expect(evaluate({ firstPurchaseOnly: true }, { hasPurchasedBefore: true })).toEqual({
      ok: false,
      reason: "NOT_FIRST_PURCHASE",
    });
    expect(evaluate({ firstPurchaseOnly: true }, { hasPurchasedBefore: false }).ok).toBe(true);
  });

  it("restricts to a format", () => {
    expect(evaluate({ appliesToCategory: "private" })).toEqual({
      ok: false,
      reason: "NOT_APPLICABLE",
    });
    expect(evaluate({ appliesToCategory: "group" }).ok).toBe(true);
  });

  it("restricts to a single package", () => {
    expect(evaluate({ appliesToItemId: "pv8" })).toEqual({
      ok: false,
      reason: "NOT_APPLICABLE",
    });
    expect(evaluate({ appliesToItemId: "p10" }).ok).toBe(true);
  });

  it("refuses a code worth nothing rather than showing 'applied' beside an unchanged total", () => {
    // 1% of a ฿50 item rounds down to ฿0.
    const res = evaluatePromoCode({
      code: code({ kind: "percent", value: 1 }),
      item: { id: "x", category: "group", price: 50 },
      redemptionsUsed: 0,
      redemptionsByCustomer: 0,
      hasPurchasedBefore: false,
      now: NOW,
    });
    expect(res).toEqual({ ok: false, reason: "NOT_APPLICABLE" });
  });

  it("reports the most fundamental problem when several apply at once", () => {
    // Switched off AND expired AND sold out — the owner's switch is what matters.
    const res = evaluate(
      { active: false, endsAt: new Date("2020-01-01T00:00:00Z"), maxRedemptions: 1 },
      { redemptionsUsed: 5 },
    );
    expect(res).toEqual({ ok: false, reason: "INACTIVE" });
  });
});

describe("code shape", () => {
  it("normalises to trimmed uppercase", () => {
    expect(normalizePromoCode("  grandopen  ")).toBe("GRANDOPEN");
  });

  it.each(["GRANDOPEN", "SOFT-OPEN", "OPEN2026", "AB"])("accepts %s", (raw) => {
    expect(isValidPromoCodeShape(raw)).toBe(true);
  });

  it.each([
    ["a single character", "A"],
    ["a space inside", "GRAND OPEN"],
    ["punctuation", "GRAND!"],
    ["a leading dash", "-OPEN"],
    ["empty", ""],
  ])("rejects %s", (_label, raw) => {
    expect(isValidPromoCodeShape(raw)).toBe(false);
  });
});
