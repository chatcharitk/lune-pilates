// No-DB fallback for the admin "Today at a glance" read model. Runs without
// DATABASE_URL so it exercises the mock path the screen renders against, and
// pins the stat-tile roll-up + roster/waitlist shaping.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTodayOverview } from "@/lib/admin/today";
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

describe("getTodayOverview (no-DB mock)", () => {
  const now = new Date("2026-06-20T12:00:00+07:00");

  it("anchors every class to the requested day", async () => {
    const { date, classes } = await getTodayOverview(now);
    expect(classes.length).toBe(5);
    // header date is Bangkok midnight of `now`'s Bangkok day (TZ-independent)
    expect(studioParts(new Date(date)).day).toBe(20);
    for (const c of classes) {
      expect(studioParts(new Date(c.startsAt)).day).toBe(20);
      // endsAt = startsAt + durationMin
      expect(new Date(c.endsAt).getTime() - new Date(c.startsAt).getTime()).toBe(
        c.durationMin * 60_000,
      );
    }
  });

  it("rolls up the stat tiles from the assembled classes", async () => {
    const { stats, classes } = await getTodayOverview(now);

    const attendees = classes.reduce((a, c) => a + c.booked, 0);
    const capacity = classes.reduce((a, c) => a + c.capacity, 0);
    const checkedIn = classes.reduce((a, c) => a + c.checkedIn, 0);
    const waitlisted = classes.reduce((a, c) => a + c.waitlist.length, 0);

    expect(stats.classes).toBe(5);
    expect(stats.attendees).toBe(attendees); // 11
    expect(stats.capacity).toBe(capacity); // 12
    expect(stats.checkedIn).toBe(checkedIn); // 2 pre-checked in the mock
    expect(stats.waitlisted).toBe(waitlisted); // 2
    expect(stats.utilisation).toBe(Math.round((attendees / capacity) * 100)); // 92
  });

  it("shapes rosters with UUID booking ids so check-in passes validation", async () => {
    const { classes } = await getTodayOverview(now);
    const ids = new Set<string>();
    for (const c of classes) {
      expect(c.booked).toBe(c.roster.length);
      expect(c.checkedIn).toBe(c.roster.filter((r) => r.checkedIn).length);
      for (const a of c.roster) {
        // Mock booking ids must be valid UUIDs — the setCheckIn action validates
        // them, and the no-DB optimistic toggle would revert otherwise.
        expect(a.bookingId).toMatch(UUID_RE);
        expect(ids.has(a.bookingId)).toBe(false); // unique across the day
        ids.add(a.bookingId);
      }
    }
  });

  it("marks the head of a waitlist as offered (live hold)", async () => {
    const { classes } = await getTodayOverview(now);
    const withWaitlist = classes.find((c) => c.waitlist.length > 0);
    expect(withWaitlist).toBeDefined();
    const queue = withWaitlist!.waitlist;
    expect(queue[0]?.offered).toBe(true); // head holds the offer
    expect(queue[0]?.position).toBe(1);
    expect(queue[1]?.offered).toBe(false); // the rest are still waiting
  });

  it("scopes to a single instructor when given instructorId (and stats reflect it)", async () => {
    // The mock day has two 'mai' classes (t1, t4); an instructor session passes
    // their slug so they only see — and the stats only count — their own classes.
    const all = await getTodayOverview(now);
    const mai = await getTodayOverview(now, { instructorId: "mai" });

    expect(mai.classes.length).toBeGreaterThan(0);
    expect(mai.classes.length).toBeLessThan(all.classes.length);
    // Every returned class belongs to the scoped instructor.
    for (const c of mai.classes) {
      expect(c.instructor?.id).toBe("mai");
    }

    // Stats reflect ONLY the filtered set (recomputed from the scoped classes).
    expect(mai.stats.classes).toBe(mai.classes.length);
    expect(mai.stats.attendees).toBe(mai.classes.reduce((a, c) => a + c.booked, 0));
    expect(mai.stats.capacity).toBe(mai.classes.reduce((a, c) => a + c.capacity, 0));
    expect(mai.stats.waitlisted).toBe(mai.classes.reduce((a, c) => a + c.waitlist.length, 0));
    // And the scoped set is a strict subset of the full day's counts.
    expect(mai.stats.attendees).toBeLessThan(all.stats.attendees);
  });
});
