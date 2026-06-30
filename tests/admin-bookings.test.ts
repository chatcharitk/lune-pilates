// No-DB fallback + pure helpers for the admin "Bookings & waitlist control" read
// model. Runs without DATABASE_URL so it exercises the mock path the screen renders
// against, and pins the cancellation-policy boundary (exactly 5h), the lazy expiry
// of stale waitlist offers, and the minutes-left countdown.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getAdminBookings,
  getAdminBookingsOverview,
  getAdminWaitlist,
  toAdminBooking,
  toAdminWaitlistEntry,
  type AdminBookingRow,
  type AdminWaitlistRow,
} from "@/lib/admin/bookings";
import { studioParts } from "@/lib/time";

const ORIGINAL_DB_URL = process.env.DATABASE_URL;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeEach(() => {
  // Force the no-DB mock path regardless of the dev environment.
  delete process.env.DATABASE_URL;
});
afterEach(() => {
  if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB_URL;
});

const now = new Date("2026-06-20T06:00:00+07:00"); // 06:00 local on the mock day

// A reusable booking row builder, defaulting to a live upcoming group booking.
function bookingRow(over: Partial<AdminBookingRow> = {}): AdminBookingRow {
  return {
    bookingId: "00000000-0000-4000-8000-000000000001",
    userId: "00000000-0000-4000-8000-0000000000a1",
    customerName: "Pim Srisai",
    customerPhone: "081 234 5678",
    isMember: true,
    house: "A-114",
    classInstanceId: "ci-1",
    type: "group",
    startsAt: new Date(now.getTime() + 8 * 3_600_000), // 8h out → free
    instructorId: null,
    instructorName: null,
    instructorNameTh: null,
    instructorTag: null,
    status: "booked",
    checkedInAt: null,
    creditCost: 1,
    freeCancelHours: 5,
    ...over,
  };
}

function waitlistRow(over: Partial<AdminWaitlistRow> = {}): AdminWaitlistRow {
  return {
    waitlistId: "w-1",
    userId: "u-1",
    name: "Mind Arunee",
    phone: "081 778 5512",
    isMember: false,
    position: 1,
    status: "waiting",
    holdExpiresAt: null,
    ...over,
  };
}

describe("toAdminBooking (pure)", () => {
  it("an upcoming booking well outside the window is a free cancel (refunds the cost)", () => {
    const b = toAdminBooking(bookingRow({ creditCost: 2, type: "private" }), now);
    expect(b.upcoming).toBe(true);
    expect(b.cancellation).not.toBeNull();
    expect(b.cancellation!.free).toBe(true);
    expect(b.cancellation!.refundCredits).toBe(2); // the exact cost, not a hardcoded 1
    expect(b.cancellation!.freeCancelHours).toBe(5);
  });

  it("is FREE exactly at the 5h boundary (inclusive)", () => {
    // starts exactly 5h after now, window = 5 → hoursUntilStart === freeCancelHours.
    const b = toAdminBooking(
      bookingRow({ startsAt: new Date(now.getTime() + 5 * 3_600_000) }),
      now,
    );
    expect(b.cancellation!.free).toBe(true);
    expect(b.cancellation!.hoursUntilStart).toBeCloseTo(5, 6);
    expect(b.cancellation!.refundCredits).toBe(1);
  });

  it("is NOT free just inside the window (refund withheld)", () => {
    const b = toAdminBooking(
      bookingRow({ startsAt: new Date(now.getTime() + 4.99 * 3_600_000) }),
      now,
    );
    expect(b.cancellation!.free).toBe(false);
    expect(b.cancellation!.refundCredits).toBe(0); // cost kept
  });

  it("a 2h-out booking is NOT free under the fixed 5h window", () => {
    // The fixed-window policy ignores the stamped freeCancelHours for the verdict:
    // 2h out (< 5h) is always inside the window → not free, cost kept.
    const b = toAdminBooking(
      bookingRow({ startsAt: new Date(now.getTime() + 2 * 3_600_000) }),
      now,
    );
    expect(b.cancellation!.free).toBe(false);
    expect(b.cancellation!.refundCredits).toBe(0);
  });

  it("a past booking carries no cancellation (nothing to cancel)", () => {
    const b = toAdminBooking(
      bookingRow({ startsAt: new Date(now.getTime() - 3 * 3_600_000) }),
      now,
    );
    expect(b.upcoming).toBe(false);
    expect(b.cancellation).toBeNull();
  });

  it("a cancelled booking carries no cancellation regardless of time", () => {
    const b = toAdminBooking(bookingRow({ status: "cancelled" }), now);
    expect(b.upcoming).toBe(false);
    expect(b.cancellation).toBeNull();
  });

  it("derives checkedIn from the timestamp, never a separate flag", () => {
    expect(toAdminBooking(bookingRow({ checkedInAt: now }), now).checkedIn).toBe(true);
    expect(toAdminBooking(bookingRow({ checkedInAt: null }), now).checkedIn).toBe(false);
  });
});

