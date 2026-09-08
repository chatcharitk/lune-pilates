import { describe, expect, it } from "vitest";
import { isFull, packageDebitBlock, seatsLeft } from "@/lib/credits/guards";
import { creditCostForClassType } from "@/lib/credits/cost";
import { packageCategoryForClassType } from "@/lib/credits/selectPackage";
import { evaluateCancellation } from "@/lib/credits/policy";
import { promoBonusHours } from "@/lib/credits/creditPackage";

const NOW = new Date("2026-06-01T12:00:00Z");
const future = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

describe("creditCostForClassType", () => {
  // ONE CREDIT = ONE CLASS, for every type (owner, 2026-09-08). Private/duo/trio
  // used to cost 2, which made the customer-facing numbers untrue: a "10-hour" 1:1
  // pack really bought five classes, and the 1:1/Duo/Trio drop-ins granted a single
  // credit — not enough to book the one class they were sold for.
  it.each(["group", "private", "duo", "trio", "rental"] as const)(
    "charges exactly 1 credit for a %s class",
    (type) => {
      expect(creditCostForClassType(type)).toBe(1);
    },
  );

  it("means a package's size is simply how many classes it buys", () => {
    const packSize = 10;
    const classesBookable = packSize / creditCostForClassType("private");
    expect(classesBookable).toBe(packSize);
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

describe("evaluateCancellation (fixed 6h free window)", () => {
  it("≥6h before start: free AND cancellable", () => {
    const out = evaluateCancellation(future(7), NOW);
    expect(out.status).toBe("free");
    expect(out.free).toBe(true);
    expect(out.cancellable).toBe(true);
  });

  it("exactly 6h before start: free (inclusive boundary)", () => {
    const out = evaluateCancellation(future(6), NOW);
    expect(out.status).toBe("free");
    expect(out.free).toBe(true);
    expect(out.cancellable).toBe(true);
    expect(out.hoursUntilStart).toBeCloseTo(6, 6);
  });

  it("<6h before start: too_late AND not cancellable (blocked)", () => {
    const out = evaluateCancellation(future(5.99), NOW);
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

describe("promoBonusHours (1+1 trial promo — DISABLED, owner decision 2026-07-25)", () => {
  it("a first-ever paid purchase of the group drop-in earns NO bonus (promo off)", () => {
    expect(promoBonusHours("drop", false)).toBe(0);
  });

  it("a repeat buyer of the drop-in earns nothing", () => {
    expect(promoBonusHours("drop", true)).toBe(0);
  });

  it("no catalog item earns a bonus, on a first purchase or otherwise", () => {
    for (const id of ["drop", "p5", "p10", "p15", "pv-drop", "pv8", "duo-drop", "trio8", "r-solo"]) {
      expect(promoBonusHours(id, false)).toBe(0);
      expect(promoBonusHours(id, true)).toBe(0);
    }
  });
});

// ───────────────────────── per-format balances (2026-09-08) ─────────────────────────
// Group, 1:1, Duo, Trio and Rental are SEPARATE pools: a balance can only book the
// format it was sold for. Home lists them individually rather than showing a total,
// because a customer with 5 group and 2 duo classes has no "7" they can spend.

describe("credit pools are per class format", () => {
  it("routes each class type to its own pool", () => {
    expect(packageCategoryForClassType("group")).toBe("group");
    expect(packageCategoryForClassType("private")).toBe("private");
    expect(packageCategoryForClassType("duo")).toBe("duo");
    expect(packageCategoryForClassType("trio")).toBe("trio");
    expect(packageCategoryForClassType("rental")).toBe("rental");
  });

  it("never lets one format settle against another's pool", () => {
    // The regression this guards: 1:1, Duo and Trio all mapped to "private", so a
    // ฿1,500/class 1:1 pack could pay for ฿2,000/class Trio classes.
    const formats = ["group", "private", "duo", "trio", "rental"] as const;
    for (const a of formats) {
      for (const b of formats) {
        if (a === b) continue;
        expect(packageCategoryForClassType(a)).not.toBe(packageCategoryForClassType(b));
      }
    }
  });

  it("a balance in one pool cannot cover a class of another format", () => {
    // A Duo-pool package offered against a Trio booking is simply the wrong pool —
    // selection filters on category, so it is never even a candidate.
    expect(packageCategoryForClassType("trio")).not.toBe(packageCategoryForClassType("duo"));
  });
});
