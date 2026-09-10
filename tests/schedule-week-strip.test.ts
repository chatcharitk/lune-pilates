// The customer schedule's week strip (components/customer/schedule-helpers.ts).
//
// The current week used to be anchored to TODAY, which meant the calendar rendered
// as a stub — mid-week a customer saw a 4-day row with dead space where Monday to
// Wednesday should be (owner-reported, 2026-09-10). It also quietly hid classes:
// the query window is [weekStart, +7d) while the chips match on DAY-OF-WEEK, so a
// today-anchored week reached into the next one and those overflow days collided
// with this week's early weekday numbers.
//
// Both are now anchored to Bangkok Monday. These tests pin that, and the fact that
// past days are still SHOWN (so the row reads as a week) but not selectable.

import { describe, expect, it } from "vitest";
import {
  scheduleDefaultDay,
  scheduleWeekDays,
  scheduleWeekStart,
  weekRangeLabel,
} from "@/components/customer/schedule-helpers";
import { studioInstant, studioIsoDow, studioParts } from "@/lib/time";

// Thursday 10 Sep 2026, 10:51 Bangkok — the day the owner reported it from.
const THU = studioInstant(2026, 8, 10, 10, 51);

describe("the week strip is always a full Mon–Sun", () => {
  it("shows seven days in the CURRENT week, not just the remaining ones", () => {
    const days = scheduleWeekDays(0, THU);
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.date)).toEqual([7, 8, 9, 10, 11, 12, 13]);
    expect(days.map((d) => d.d)).toEqual([1, 2, 3, 4, 5, 6, 7]); // Mon…Sun
  });

  it("marks the days before today as past, and only those", () => {
    const days = scheduleWeekDays(0, THU);
    expect(days.filter((d) => d.past).map((d) => d.date)).toEqual([7, 8, 9]);
    expect(days.find((d) => d.today)?.date).toBe(10);
    expect(days.find((d) => d.date === 10)?.past).toBeUndefined();
  });

  it("anchors the query window to Monday so it cannot spill into next week", () => {
    // [weekStart, +7d) must end exactly at the following Monday: any later class
    // would share a weekday number with a chip in THIS week and be unreachable.
    const start = scheduleWeekStart(0, THU);
    expect(studioIsoDow(start)).toBe(1);
    const p = studioParts(start);
    expect([p.year, p.month0 + 1, p.day]).toEqual([2026, 9, 7]);
  });

  it("labels the whole week, matching the chips", () => {
    expect(weekRangeLabel(0, THU).en).toBe("7–13 Sept");
  });

  it("opens on TODAY in the current week", () => {
    expect(scheduleDefaultDay(0, THU)).toBe(4); // Thursday
  });

  it.each([
    ["Monday", studioInstant(2026, 8, 7, 9, 0), 1, []],
    ["Sunday", studioInstant(2026, 8, 13, 21, 0), 7, [7, 8, 9, 10, 11, 12]],
  ] as const)(
    "still shows the full week when today is %s",
    (_label, now, expectedDefault, expectedPast) => {
      const days = scheduleWeekDays(0, now);
      expect(days).toHaveLength(7);
      expect(days.map((d) => d.date)).toEqual([7, 8, 9, 10, 11, 12, 13]);
      expect(days.filter((d) => d.past).map((d) => d.date)).toEqual([...expectedPast]);
      expect(scheduleDefaultDay(0, now)).toBe(expectedDefault);
    },
  );
});

describe("future weeks", () => {
  it("are a clean Mon–Sun with nothing greyed out", () => {
    const days = scheduleWeekDays(1, THU);
    expect(days.map((d) => d.date)).toEqual([14, 15, 16, 17, 18, 19, 20]);
    expect(days.some((d) => d.past)).toBe(false);
    expect(days.some((d) => d.today)).toBe(false);
  });

  it("open on Monday", () => {
    expect(scheduleDefaultDay(1, THU)).toBe(1);
  });

  it("step exactly one week per offset", () => {
    for (const offset of [1, 2, 3, 4, 5]) {
      const start = scheduleWeekStart(offset, THU);
      expect(studioIsoDow(start)).toBe(1);
      expect(start.getTime() - scheduleWeekStart(0, THU).getTime()).toBe(
        offset * 7 * 24 * 3_600_000,
      );
    }
  });

  it("never anchors into the past, even for a negative offset", () => {
    expect(scheduleWeekStart(-3, THU).getTime()).toBe(scheduleWeekStart(0, THU).getTime());
  });
});
