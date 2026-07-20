// No-DB fallback + pure helpers for the "My Bookings" read model. These run
// without DATABASE_URL so they exercise the mock path the UI renders against,
// plus the pure `toMyBooking` shaping helper (the 5-hour cancellation policy is
// computed server-side here — CLAUDE.md §5, invariant 7).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PAST_BOOKINGS_LIMIT,
  getNextBooking,
  listMyBookings,
  toMyBooking,
  type BookingRow,
} from "@/lib/bookings/queries";
import type { SessionUser } from "@/lib/auth/session";

const ORIGINAL_DB_URL = process.env.DATABASE_URL;

beforeEach(() => {
  // Force the no-DB mock path regardless of the dev environment.
  delete process.env.DATABASE_URL;
});

afterEach(() => {
  if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB_URL;
});

const VIEWER: SessionUser = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Pim",
  tier: "member",
  householdId: "00000000-0000-4000-8000-0000000000a1",
  houseNumber: "A-114",
};

const NOW = new Date("2026-06-19T10:00:00+07:00");

function baseRow(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    bookingId: "bx",
    classInstanceId: "cx",
    type: "group",
    startsAt: new Date("2026-06-19T18:00:00+07:00"),
    durationMin: 60,
    instructorId: null,
    instructorName: null,
    instructorNameTh: null,
    instructorTag: null,
    position: "left",
    creditCost: 1,
    freeCancelHours: 5,
    status: "booked",
    ...overrides,
  };
}

describe("toMyBooking (pure shaping)", () => {
  it("computes a FREE cancellation outside the 5-hour window and refunds the exact cost", () => {
    // 8 hours before start → free; a 2-credit private refunds 2, not a hardcoded 1.
    const row = baseRow({
      type: "private",
      creditCost: 2,
      startsAt: new Date(NOW.getTime() + 8 * 3_600_000),
    });
    const b = toMyBooking(row, NOW);
    expect(b.cancellation.free).toBe(true);
    expect(b.cancellation.hoursUntilStart).toBeCloseTo(8, 5);
    expect(b.cancellation.refundCredits).toBe(2);
    expect(b.creditCost).toBe(2);
    expect(b.typeMeta.label.en).toBe("Private 1:1");
  });

  it("computes a NON-FREE cancellation inside the window with a zero refund", () => {
    // 4 hours before start → inside the 5-hour window → cost kept.
    const row = baseRow({ startsAt: new Date(NOW.getTime() + 4 * 3_600_000) });
    const b = toMyBooking(row, NOW);
    expect(b.cancellation.free).toBe(false);
    expect(b.cancellation.refundCredits).toBe(0);
  });

  it("treats exactly 6 hours before start as FREE (boundary, inclusive)", () => {
    const row = baseRow({ startsAt: new Date(NOW.getTime() + 6 * 3_600_000) });
    const b = toMyBooking(row, NOW);
    expect(b.cancellation.free).toBe(true);
    expect(b.cancellation.hoursUntilStart).toBeCloseTo(6, 5);
    // The FIELD echoes the booking's stamped audit value (the fixture's 5); the FREE
    // verdict above uses the current fixed window (6h) independently of the stamp.
    expect(b.cancellation.freeCancelHours).toBe(5);
  });

  it("judges by the FIXED 6h window, ignoring a booking's stamped hours: NOT free 5h out", () => {
    // The policy is a single fixed 6h window (CLAUDE.md §5 inv 7, widened 2026-07-20):
    // 5h out is inside the window → not free, regardless of the stamped audit value.
    const row = baseRow({
      freeCancelHours: 1,
      startsAt: new Date(NOW.getTime() + 5 * 3_600_000),
    });
    const b = toMyBooking(row, NOW);
    expect(b.cancellation.free).toBe(false);
    expect(b.cancellation.refundCredits).toBe(0);
  });

  it("is NOT free well inside the fixed 5h window (0.5h out)", () => {
    const row = baseRow({
      startsAt: new Date(NOW.getTime() + 0.5 * 3_600_000),
    });
    const b = toMyBooking(row, NOW);
    expect(b.cancellation.free).toBe(false);
    expect(b.cancellation.refundCredits).toBe(0);
  });

  it("carries bilingual instructor metadata through from a DB row", () => {
    const row = baseRow({
      instructorId: "mai",
      instructorName: "Kru Mai",
      instructorNameTh: "ครูใหม่",
      instructorTag: "Founder",
    });
    const b = toMyBooking(row, NOW);
    expect(b.instructor?.name.en).toBe("Kru Mai");
    expect(b.instructor?.name.th).toBeTruthy();
  });
});

describe("listMyBookings (no-DB mock)", () => {
  it("splits into upcoming (soonest first) and past (most recent first)", async () => {
    const { upcoming, past } = await listMyBookings(VIEWER, NOW);

    expect(upcoming.length).toBeGreaterThan(0);
    expect(past.length).toBeGreaterThan(0);

    // upcoming: every row booked + in the future, sorted ascending by start.
    for (const b of upcoming) {
      expect(b.status).toBe("booked");
      expect(new Date(b.startsAt).getTime()).toBeGreaterThan(NOW.getTime());
    }
    const upSorted = [...upcoming].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    expect(upcoming).toEqual(upSorted);

    // past: most recent first (descending by start).
    const pastSorted = [...past].sort((a, b) => b.startsAt.localeCompare(a.startsAt));
    expect(past).toEqual(pastSorted);
  });

  it("puts a cancelled booking in past regardless of its time", async () => {
    const { past } = await listMyBookings(VIEWER, NOW);
    expect(past.some((b) => b.status === "cancelled")).toBe(true);
  });

  it("caps past at PAST_BOOKINGS_LIMIT", async () => {
    const { past } = await listMyBookings(VIEWER, NOW);
    expect(past.length).toBeLessThanOrEqual(PAST_BOOKINGS_LIMIT);
  });
});

describe("getNextBooking (no-DB mock)", () => {
  it("returns the single soonest upcoming booking", async () => {
    const { upcoming } = await listMyBookings(VIEWER, NOW);
    const next = await getNextBooking(VIEWER, NOW);
    expect(next).not.toBeNull();
    expect(next?.bookingId).toBe(upcoming[0]?.bookingId);
  });

  it("returns the same shape as the head of listMyBookings.upcoming", async () => {
    // The mock seeds the upcoming booking relative to `now` so the dev screen
    // always shows a 'today' class; next must match the list head exactly.
    const { upcoming } = await listMyBookings(VIEWER, NOW);
    const next = await getNextBooking(VIEWER, NOW);
    expect(next).toEqual(upcoming[0] ?? null);
  });
});
