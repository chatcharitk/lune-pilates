import { describe, expect, it } from "vitest";
import { isFull, packageDebitBlock, seatsLeft } from "@/lib/credits/guards";
import { creditCostForClassType } from "@/lib/credits/cost";
import { evaluateCancellation } from "@/lib/credits/policy";
import { promoBonusHours } from "@/lib/credits/creditPackage";

const NOW = new Date("2026-06-01T12:00:00Z");
const future = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

describe("creditCostForClassType", () => {
  it("charges 1 credit for a group class", () => {
    expect(creditCostForClassType("group")).toBe(1);
  });
  it("charges 2 credits for private, duo and trio", () => {
    expect(creditCostForClassType("private")).toBe(2);
    expect(creditCostForClassType("duo")).toBe(2);
    expect(creditCostForClassType("trio")).toBe(2);
  });
  it("charges 1 credit for a rental", () => {
    expect(creditCostForClassType("rental")).toBe(1);
  });
});

describe("packageDebitBlock", () => {
  it("allows a debit when credits remain and not expired (cost 1)", () => {
    expect(packageDebitBlock({ hoursLeft: 2, expiresAt: future(24) }, 1, NOW)).toBeNull();
  });
  it("blocks when no credits left (cost 1)", () => {
    expect(packageDebitBlock({ hoursLeft: 0, expiresAt: future(24) }, 1, NOW)).toBe("NO_CREDITS");
  });
  it("allows a 2-cost debit when the balance exactly covers it", () => {
    expect(packageDebitBlock({ hoursLeft: 2, expiresAt: future(24) }, 2, NOW)).toBeNull();
  });
  it("blocks a 2-cost debit when the balance is only 1", () => {
    expect(packageDebitBlock({ hoursLeft: 1, expiresAt: future(24) }, 2, NOW)).toBe("NO_CREDITS");
  });
  it("blocks when expired regardless of cost (expiry checked before balance)", () => {
    expect(packageDebitBlock({ hoursLeft: 5, expiresAt: future(-1) }, 2, NOW)).toBe("EXPIRED");
  });
  it("treats exact expiry instant as expired", () => {
    expect(packageDebitBlock({ hoursLeft: 5, expiresAt: NOW }, 1, NOW)).toBe("EXPIRED");
  });
});

describe("capacity helpers", () => {
  it("computes seats left and never goes negative", () => {
    expect(seatsLeft(3, 1)).toBe(2);
    expect(seatsLeft(3, 5)).toBe(0);
  });
  it("isFull at and beyond capacity", () => {
    expect(isFull(3, 2)).toBe(false);
    expect(isFull(3, 3)).toBe(true);
    expect(isFull(2, 3)).toBe(true);
  });
});

describe("evaluateCancellation (fixed 5h free window)", () => {
  it("≥5h before start: free AND cancellable", () => {
    const out = evaluateCancellation(future(6), NOW);
    expect(out.status).toBe("free");
    expect(out.free).toBe(true);
    expect(out.cancellable).toBe(true);
  });

  it("exactly 5h before start: free (inclusive boundary)", () => {
    const out = evaluateCancellation(future(5), NOW);
    expect(out.status).toBe("free");
    expect(out.free).toBe(true);
    expect(out.cancellable).toBe(true);
    expect(out.hoursUntilStart).toBeCloseTo(5, 6);
  });

  it("<5h before start: too_late AND not cancellable (blocked)", () => {
    const out = evaluateCancellation(future(4.99), NOW);
    expect(out.status).toBe("too_late");
    expect(out.free).toBe(false);
    expect(out.cancellable).toBe(false);
  });

  it("well inside the window stays blocked", () => {
    const out = evaluateCancellation(future(1), NOW);
    expect(out.cancellable).toBe(false);
    expect(out.free).toBe(false);
  });
});

describe("promoBonusHours (first-purchase 1+1 trial promo)", () => {
  it("first-ever paid purchase of the group drop-in earns the +1 bonus", () => {
    expect(promoBonusHours("drop", false)).toBe(1);
  });

  it("a repeat buyer of the drop-in earns nothing", () => {
    expect(promoBonusHours("drop", true)).toBe(0);
  });

  it("no other catalog item earns the bonus, even on a first purchase", () => {
    for (const id of ["p5", "p10", "p15", "pv-drop", "pv8", "duo-drop", "trio8", "r-solo"]) {
      expect(promoBonusHours(id, false)).toBe(0);
      expect(promoBonusHours(id, true)).toBe(0);
    }
  });
});
