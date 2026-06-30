// Proves the studio time helpers are pinned to Bangkok (UTC+7, no DST) and are
// INDEPENDENT of the runtime timezone — this suite MUST pass under both the
// default TZ and `TZ=UTC` (the runtime-independence proof). Every assertion uses
// absolute UTC instants so the expectations are unambiguous.

import { describe, expect, it } from "vitest";
import {
  STUDIO_TZ,
  addDays,
  formatStudioDate,
  formatStudioTime,
  studioDayFromYmd,
  studioInstant,
  studioIsoDow,
  studioParts,
  studioStartOfDay,
  studioStartOfWeekMonday,
} from "@/lib/time";

describe("studioInstant", () => {
  it("maps a Bangkok wall-clock to the correct UTC instant (09:00 ICT = 02:00Z)", () => {
    // monthIndex 5 = June.
    expect(studioInstant(2026, 5, 28, 9, 0).toISOString()).toBe("2026-06-28T02:00:00.000Z");
  });

  it("handles a Bangkok day that crosses the UTC date line (00:00 ICT = prev 17:00Z)", () => {
    expect(studioInstant(2026, 5, 28, 0, 0).toISOString()).toBe("2026-06-27T17:00:00.000Z");
  });
});

describe("formatStudioTime", () => {
  it("renders the Bangkok HH:MM of an instant", () => {
    expect(formatStudioTime(new Date("2026-06-28T02:00:00Z"))).toBe("09:00");
  });

  it("renders a late-evening Bangkok time crossing midnight UTC", () => {
    // 23:30 ICT = 16:30Z same day.
    expect(formatStudioTime(new Date("2026-06-28T16:30:00Z"))).toBe("23:30");
  });

  it("round-trips studioInstant → formatStudioTime", () => {
    for (const [hh, mm] of [
      [0, 0],
      [8, 30],
      [9, 0],
      [17, 15],
      [23, 59],
    ] as const) {
      const instant = studioInstant(2026, 5, 28, hh, mm);
      expect(formatStudioTime(instant)).toBe(
        `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
      );
    }
  });
});

describe("studioParts", () => {
  it("reports the Bangkok wall-clock parts and isoDow (Sun = 7)", () => {
    const parts = studioParts(new Date("2026-06-28T02:00:00Z")); // Sun 28 Jun 09:00 ICT
    expect(parts).toMatchObject({
      year: 2026,
      month0: 5,
      day: 28,
      hour: 9,
      minute: 0,
      isoDow: 7,
    });
  });

  it("buckets an instant that is the previous day in UTC into the right Bangkok day", () => {
    // 2026-06-28T18:00Z = 2026-06-29 01:00 ICT (next Bangkok day, a Monday).
    const parts = studioParts(new Date("2026-06-28T18:00:00Z"));
    expect(parts).toMatchObject({ year: 2026, month0: 5, day: 29, hour: 1, isoDow: 1 });
  });
});

describe("studioIsoDow", () => {
  it("returns 1..7 with Sunday = 7", () => {
    expect(studioIsoDow(new Date("2026-06-28T02:00:00Z"))).toBe(7); // Sun
    expect(studioIsoDow(new Date("2026-06-29T02:00:00Z"))).toBe(1); // Mon
  });
});

describe("studioStartOfDay", () => {
  it("is Bangkok 00:00 (= 17:00Z the prior day) of the instant's Bangkok day", () => {
    // Sun 28 Jun 09:00 ICT → start = Sun 28 Jun 00:00 ICT = Sat 27 Jun 17:00Z.
    expect(studioStartOfDay(new Date("2026-06-28T02:00:00Z")).toISOString()).toBe(
      "2026-06-27T17:00:00.000Z",
    );
  });

  it("near the UTC midnight boundary still anchors to the Bangkok day", () => {
    // 2026-06-28T23:30Z is 2026-06-29 06:30 ICT → Bangkok day is the 29th.
    expect(studioStartOfDay(new Date("2026-06-28T23:30:00Z")).toISOString()).toBe(
      "2026-06-28T17:00:00.000Z",
    );
  });
});

describe("studioStartOfWeekMonday", () => {
  it("snaps a Sunday Bangkok date back to that week's Monday 00:00 ICT", () => {
    // Sun 28 Jun 2026 09:00 ICT → Monday of the week is Mon 22 Jun 2026 00:00 ICT
    // = Sun 21 Jun 2026 17:00Z.
    expect(studioStartOfWeekMonday(new Date("2026-06-28T02:00:00Z")).toISOString()).toBe(
      "2026-06-21T17:00:00.000Z",
    );
  });

  it("on a Monday returns that same Monday 00:00 ICT", () => {
    // Mon 22 Jun 2026 08:00 ICT = 2026-06-22T01:00Z.
    expect(studioStartOfWeekMonday(new Date("2026-06-22T01:00:00Z")).toISOString()).toBe(
      "2026-06-21T17:00:00.000Z",
    );
  });
});

describe("studioDayFromYmd", () => {
  it("parses a yyyy-mm-dd into Bangkok 00:00 of that day", () => {
    expect(studioDayFromYmd("2026-06-28").toISOString()).toBe("2026-06-27T17:00:00.000Z");
  });

  it("rejects an overflow date by failing closed (does not roll forward)", () => {
    // 2026-02-31 must NOT become Mar 03; it falls back to start-of-today, so just
    // assert it is not the rolled-forward March instant.
    const rolled = studioInstant(2026, 2, 3, 0, 0).toISOString();
    expect(studioDayFromYmd("2026-02-31").toISOString()).not.toBe(rolled);
  });
});

describe("addDays", () => {
  it("adds exact 24h multiples", () => {
    expect(addDays(new Date("2026-06-28T02:00:00Z"), 3).toISOString()).toBe(
      "2026-07-01T02:00:00.000Z",
    );
  });
});

describe("formatStudioDate", () => {
  it("uses the Bangkok timezone regardless of host TZ (Buddhist era for th)", () => {
    const instant = new Date("2026-06-27T18:00:00Z"); // 2026-06-28 01:00 ICT
    // en-GB day-numeric in Bangkok must be the 28th, not the 27th.
    expect(formatStudioDate(instant, "en", { day: "numeric", month: "short" })).toContain("28");
    // th-TH yields the Buddhist year 2569.
    expect(formatStudioDate(instant, "th", { year: "numeric" })).toContain("2569");
  });
});

describe("constants", () => {
  it("exposes the studio timezone", () => {
    expect(STUDIO_TZ).toBe("Asia/Bangkok");
  });
});