describe("toAdminWaitlistEntry (pure)", () => {
  it("a live offer surfaces its hold deadline + whole minutes left (ceil)", () => {
    const hold = new Date(now.getTime() + 22 * 60_000 + 30_000); // 22m30s left
    const e = toAdminWaitlistEntry(waitlistRow({ status: "offered", holdExpiresAt: hold }), now);
    expect(e.status).toBe("offered");
    expect(e.holdExpiresAt).toBe(hold.toISOString());
    expect(e.minutesLeft).toBe(23); // ceil of 22.5
  });

  it("a stale offer past its hold reads as a re-offerable waiting head (lazy expiry)", () => {
    const hold = new Date(now.getTime() - 60_000); // expired 1m ago
    const e = toAdminWaitlistEntry(waitlistRow({ status: "offered", holdExpiresAt: hold }), now);
    expect(e.status).toBe("waiting"); // not a dead "expired", not a live "offered"
    expect(e.holdExpiresAt).toBeNull();
    expect(e.minutesLeft).toBeNull();
  });

  it("a plain waiting row has no countdown", () => {
    const e = toAdminWaitlistEntry(waitlistRow({ status: "waiting", holdExpiresAt: null }), now);
    expect(e.status).toBe("waiting");
    expect(e.minutesLeft).toBeNull();
  });

  it("carries member/guest and FIFO position through", () => {
    const e = toAdminWaitlistEntry(waitlistRow({ isMember: true, position: 3 }), now);
    expect(e.isMember).toBe(true);
    expect(e.position).toBe(3);
  });
});

describe("getAdminBookingsOverview (no-DB mock)", () => {
  it("returns both tabs in one fetch", async () => {
    const ov = await getAdminBookingsOverview({}, now);
    expect(Array.isArray(ov.bookings)).toBe(true);
    expect(Array.isArray(ov.waitlist)).toBe(true);
    expect(ov.bookings.length).toBeGreaterThan(0);
    expect(ov.waitlist.length).toBeGreaterThan(0);
  });

  it("default scope keeps today + upcoming, ordered by class start then id", async () => {
    const list = await getAdminBookings({}, now);
    // No past bookings remain in the default scope (all mock seeds are today+).
    for (const b of list) {
      expect(new Date(b.class.startsAt).getTime()).toBeGreaterThanOrEqual(
        new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(),
      );
    }
    const sorted = [...list].sort(
      (a, b) =>
        new Date(a.class.startsAt).getTime() - new Date(b.class.startsAt).getTime() ||
        a.bookingId.localeCompare(b.bookingId),
    );
    expect(list).toEqual(sorted);
  });

  it("mock booking ids are valid, unique UUIDs (so the cancel action's gate passes)", async () => {
    const list = await getAdminBookings({ scope: "all" }, now);
    const ids = new Set<string>();
    for (const b of list) {
      expect(b.bookingId).toMatch(UUID_RE);
      expect(ids.has(b.bookingId)).toBe(false);
      ids.add(b.bookingId);
    }
  });

  it("filters by status", async () => {
    const booked = await getAdminBookings({ scope: "all", status: "booked" }, now);
    expect(booked.length).toBeGreaterThan(0);
    expect(booked.every((b) => b.status === "booked")).toBe(true);
  });

  it("filters by a single day", async () => {
    // The mock bookings are anchored to `now`'s BANGKOK day, so derive the filter
    // day from Bangkok parts (TZ-independent — must hold under default + TZ=UTC).
    const np = studioParts(now);
    const today = `${np.year}-${String(np.month0 + 1).padStart(2, "0")}-${String(np.day).padStart(2, "0")}`;
    const list = await getAdminBookings({ day: today }, now);
    expect(list.length).toBeGreaterThan(0);
    for (const b of list) {
      expect(studioParts(new Date(b.class.startsAt)).day).toBe(np.day);
    }
    // A day with no mock classes yields an empty list (not an error).
    expect(await getAdminBookings({ day: "2020-01-01" }, now)).toEqual([]);
  });

  it("group waitlist by full class, FIFO, with the head holding a live offer", async () => {
    const groups = await getAdminWaitlist(now);
    const card = groups[0]!;
    expect(card.entries.length).toBeGreaterThanOrEqual(2);
    expect(card.entries[0]!.position).toBe(1);
    expect(card.entries[0]!.status).toBe("offered"); // head notified
    expect(card.entries[0]!.minutesLeft).toBeGreaterThan(0);
    expect(card.entries[1]!.status).toBe("waiting"); // the rest still queued
    expect(card.entries[1]!.minutesLeft).toBeNull();
    // entries are FIFO by position
    const positions = card.entries.map((e) => e.position);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
