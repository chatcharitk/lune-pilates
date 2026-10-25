import { describe, expect, it } from "vitest";
import { foldLimitGroups, withinPurchaseLimit } from "@/lib/catalog/eligibility";

describe("foldLimitGroups — one trial of ANY type", () => {
  const items = [
    { id: "trial-group", limitGroup: "trial" },
    { id: "trial-priv", limitGroup: "trial" },
    { id: "trial-duo", limitGroup: "trial" },
    { id: "bogo-group" }, // its own allowance
  ];

  it("gives every item in the group the group's total", () => {
    const folded = foldLimitGroups(items, new Map([["trial-group", 1]]));
    expect(folded.get("trial-priv")).toBe(1);
    expect(folded.get("trial-duo")).toBe(1);
    expect(withinPurchaseLimit({ maxPerCustomer: 1 }, folded.get("trial-priv")!)).toBe(false);
  });

  it("leaves an ungrouped item counting only itself", () => {
    const folded = foldLimitGroups(items, new Map([["trial-group", 1]]));
    expect(folded.get("bogo-group")).toBe(0);
  });
});
