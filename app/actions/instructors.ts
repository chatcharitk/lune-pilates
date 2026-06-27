"use server";

// Server actions for the admin "Instructors" screen (spec §4; prototype
// admin-mobile-more.jsx `MAvailEditor`). The single write here is replacing an
// instructor's WEEKLY availability template — the editor's Save.
//
// Every action is gated by `requireAdmin()` (lib/auth/admin.ts — v1 mock provider;
// the real staff/LINE provider swaps in at `getAdminAuth()` with no change here).
// The gate is line 1 of the body, BEFORE input parsing and the no-DB branch, so it
// can never be reordered past them (see tests/admin-auth.test.ts).
//
// All inputs are validated server-side (CLAUDE.md §8): every range must be "HH:MM"
// 24h with end > start, and no two ranges within a day may overlap. The week is the
// instructor's complete template, so persisting REPLACES all of their rows in ONE
// interactive transaction (WebSocket Pool, db.transaction) — delete-then-insert,
// all-or-nothing, so a partial write can never leave a half-edited week.

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { instructorAvailability, instructors } from "@/lib/db/schema";
import { WEEKDAYS, type Weekday } from "@/lib/admin/instructors";
import { requireAdmin } from "@/lib/auth/admin";

/** Sentinel to roll the replace transaction back when the instructor is missing/inactive. */
class UnknownInstructorError extends Error {}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Minutes since midnight for an "HH:MM" string (assumes the regex already passed). */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => Number.parseInt(n, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

// A single [start, end] range: both "HH:MM" 24h, end strictly after start.
const rangeSchema = z
  .tuple([z.string().regex(TIME_RE), z.string().regex(TIME_RE)])
  .refine(([start, end]) => toMinutes(end) > toMinutes(start), {
    message: "end must be after start",
  });

// A day's ranges: each valid, and no two overlapping (touching end==start is OK).
const daySchema = z.array(rangeSchema).superRefine((ranges, ctx) => {
  const sorted = [...ranges].sort((a, b) => toMinutes(a[0]) - toMinutes(b[0]));
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = toMinutes(sorted[i - 1]![1]);
    const curStart = toMinutes(sorted[i]![0]);
    if (curStart < prevEnd) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "ranges overlap" });
      break;
    }
  }
});

// The full week: every weekday key present (each defaults to an empty list).
const weekSchema = z.object({
  Mon: daySchema,
  Tue: daySchema,
  Wed: daySchema,
  Thu: daySchema,
  Fri: daySchema,
  Sat: daySchema,
  Sun: daySchema,
});

const setAvailabilityInput = z.object({
  instructorId: z.string().min(1),
  week: weekSchema,
});
export type SetInstructorAvailabilityInput = z.infer<typeof setAvailabilityInput>;

export type SetInstructorAvailabilityFailureCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  | "UNKNOWN_INSTRUCTOR";

export type SetInstructorAvailabilityResult =
  | { ok: true }
  | { ok: false; code: SetInstructorAvailabilityFailureCode };

/**
 * Replace `instructorId`'s entire weekly availability template with `week`.
 *
 * Validation (server-side, §8): every range is "HH:MM" 24h with end > start, and no
 * two ranges within a day overlap (touching endpoints are allowed). The instructor
 * must exist AND be active.
 *
 * Persistence is delete-then-insert in ONE interactive transaction so it is atomic
 * (a failed insert never leaves the old rows deleted). Mon..Sun map to day_of_week
 * 1..7 (matching classTemplates). The instructor row is locked `FOR UPDATE` at the
 * top of the transaction so two admins saving the same instructor serialize into a
 * clean last-writer-wins (no interleaved delete/insert), and the active-instructor
 * check inside that lock also closes the deactivate-mid-save race.
 *
 * No-DB dev path: validate + return ok (mock no-op) so the editor "saves" against
 * mock data, mirroring the other admin write actions.
 */
export async function setInstructorAvailability(
  raw: SetInstructorAvailabilityInput,
): Promise<SetInstructorAvailabilityResult> {
  if (!(await requireAdmin())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = setAvailabilityInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const { instructorId, week } = parsed.data;

  // Flatten the validated week into insertable rows (Mon=1 … Sun=7).
  const rows = WEEKDAYS.flatMap((day: Weekday, idx) =>
    week[day].map(([startTime, endTime]) => ({
      instructorId,
      dayOfWeek: idx + 1,
      startTime,
      endTime,
    })),
  );

  if (!process.env.DATABASE_URL) {
    // UI dev against mock data — validation passed, nothing to persist.
    return { ok: true };
  }

  const db = getDb();

  // Atomic replace under a row lock: confirm the instructor exists & is active,
  // then delete the old template and insert the new one — all or nothing. Locking
  // the instructor row `FOR UPDATE` serializes concurrent saves of the same
  // instructor (clean last-writer-wins) and pins the active check against a
  // deactivate-mid-save. A missing/inactive instructor rolls the tx back via the
  // sentinel and surfaces as UNKNOWN_INSTRUCTOR.
  try {
    await db.transaction(async (tx) => {
      const [ins] = await tx
        .select({ id: instructors.id, active: instructors.active })
        .from(instructors)
        .where(eq(instructors.id, instructorId))
        .for("update")
        .limit(1);
      if (!ins || !ins.active) throw new UnknownInstructorError();

      await tx
        .delete(instructorAvailability)
        .where(eq(instructorAvailability.instructorId, instructorId));
      if (rows.length > 0) {
        await tx.insert(instructorAvailability).values(rows);
      }
    });
  } catch (err) {
    if (err instanceof UnknownInstructorError) {
      return { ok: false, code: "UNKNOWN_INSTRUCTOR" };
    }
    throw err;
  }

  revalidatePath("/admin/instructors");
  return { ok: true };
}
