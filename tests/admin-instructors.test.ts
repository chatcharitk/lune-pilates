// Admin Instructors read model (lib/admin/instructors.ts) + the availability write
// action (app/actions/instructors.ts), pinned on the no-DB path.
//
// The DB path (interactive delete-then-insert transaction) is out of reach for a
// no-DB unit test; what we CAN and MUST pin here without a database:
//   - the read model's shape: 3 mock instructors, each with today's classes,
//     the attendees sum, today's ranges, offToday correctness, and a full
//     7-key weekAvailability (the editor's source of truth).
//   - the action contract: server-side time/order/overlap validation, the auth
//     gate ordering, and the success shape.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getAdminInstructors,
  WEEKDAYS,
  type Weekday,
} from "@/lib/admin/instructors";
import {
  createInstructor,
  setInstructorActive,
  setInstructorAvailability,
  updateInstructor,
} from "@/app/actions/instructors";
import { slugifyInstructorId } from "@/lib/admin/instructor-id";

const ORIGINAL_DB_URL = process.env.DATABASE_URL;
const ORIGINAL_ADMIN_AUTH = process.env.ADMIN_AUTH;

beforeEach(() => {
  delete process.env.DATABASE_URL; // force the no-DB path
  delete process.env.ADMIN_AUTH;
});
afterEach(() => {
  if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB_URL;
  if (ORIGINAL_ADMIN_AUTH === undefined) delete process.env.ADMIN_AUTH;
  else process.env.ADMIN_AUTH = ORIGINAL_ADMIN_AUTH;
});

/** Build a full, valid week with the same ranges on every day. */
function uniformWeek(ranges: [string, string][]): Record<Weekday, [string, string][]> {
  return Object.fromEntries(WEEKDAYS.map((d) => [d, ranges])) as Record<
    Weekday,
    [string, string][]
  >;
}

