// DB-backed integration tests for the INSTRUCTOR-AVAILABILITY REPLACE transaction
// (app/actions/instructors.ts `setInstructorAvailability`).
//
// Why this exists: the no-DB unit suite (tests/admin-instructors.test.ts) can only
// pin validation, the auth-gate ordering, and the mock success shape — its DB branch
// is short-circuited by an unset DATABASE_URL. The actual guarantee under test only
// holds because of a real interactive transaction: lock the instructor row
// `FOR UPDATE`, DELETE all of that instructor's instructor_availability rows, INSERT
// the new week — all-or-nothing. That "replace is atomic & complete, leaves no stale
// rows, and validates/fails-closed" behaviour can only be proven against a real
// Postgres. This suite drives the public action against live Neon and asserts:
//
//   1. REPLACE IS ATOMIC & COMPLETE — seed an initial week, replace it with a
//      DIFFERENT week, read back (via getAdminInstructors AND a direct query): the
//      OLD rows are gone and EXACTLY the new rows exist (right day_of_week 1..7,
//      start/end, sorted). A second replace with yet another week proves repeated
//      replace leaves no stale rows (idempotent replace, no accumulation).
//   2. EMPTY WEEK = ALL DAYS OFF — replacing with an all-empty week deletes every
//      row for that instructor and inserts none.
//   3. UNKNOWN / INACTIVE INSTRUCTOR → UNKNOWN_INSTRUCTOR, and NO rows written (the
//      sentinel rolls the transaction back).
//   4. INVALID INPUT (overlap / bad time) → INVALID_INPUT, and the EXISTING rows are
//      left untouched (validation happens BEFORE the transaction).
//
// requireAdmin() is mocked-allow (the default mock provider with ADMIN_AUTH unset),
// exactly like the other admin tests; the deny path is covered in admin-auth.test.ts.
//
// Fixtures: each run owns instructors whose ids carry a per-run prefix, so teardown
// is a clean "delete availability + instructors for this run". Safe to point at the
// shared dev DB. The instructor_availability table is already live on Neon (applied
// directly; db:push needs a TTY here per memory `db-push-needs-tty`).
//
// Gated: requires DATABASE_URL (loaded from .env by setup-env.ts). When unset the
// whole block skips (describe.skipIf), so the default no-DB `npm test` stays green.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { asc, eq, like } from "drizzle-orm";

// setInstructorAvailability's DB path calls revalidatePath, which throws outside a
// Next request scope. Stub next/cache so the action runs in a plain test process
// (mirrors credit-package.integration.test.ts).
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

import { getDb, closeDb } from "@/lib/db/client";
import { instructorAvailability, instructors } from "@/lib/db/schema";
import { setInstructorAvailability } from "@/app/actions/instructors";
import { getAdminInstructors, WEEKDAYS, type Weekday } from "@/lib/admin/instructors";

const HAS_DB = !!process.env.DATABASE_URL;

type Week = Record<Weekday, [string, string][]>;

/** Build a full 7-key week from a partial spec (omitted days = off). */
function week(partial: Partial<Week>): Week {
  return Object.fromEntries(
    WEEKDAYS.map((d) => [d, partial[d] ?? []]),
  ) as Week;
}

