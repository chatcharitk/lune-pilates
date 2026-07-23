// Pure studio-rental rules (lib/schedule/rental.ts): the monthly-release booking
// window and the in-memory rental-scoped room-overlap helper.
//
// The window boundary is pinned as ABSOLUTE instants (which encode the Bangkok
// wall-clock boundary: Aug 1 00:00 Bangkok == Jul 31 17:00 UTC), so the assertions
// hold identically under TZ=UTC and any other runtime timezone — the helpers use the
// fixed-offset Bangkok math in lib/time.ts and never read the host clock. The suite is
// run twice below, once with process.env.TZ forced to UTC and once left at default,
// mirroring the Bangkok-pinning discipline in tests/time.test.ts.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isRentalBookingOpen,
  rentalBookingOpensAt,
  rentalRoomOverlap,
} from "@/lib/schedule/rental";
import { studioInstant } from "@/lib/time";

function windowSuite(label: string) {
  describe(`rental booking window (${label})`, () => {
    // A rental class starting mid-September 2026 (Bangkok time).
    const septSlot = studioInstant(2026, 8, 15, 9, 0);

    it("opens at 00:00 Bangkok on the 1st of the month BEFORE the start month (Aug 1)", () => {
      // Aug 1 2026 00:00 Bangkok == 2026-07-31T17:00:00Z.
      expect(rentalBookingOpensAt(septSlot).toISOString()).toBe("2026-07-31T17:00:00.000Z");
    });

    it("is LOCKED on Jul 31 (one minute before the window opens)", () => {
      const jul31 = studioInstant(2026, 6, 31, 23, 59);
      expect(isRentalBookingOpen(septSlot, jul31)).toBe(false);
    });

    it("is OPEN exactly at Aug 1 00:00 Bangkok (inclusive boundary)", () => {
      const aug1 = studioInstant(2026, 7, 1, 0, 0);
      expect(isRentalBookingOpen(septSlot, aug1)).toBe(true);
    });

    it("is still OPEN on Aug 20", () => {
      const aug20 = studioInstant(2026, 7, 20, 12, 0);
      expect(isRentalBookingOpen(septSlot, aug20)).toBe(true);
    });

    it("crosses the year boundary: a January slot opens on the prior December 1", () => {
      const janSlot = studioInstant(2026, 0, 10, 9, 0); // 10 Jan 2026
      // Dec 1 2025 00:00 Bangkok == 2025-11-30T17:00:00Z.
      expect(rentalBookingOpensAt(janSlot).toISOString()).toBe("2025-11-30T17:00:00.000Z");
      const nov30 = studioInstant(2025, 10, 30, 23, 59);
      const dec1 = studioInstant(2025, 11, 1, 0, 0);
      expect(isRentalBookingOpen(janSlot, nov30)).toBe(false);
      expect(isRentalBookingOpen(janSlot, dec1)).toBe(true);
    });
  });
}

windowSuite("default TZ");

describe("rental booking window (TZ=UTC)", () => {
  const original = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "UTC";
  });
  afterAll(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });
  windowSuite("forced UTC");
});

describe("rentalRoomOverlap (pure, rental-scoped)", () => {
  const at = (h: number, dur: number, type: "group" | "rental") => ({
    startsAt: studioInstant(2026, 8, 15, h, 0),
    durationMin: dur,
    type,
  });

  it("two overlapping RENTALS conflict", () => {
    expect(rentalRoomOverlap(at(9, 90, "rental"), at(10, 60, "rental"))).toBe(true);
  });

  it("a rental overlapping a group class conflicts (either direction)", () => {
    expect(rentalRoomOverlap(at(9, 90, "rental"), at(10, 60, "group"))).toBe(true);
    expect(rentalRoomOverlap(at(10, 60, "group"), at(9, 90, "rental"))).toBe(true);
  });

  it("two NON-rental classes never conflict (no global no-overlap)", () => {
    expect(rentalRoomOverlap(at(9, 90, "group"), at(10, 60, "group"))).toBe(false);
  });

  it("adjacent (touching, non-overlapping) intervals do NOT conflict", () => {
    // 09:00–10:00 rental and 10:00–11:00 anything share only the boundary instant.
    expect(rentalRoomOverlap(at(9, 60, "rental"), at(10, 60, "group"))).toBe(false);
  });
});
