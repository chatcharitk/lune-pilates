// No-DB read model for the customer Profile screen (lib/customer/profile.ts —
// completeness findings C2 + H1). Runs WITHOUT a DATABASE_URL so it exercises the
// mock path the screen renders against, and pins the contract the frontend consumes:
//   - identity (name / member tier / house number) is present and server-shaped;
//   - the shared-pool balance is surfaced (single-sourced from the credit overview);
//   - housemates (H1) are listed for a member with a household, and the viewer is marked;
//   - the household-sharing rule is empty for a guest (invariant 3 — guests have no pool);
//   - purchase history is most-recent first with real (or null) prices, never invented.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getProfileOverview, sharesHousehold } from "@/lib/customer/profile";

const ORIGINAL_DB_URL = process.env.DATABASE_URL;

beforeEach(() => {
  delete process.env.DATABASE_URL; // force the no-DB mock path
});
afterEach(() => {
  if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB_URL;
});

describe("getProfileOverview — no-DB mock (member with a household)", () => {
  it("surfaces identity: name, member tier, and house number", async () => {
    const p = await getProfileOverview();
    expect(p.identity.name).toBeTruthy();
    expect(p.identity.tier).toBe("member");
    expect(p.identity.houseNumber).toBe("A-114");
    expect(p.identity.userId).toBeTruthy();
  });

  it("surfaces the shared-pool balance (present, with the household-pool flag)", async () => {
    const p = await getProfileOverview();
    expect(typeof p.balance.hours).toBe("number");
    expect(p.balance.hours).toBeGreaterThan(0);
    expect(p.balance.isHouseholdPool).toBe(true);
  });

  it("lists housemates sharing the house number, with the viewer marked (H1)", async () => {
    const p = await getProfileOverview();
    expect(p.housemates.length).toBeGreaterThanOrEqual(2);
    const viewer = p.housemates.filter((h) => h.isViewer);
    expect(viewer).toHaveLength(1);
    expect(viewer[0]!.id).toBe(p.identity.userId);
    // Every housemate carries the shape the UI renders (avatars/names/tier).
    for (const mate of p.housemates) {
      expect(mate.id).toBeTruthy();
      expect(mate.name).toBeTruthy();
      expect(["member", "guest"]).toContain(mate.tier);
    }
  });

  it("returns purchase history most-recent first with real prices (never invented)", async () => {
    const p = await getProfileOverview();
    expect(p.purchaseHistory.length).toBeGreaterThan(0);
    // Newest-first ordering.
    for (let i = 1; i < p.purchaseHistory.length; i++) {
      expect(p.purchaseHistory[i - 1]!.purchasedAt.getTime()).toBeGreaterThanOrEqual(
        p.purchaseHistory[i]!.purchasedAt.getTime(),
      );
    }
    // Each row carries a resolved catalog label, hours, and a real price.
    for (const row of p.purchaseHistory) {
      expect(row.label.en).toBeTruthy();
      expect(row.label.th).toBeTruthy();
      expect(row.hours).toBeGreaterThan(0);
      expect(row.pricePaid).toBeGreaterThan(0);
    }
  });
});

describe("sharesHousehold — invariant 3 (guests never share a pool)", () => {
  it("is true only for a member WITH a household", () => {
    expect(sharesHousehold({ tier: "member", householdId: "h1" })).toBe(true);
  });
  it("is false for a member without a household", () => {
    expect(sharesHousehold({ tier: "member", householdId: null })).toBe(false);
  });
  it("is false for a guest even if a household id is somehow present", () => {
    // Guests are non-transferable by construction (invariant 3): never a shared pool.
    expect(sharesHousehold({ tier: "guest", householdId: null })).toBe(false);
    expect(sharesHousehold({ tier: "guest", householdId: "h1" })).toBe(false);
  });
});