describe.skipIf(!HAS_DB)(
  "instructor availability replace (integration · requires DATABASE_URL)",
  () => {
    // A per-run prefix scopes every instructor this file creates so teardown is a
    // clean delete and parallel runs / seed data never collide. (Instructor ids are
    // text PKs — "mai"/"ploy"/… — so we mint our own prefixed ids.)
    const run = `ia_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const instructorIds: string[] = [];

    // The action gate uses the mock admin provider (allow) when ADMIN_AUTH is unset.
    const ORIGINAL_ADMIN_AUTH = process.env.ADMIN_AUTH;

    /** Create an instructor (active by default) with a run-scoped id; track for teardown. */
    async function makeInstructor(label: string, active = true): Promise<string> {
      const db = getDb();
      const id = `${run}-${label}`;
      await db
        .insert(instructors)
        .values({ id, name: id, nameTh: id, tag: null, active });
      instructorIds.push(id);
      return id;
    }

    /** Direct read of an instructor's availability rows, ordered (dow, start). */
    async function availabilityRows(instructorId: string) {
      const db = getDb();
      return db
        .select({
          dayOfWeek: instructorAvailability.dayOfWeek,
          startTime: instructorAvailability.startTime,
          endTime: instructorAvailability.endTime,
        })
        .from(instructorAvailability)
        .where(eq(instructorAvailability.instructorId, instructorId))
        .orderBy(asc(instructorAvailability.dayOfWeek), asc(instructorAvailability.startTime));
    }

    /** Flatten a Week spec into the (dow 1..7, start, end) rows it should persist as. */
    function expectedRows(w: Week): { dayOfWeek: number; startTime: string; endTime: string }[] {
      const rows = WEEKDAYS.flatMap((d, idx) =>
        w[d].map(([start, end]) => ({ dayOfWeek: idx + 1, startTime: start, endTime: end })),
      );
      return rows.sort(
        (a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime),
      );
    }

    beforeAll(() => {
      // Resolve the mock admin "allow" (the other admin tests do the same).
      delete process.env.ADMIN_AUTH;
    });

    afterAll(async () => {
      try {
        const db = getDb();
        const mine = await db
          .select({ id: instructors.id })
          .from(instructors)
          .where(like(instructors.id, `${run}-%`));
        const ids = mine.map((i) => i.id);
        for (const id of ids) {
          await db
            .delete(instructorAvailability)
            .where(eq(instructorAvailability.instructorId, id));
        }
        if (ids.length) {
          await db.delete(instructors).where(like(instructors.id, `${run}-%`));
        }
      } finally {
        if (ORIGINAL_ADMIN_AUTH === undefined) delete process.env.ADMIN_AUTH;
        else process.env.ADMIN_AUTH = ORIGINAL_ADMIN_AUTH;
        await closeDb();
      }
    });

    // ───────────── 1. Replace is atomic & complete (no stale rows, repeatable) ─────────────

    it("REPLACE: a different week leaves EXACTLY the new rows — old rows gone, repeated replace doesn't accumulate", async () => {
      const id = await makeInstructor("replace");

      // Seed an initial week (Mon + Wed + Sat ranges).
      const first = week({
        Mon: [["07:00", "13:00"], ["17:00", "19:00"]],
        Wed: [["08:00", "12:00"]],
        Sat: [["09:00", "13:00"]],
      });
      const r1 = await setInstructorAvailability({ instructorId: id, week: first });
      expect(r1).toEqual({ ok: true });
      expect(await availabilityRows(id)).toEqual(expectedRows(first));

      // Replace with a COMPLETELY different week (different days AND times). The old
      // rows must be gone — exactly the new set remains.
      const second = week({
        Tue: [["09:00", "10:00"], ["17:00", "18:00"]],
        Thu: [["09:00", "12:00"]],
        Sun: [["09:00", "11:00"]],
      });
      const r2 = await setInstructorAvailability({ instructorId: id, week: second });
      expect(r2).toEqual({ ok: true });

      const afterSecond = await availabilityRows(id);
      expect(afterSecond).toEqual(expectedRows(second));
      // None of the first week's signature times survive (no stale Mon/Wed/Sat rows).
      expect(afterSecond.some((r) => r.dayOfWeek === 1)).toBe(false); // Mon gone
      expect(afterSecond.some((r) => r.startTime === "07:00")).toBe(false);

      // Same data surfaces through the admin read model the editor binds to: each
      // weekday's ranges match and are sorted by start.
      const list = await getAdminInstructors();
      const ins = list.find((i) => i.id === id)!;
      expect(ins.weekAvailability.Tue).toEqual([
        { start: "09:00", end: "10:00" },
        { start: "17:00", end: "18:00" },
      ]);
      expect(ins.weekAvailability.Thu).toEqual([{ start: "09:00", end: "12:00" }]);
      expect(ins.weekAvailability.Sun).toEqual([{ start: "09:00", end: "11:00" }]);
      expect(ins.weekAvailability.Mon).toEqual([]); // the replaced-away day is empty
      expect(ins.weekAvailability.Wed).toEqual([]);
      expect(ins.weekAvailability.Sat).toEqual([]);

      // A THIRD replace with yet another week proves repeated replace never leaves
      // stale rows behind (idempotent replace, no accumulation).
      const third = week({ Fri: [["08:00", "09:00"], ["09:00", "10:00"], ["16:00", "17:00"]] });
      const r3 = await setInstructorAvailability({ instructorId: id, week: third });
      expect(r3).toEqual({ ok: true });
      const afterThird = await availabilityRows(id);
      expect(afterThird).toEqual(expectedRows(third));
      // Total row count equals the third week's row count — nothing accumulated.
      expect(afterThird).toHaveLength(3);
    });

    // ───────────── 2. Empty week = all days off ─────────────

    it("EMPTY WEEK: replacing with all-empty deletes every row and inserts none", async () => {
      const id = await makeInstructor("empty");

      // Seed a non-trivial week first.
      const seeded = week({
        Mon: [["09:00", "12:00"]],
        Fri: [["17:00", "20:00"]],
      });
      expect(await setInstructorAvailability({ instructorId: id, week: seeded })).toEqual({
        ok: true,
      });
      expect(await availabilityRows(id)).toHaveLength(2);

      // Replace with an all-empty week → every row gone, none inserted.
      expect(await setInstructorAvailability({ instructorId: id, week: week({}) })).toEqual({
        ok: true,
      });
      expect(await availabilityRows(id)).toEqual([]);

      // The read model reports the instructor as off every day.
      const list = await getAdminInstructors();
      const ins = list.find((i) => i.id === id)!;
      for (const d of WEEKDAYS) expect(ins.weekAvailability[d]).toEqual([]);
    });

    // ───────────── 3. Unknown / inactive instructor → UNKNOWN_INSTRUCTOR, no rows ─────────────

    it("UNKNOWN INSTRUCTOR: a non-existent id → UNKNOWN_INSTRUCTOR and writes nothing", async () => {
      const missingId = `${run}-does-not-exist`;
      const res = await setInstructorAvailability({
        instructorId: missingId,
        week: week({ Mon: [["09:00", "12:00"]] }),
      });
      expect(res).toEqual({ ok: false, code: "UNKNOWN_INSTRUCTOR" });
      expect(await availabilityRows(missingId)).toEqual([]);
    });

    it("INACTIVE INSTRUCTOR: an existing-but-inactive id → UNKNOWN_INSTRUCTOR and writes nothing", async () => {
      const id = await makeInstructor("inactive", false);
      const res = await setInstructorAvailability({
        instructorId: id,
        week: week({ Mon: [["09:00", "12:00"]] }),
      });
      expect(res).toEqual({ ok: false, code: "UNKNOWN_INSTRUCTOR" });
      // The active-instructor check inside the lock rolled the tx back — no rows.
      expect(await availabilityRows(id)).toEqual([]);
    });

    // ───────────── 4. Invalid input → INVALID_INPUT, existing rows untouched ─────────────

    it("INVALID INPUT (overlap): rejected BEFORE the tx → existing rows are left untouched", async () => {
      const id = await makeInstructor("invalid");

      // Establish a known-good week.
      const good = week({ Mon: [["09:00", "12:00"]], Wed: [["08:00", "12:00"]] });
      expect(await setInstructorAvailability({ instructorId: id, week: good })).toEqual({
        ok: true,
      });
      const before = await availabilityRows(id);
      expect(before).toEqual(expectedRows(good));

      // Overlapping ranges within a day fail validation — which runs BEFORE the
      // transaction, so nothing is deleted or inserted.
      const overlap = week({ Mon: [["09:00", "12:00"], ["11:00", "14:00"]] });
      expect(await setInstructorAvailability({ instructorId: id, week: overlap })).toEqual({
        ok: false,
        code: "INVALID_INPUT",
      });
      expect(await availabilityRows(id)).toEqual(before); // untouched

      // A bad time (end <= start) is likewise rejected before the tx.
      const badTime = week({ Tue: [["13:00", "09:00"]] });
      expect(await setInstructorAvailability({ instructorId: id, week: badTime })).toEqual({
        ok: false,
        code: "INVALID_INPUT",
      });
      expect(await availabilityRows(id)).toEqual(before); // still untouched
    });
  },
);
