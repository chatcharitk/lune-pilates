import { describe, expect, it } from "vitest";
import { isFull, packageDebitBlock, seatsLeft } from "@/lib/credits/guards";
import { creditCostForClassType } from "@/lib/credits/cost";
import { evaluateCancellation } from "@/lib/credits/policy";
import {
  FREE_CANCEL_HOURS,
  LAST_MINUTE_FREE_CANCEL_HOURS,
  freeCancelHoursFor,
} from "@/lib/domain/types";

const NOW = new Date("2026-06-01T12:00:00Z");
const future = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

describe("creditCostForClassType", () => {
  it("charges 1 credit for a group class", () => {
    expect(creditCostForClassType("group")).toBe(1);
  });
  it("charges 1.5 credits for private, duo and trio", () => {
    expect(creditCostForClassType("private")).toBe(1.5);
    expect(creditCostForClassType("duo")).toBe(1.5);
    expect(creditCostForClassType("trio")).toBe(1.5);
  });
  it("charges 1 credit for a rental (under review)", () => {
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
  it("allows a 1.5-cost debit when the balance exactly covers it", () => {
    expect(packageDebitBlock({ hoursLeft: 1.5, expiresAt: future(24) }, 1.5, NOW)).toBeNull();
  });
  it("blocks a 1.5-cost debit when the balance is only 1.0", () => {
    expect(packageDebitBlock({ hoursLeft: 1, expiresAt: future(24) }, 1.5, NOW)).toBe("NO_CREDITS");
  });
  it("blocks when expired regardless of cost (expiry checked before balance)", () => {
    expect(packageDebitBlock({ hoursLeft: 5, expiresAt: future(-1) }, 1.5, NOW)).toBe("EXPIRED");
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

describe("freeCancelHoursFor (window locked at booking time)", () => {
  it("locks the 5h window when booked ≥5h ahead", () => {
    expect(freeCancelHoursFor(future(6), NOW)).toBe(FREE_CANCEL_HOURS); // 5
    expect(freeCancelHoursFor(future(48), NOW)).toBe(5);
  });
  it("locks the 1h last-minute window when booked <5h ahead", () => {
    expect(freeCancelHoursFor(future(4.99), NOW)).toBe(LAST_MINUTE_FREE_CANCEL_HOURS); // 1
    expect(freeCancelHoursFor(future(0.5), NOW)).toBe(1);
  });
  it("treats exactly 5h lead time as the 5h window (boundary, inclusive)", () => {
    expect(freeCancelHoursFor(future(5), NOW)).toBe(5);
  });
});

describe("evaluateCancellation (dynamic free window, judged vs booking's locked hours)", () => {
  // 5-hour window bookings (booked well ahead).
  it("5h window: free outside the window", () => {
    expect(evaluateCancellation(future(6), NOW, 5).free).toBe(true);
  });
  it("5h window: free at exactly 5 hours before (inclusive boundary)", () => {
    expect(evaluateCancellation(future(5), NOW, 5).free).toBe(true);
  });
  it("5h window: not free inside the window", () => {
    expect(evaluateCancellation(future(4.99), NOW, 5).free).toBe(false);
  });

  // 1-hour window bookings (last-minute) — the SAME 4h-out booking that is locked
  // to a 5h window is NOT free, but locked to a 1h window IS free.
  it("1h window: still free 4h out (inside what would be the 5h window)", () => {
    expect(evaluateCancellation(future(4), NOW, 1).free).toBe(true);
  });
  it("1h window: free at exactly 1 hour before (inclusive boundary)", () => {
    expect(evaluateCancellation(future(1), NOW, 1).free).toBe(true);
  });
  it("1h window: not free inside the 1h window", () => {
    expect(evaluateCancellation(future(0.99), NOW, 1).free).toBe(false);
  });

  // The window the booking carries is what decides free/late for the same lead.
  it("same 4h-out lead is late under a 5h window but free under a 1h window", () => {
    expect(evaluateCancellation(future(4), NOW, 5).free).toBe(false);
    expect(evaluateCancellation(future(4), NOW, 1).free).toBe(true);
  });
});
