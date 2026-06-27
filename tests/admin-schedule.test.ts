// Baseline helpers + the no-DB schedule read model (the mock path the admin
// Schedule screen renders against). Pins the changes-vs-baseline diff.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BASELINE_SLOTS,
  baselineSlotsForDate,
  isoDayOfWeek,
  startOfWeekMonday,
  startsAtFor,
} from "@/lib/schedule/baseline";
import { getWeekSchedule } from "@/lib/admin/schedule";

const ORIGINAL_DB_URL = process.env.DATABASE_URL;

beforeEach(() => {
  delete process.env.DATABASE_URL; // force the no-DB mock path
});
afterEach(() => {
  if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB_URL;
});

describe("baseline helpers", () => {
  it("maps JS days to ISO weekdays (Mon=1 … Sun=7)", () => {
    expect(isoDayOfWeek(new Date("2026-06-15T00:00:00"))).toBe(1); // Monday
    expect(isoDayOfWeek(new Date("2026-06-21T00:00:00"))).toBe(7); // Sunday
  });

  it("snaps any date to the Monday of its week", () => {
    const mon = startOfWeekMonday(new Date("2026-06-17T12:00:00")); // a Wednesday
    expect(isoDayOfWeek(mon)).toBe(1);
    expect(mon.getDate()).toBe(15);
    expect(mon.getHours()).toBe(0);
  });

  it("has a group-only baseline of 28 weekly slots, 4 per day", () => {
    expect(BASELINE_SLOTS.length).toBe(28);
    expect(BASELINE_SLOTS.every((s) => s.type === "group")).toBe(true);
    expect(baselineSlotsForDate(new Date("2026-06-15T00:00:00")).length).toBe(4); // Mon
    expect(baselineSlotsForDate(new Date("2026-06-21T00:00:00")).length).toBe(4); // Sun
  });

  it("builds the correct local start instant for a slot", () => {
    const d = startsAtFor(new Date("2026-06-15T00:00:00"), "16:30");
    expect(d.getHours()).toBe(16);
    expect(d.getMinutes()).toBe(30);
    expect(d.getDate()).toBe(15);
  });
});

describe("getWeekSchedule (no-DB mock)", () => {
  const anchor = new Date("2026-06-17T12:00:00"); // Wednesday → week of Mon 15 Jun

  it("returns 7 Mon..Sun days anchored to the week's Monday", async () => {
    const wk = await getWeekSchedule(anchor);
    expect(wk.days.length).toBe(7);
    expect(isoDayOfWeek(new Date(wk.weekStart))).toBe(1);
    expect(wk.days.map((d) => d.dayOfWeek)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // each day's classes are sorted by start time
    for (const d of wk.days) {
      const sorted = [...d.classes].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      expect(d.classes).toEqual(sorted);
    }
  });

  it("materialises 28 baseline slots + 2 appointments and partitions draft/published", async () => {
    const wk = await getWeekSchedule(anchor);
    const total = wk.days.reduce((a, d) => a + d.classes.length, 0);
    expect(total).toBe(30); // 28 group baseline + 2 appointment classes
    expect(wk.draftCount + wk.publishedCount).toBe(total);
    expect(wk.draftCount).toBeGreaterThan(0); // Monday + appointments are draft
  });

  it("diffs the two appointment classes as additions vs the baseline", async () => {
    const wk = await getWeekSchedule(anchor);
    // All baseline group slots are present → nothing removed/changed; the Duo and
    // Private appointments sit outside the baseline → 2 added.
    expect(wk.diff).toEqual({ added: 2, removed: 0, changed: 0 });
  });
});