describe("getAdminInstructors (no-DB)", () => {
  it("returns the 3 mock instructors (mai/ploy/nina) with bilingual names + initials", async () => {
    const list = await getAdminInstructors();
    expect(list.map((i) => i.id)).toEqual(["mai", "ploy", "nina"]);
    const mai = list[0]!;
    expect(mai.name).toEqual({ en: "Kru Mai", th: "ครูใหม่" });
    expect(mai.initials).toBe("M");
    expect(list[1]!.initials).toBe("P");
    expect(list[2]!.initials).toBe("N");
    expect(mai.tag).toEqual({ en: "Founder · Rehab", th: "ผู้ก่อตั้ง · ฟื้นฟู" });
  });

  it("each instructor has today's classes with classCount + attendees = sum(booked)", async () => {
    const list = await getAdminInstructors();
    const mai = list.find((i) => i.id === "mai")!;
    expect(mai.classCount).toBe(mai.todaysClasses.length);
    expect(mai.classCount).toBeGreaterThan(0);
    const expectedAttendees = mai.todaysClasses.reduce((s, c) => s + c.booked, 0);
    expect(mai.attendees).toBe(expectedAttendees);
    // every class carries the type meta + an effective (hard-capped) capacity
    for (const c of mai.todaysClasses) {
      expect(c.typeMeta.type).toBe(c.type);
      expect(c.booked).toBeLessThanOrEqual(c.capacity);
      expect(c.time).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it("exposes a full 7-key weekAvailability sorted within each day", async () => {
    const list = await getAdminInstructors();
    for (const ins of list) {
      expect(Object.keys(ins.weekAvailability).sort()).toEqual([...WEEKDAYS].sort());
      for (const day of WEEKDAYS) {
        const ranges = ins.weekAvailability[day];
        const starts = ranges.map((r) => r.start);
        expect(starts).toEqual([...starts].sort());
      }
    }
  });

  it("todayAvailability + offToday reflect today's weekday rows", async () => {
    // Anchor to a known weekday so the assertion is deterministic.
    const monday = new Date("2026-06-22T09:00:00"); // 2026-06-22 is a Monday
    const list = await getAdminInstructors(monday);
    const mai = list.find((i) => i.id === "mai")!;
    // mai's Monday template = 07:00–13:00, 17:00–19:00 (admin-mobile-data AVAIL_WEEK).
    expect(mai.todayAvailability).toEqual([
      { start: "07:00", end: "13:00" },
      { start: "17:00", end: "19:00" },
    ]);
    expect(mai.offToday).toBe(false);

    // nina is OFF on Wednesday in the seed → offToday true, no ranges.
    const wednesday = new Date("2026-06-24T09:00:00"); // Wednesday
    const wedList = await getAdminInstructors(wednesday);
    const nina = wedList.find((i) => i.id === "nina")!;
    expect(nina.todayAvailability).toEqual([]);
    expect(nina.offToday).toBe(true);
  });
});

describe("setInstructorAvailability (no-DB contract)", () => {
  it("a valid week → ok", async () => {
    const res = await setInstructorAvailability({
      instructorId: "mai",
      week: uniformWeek([["07:00", "13:00"], ["17:00", "20:00"]]),
    });
    expect(res).toEqual({ ok: true });
  });

  it("an empty week (all days off) → ok", async () => {
    const res = await setInstructorAvailability({
      instructorId: "mai",
      week: uniformWeek([]),
    });
    expect(res).toEqual({ ok: true });
  });

  it("bad time format → INVALID_INPUT", async () => {
    const res = await setInstructorAvailability({
      instructorId: "mai",
      week: { ...uniformWeek([]), Mon: [["7:00", "13:00"]] }, // missing leading zero
    });
    expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("a 24:00 / out-of-range time → INVALID_INPUT", async () => {
    const res = await setInstructorAvailability({
      instructorId: "mai",
      week: { ...uniformWeek([]), Tue: [["09:00", "24:00"]] },
    });
    expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("end <= start → INVALID_INPUT (equal endpoints)", async () => {
    const res = await setInstructorAvailability({
      instructorId: "mai",
      week: { ...uniformWeek([]), Wed: [["10:00", "10:00"]] },
    });
    expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("end < start → INVALID_INPUT", async () => {
    const res = await setInstructorAvailability({
      instructorId: "mai",
      week: { ...uniformWeek([]), Thu: [["13:00", "09:00"]] },
    });
    expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("overlapping ranges within a day → INVALID_INPUT", async () => {
    const res = await setInstructorAvailability({
      instructorId: "mai",
      week: { ...uniformWeek([]), Fri: [["09:00", "12:00"], ["11:00", "14:00"]] },
    });
    expect(res).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("touching ranges (end == next start) are allowed → ok", async () => {
    const res = await setInstructorAvailability({
      instructorId: "ploy",
      week: { ...uniformWeek([]), Sat: [["09:00", "12:00"], ["12:00", "15:00"]] },
    });
    expect(res).toEqual({ ok: true });
  });

  it("UNAUTHORIZED first in deny mode, before input parsing", async () => {
    process.env.ADMIN_AUTH = "deny";
    const res = await setInstructorAvailability({
      instructorId: "",
      // @ts-expect-error malformed on purpose — the gate must beat INVALID_INPUT
      week: { Mon: [["bad", "bad"]] },
    });
    expect(res).toEqual({ ok: false, code: "UNAUTHORIZED" });
  });
});

describe("slugifyInstructorId (pure)", () => {
  it("lowercases, asciifies, and hyphenates", () => {
    expect(slugifyInstructorId("Kru Mai")).toBe("kru-mai");
    expect(slugifyInstructorId("  Best  Pongsak  ")).toBe("best-pongsak");
  });
  it("is deterministic for the same name", () => {
    expect(slugifyInstructorId("Kru Nina")).toBe(slugifyInstructorId("Kru Nina"));
  });
  it("strips accents to plain ascii", () => {
    expect(slugifyInstructorId("José")).toBe("jose");
  });
  it("yields only [a-z0-9-]", () => {
    const slug = slugifyInstructorId("A1! B2? — C3");
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });
  it("returns '' for a name with no ascii alnum (random-id fallback territory)", () => {
    expect(slugifyInstructorId("ครูใหม่")).toBe("");
    expect(slugifyInstructorId("!!!")).toBe("");
  });
});

describe("instructor CRUD (no-DB contract)", () => {
  it("createInstructor: valid input → ok with a deterministic ascii slug id", async () => {
    const res = await createInstructor({ name: "Kru Mei", nameTh: "ครูเหมย", tag: "Reformer" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.id).toBe("kru-mei"); // deterministic slug of the EN name
      expect(res.id).toMatch(/^[a-z0-9-]+$/); // ascii
    }
  });

  it("createInstructor: non-ascii name → ok with a random ascii fallback id", async () => {
    const res = await createInstructor({ name: "ครูใหม่", nameTh: "ครูใหม่" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.id.length).toBeGreaterThan(0);
      expect(res.id).toMatch(/^[a-z0-9]+$/); // random base36/hex fallback, still ascii
    }
  });

  it("createInstructor: empty name → INVALID_INPUT", async () => {
    expect(await createInstructor({ name: "", nameTh: "ครู" })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(await createInstructor({ name: "  ", nameTh: "ครู" })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
  });

  it("createInstructor: empty nameTh → INVALID_INPUT", async () => {
    expect(await createInstructor({ name: "Kru X", nameTh: "" })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
  });

  it("updateInstructor: valid input → ok (no-DB echoes the id)", async () => {
    const res = await updateInstructor({ id: "mai", name: "Kru Mai", nameTh: "ครูใหม่", tag: "Founder" });
    expect(res).toEqual({ ok: true, id: "mai" });
  });

  it("updateInstructor: empty name → INVALID_INPUT", async () => {
    expect(await updateInstructor({ id: "mai", name: "", nameTh: "ครู" })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
  });

  it("setInstructorActive: toggling active → ok echoing the state", async () => {
    expect(await setInstructorActive({ id: "mai", active: false })).toEqual({
      ok: true,
      id: "mai",
      active: false,
    });
    expect(await setInstructorActive({ id: "mai", active: true })).toEqual({
      ok: true,
      id: "mai",
      active: true,
    });
  });

  it("owner-gate first: all three → UNAUTHORIZED in deny mode, before input parse", async () => {
    process.env.ADMIN_AUTH = "deny";
    // Each call carries malformed input so UNAUTHORIZED can only come from the gate.
    expect(await createInstructor({ name: "", nameTh: "" })).toEqual({
      ok: false,
      code: "UNAUTHORIZED",
    });
    expect(await updateInstructor({ id: "", name: "", nameTh: "" })).toEqual({
      ok: false,
      code: "UNAUTHORIZED",
    });
    // @ts-expect-error malformed active on purpose — the gate must beat INVALID_INPUT
    expect(await setInstructorActive({ id: "", active: "nope" })).toEqual({
      ok: false,
      code: "UNAUTHORIZED",
    });
  });
});

describe("getAdminInstructors (raw editable fields for the owner edit form)", () => {
  it("each instructor exposes nameEn / nameRawTh / tagRaw / active", async () => {
    const list = await getAdminInstructors();
    const mai = list.find((i) => i.id === "mai")!;
    expect(mai.nameEn).toBe(mai.name.en);
    expect(mai.nameRawTh).toBe(mai.name.th);
    expect(mai.tagRaw).toBe(mai.tag?.en ?? "");
    expect(mai.active).toBe(true);
  });
});
