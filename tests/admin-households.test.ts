import { describe, expect, it } from "vitest";
import { shapeHousehold, type HouseholdPackage } from "@/lib/admin/households";

const now = new Date("2026-10-05T05:00:00Z");
const pkg = (over: Partial<HouseholdPackage>): HouseholdPackage => ({
  id: "p",
  label: { en: "x", th: "x" },
  category: "group",
  partySize: null,
  hoursLeft: 1,
  hoursTotal: 1,
  expiresAt: "2026-11-01T00:00:00.000Z",
  ...over,
});

describe("shapeHousehold", () => {
  it("sums usable classes per type and finds the soonest expiry", () => {
    const h = shapeHousehold(
      { id: "h", houseNumber: "1/1" },
      [],
      [
        pkg({ id: "a", hoursLeft: 4 }),
        pkg({ id: "b", category: "private", hoursLeft: 2, expiresAt: "2026-10-20T00:00:00.000Z" }),
        pkg({ id: "c", hoursLeft: 3 }),
      ],
      now,
    );
    expect(h.balance).toBe(9);
    expect(h.byCategory).toEqual([
      { category: "group", hours: 7 },
      { category: "private", hours: 2 },
    ]);
    expect(h.expiry).toBe("2026-10-20T00:00:00.000Z");
    expect(h.expiringSoon).toBe(false);
  });

  it("lists a not-yet-started bundle part but does not count it as usable", () => {
    const h = shapeHousehold(
      { id: "h", houseNumber: "1/1" },
      [],
      [pkg({ id: "a", hoursLeft: 1, expiresAt: "2026-10-08T00:00:00.000Z" }), pkg({ id: "b", expiresAt: null })],
      now,
    );
    expect(h.balance).toBe(1);
    expect(h.expiringSoon).toBe(true);
    expect(h.packages.map((p) => p.id)).toEqual(["a", "b"]);
  });
});
