"use server";

// Server actions for the admin "Instructors" screen (spec §4; prototype
// admin-mobile-more.jsx `MAvailEditor`). The single write here is replacing an
// instructor's WEEKLY availability template — the editor's Save.
//
// OWNER-ONLY: gated by `requireOwner()` (lib/auth/admin.ts — v1 mock provider; the
// real staff/LINE provider swaps in at `getAdminAuth()`). An instructor is rejected
// like unauth (UNAUTHORIZED). The gate is line 1 of the body, BEFORE input parsing
// and the no-DB branch, so it can never be reordered past them (see
// tests/admin-auth.test.ts).
//
// All inputs are validated server-side (CLAUDE.md §8): every range must be "HH:MM"
// 24h with end > start, and no two ranges within a day may overlap. The week is the
// instructor's complete template, so persisting REPLACES all of their rows in ONE
// interactive transaction (WebSocket Pool, db.transaction) — delete-then-insert,
// all-or-nothing, so a partial write can never leave a half-edited week.

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { instructorAvailability, instructors } from "@/lib/db/schema";
import { WEEKDAYS, type Weekday } from "@/lib/admin/instructors";
import { slugifyInstructorId } from "@/lib/admin/instructor-id";
import { requireOwner } from "@/lib/auth/admin";

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
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

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

// ───────────────────────── instructor CRUD (Owner-only) ─────────────────────────
// Create / rename / soft-remove instructors. Each is OWNER-ONLY (requireOwner first,
// before input parsing and the no-DB branch — same ordering as every other admin
// action, see tests/admin-auth.test.ts), zod-validated server-side (CLAUDE.md §8),
// and returns a typed result union (never throws on an expected conflict).
//
// IDs are the text PRIMARY KEY (a slug, e.g. "mai"). They are referenced by
// class_instances.instructor_id, class_templates.instructor_id, and
// instructor_availability.instructor_id, so:
//   - the id is generated once at create and NEVER changed by an update;
//   - "remove" is a SOFT deactivate (active=false), never a delete, to preserve those
//     FKs (past classes keep their instructor; availability rows survive).

/** Shared failure codes for the instructor CRUD actions. */
export type InstructorCrudFailureCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  | "UNKNOWN_INSTRUCTOR"
  | "ID_TAKEN";

/** A short base36 random suffix (collision-breaker / random-id fallback). */
function randomSuffix(): string {
  return randomBytes(6).toString("hex").replace(/[^0-9a-f]/g, "").slice(0, 8) ||
    Math.random().toString(36).slice(2, 10);
}

// Trimmed, non-empty name fields (CLAUDE.md §8). Tag is optional free text.
const nameField = z.string().trim().min(1).max(120);
const tagField = z.string().trim().min(1).max(120).optional();

const createInstructorInput = z.object({
  name: nameField,
  nameTh: nameField,
  tag: tagField,
});
export type CreateInstructorInput = z.infer<typeof createInstructorInput>;

export type CreateInstructorResult =
  | { ok: true; id: string }
  | { ok: false; code: InstructorCrudFailureCode };

/**
 * Create a new instructor. The text PK id is derived by slugifying the EN name; when
 * the slug is empty or already taken, a short random base36 suffix is appended (and a
 * fully random id is used when the name yields no slug at all). Inserted active.
 *
 * Persistence races on the id are handled with onConflictDoNothing + a retry on a
 * fresh suffixed id, so two concurrent creates of the same name can't 23505; after a
 * bounded number of attempts a collision surfaces as ID_TAKEN rather than throwing.
 *
 * No-DB dev path: validate, synthesize the slug id, return ok so the UI can render.
 */
export async function createInstructor(raw: CreateInstructorInput): Promise<CreateInstructorResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = createInstructorInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const { name, nameTh, tag } = parsed.data;

  const base = slugifyInstructorId(name);

  if (!process.env.DATABASE_URL) {
    // UI dev against mock data — synthesize the slug id (deterministic for a usable
    // name, random fallback otherwise). Nothing is persisted.
    return { ok: true, id: base || randomSuffix() };
  }

  const db = getDb();

  // Try the clean slug first, then up to a few suffixed candidates on conflict.
  const candidates: string[] = [];
  if (base) candidates.push(base);
  for (let i = 0; i < 3; i++) {
    candidates.push(base ? `${base}-${randomSuffix()}` : randomSuffix());
  }

  for (const id of candidates) {
    const [made] = await db
      .insert(instructors)
      .values({ id, name, nameTh, tag: tag ?? null, active: true })
      .onConflictDoNothing()
      .returning({ id: instructors.id });
    if (made) {
      revalidatePath("/admin/instructors");
      return { ok: true, id: made.id };
    }
  }
  // Exhausted candidates without a clean insert — the id space collided repeatedly.
  return { ok: false, code: "ID_TAKEN" };
}

const updateInstructorInput = z.object({
  id: z.string().min(1),
  name: nameField,
  nameTh: nameField,
  tag: tagField,
});
export type UpdateInstructorInput = z.infer<typeof updateInstructorInput>;

export type UpdateInstructorResult =
  | { ok: true; id: string }
  | { ok: false; code: InstructorCrudFailureCode };

/**
 * Rename an existing instructor (name / nameTh / tag). The id and the active flag are
 * NEVER changed here (the id is FK-referenced; active is toggled via
 * setInstructorActive). A missing instructor → UNKNOWN_INSTRUCTOR.
 *
 * No-DB dev path: validate, return ok with the id.
 */
export async function updateInstructor(raw: UpdateInstructorInput): Promise<UpdateInstructorResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = updateInstructorInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const { id, name, nameTh, tag } = parsed.data;

  if (!process.env.DATABASE_URL) {
    return { ok: true, id };
  }

  const db = getDb();
  const updated = await db
    .update(instructors)
    .set({ name, nameTh, tag: tag ?? null })
    .where(eq(instructors.id, id))
    .returning({ id: instructors.id });

  if (updated.length === 0) return { ok: false, code: "UNKNOWN_INSTRUCTOR" };

  revalidatePath("/admin/instructors");
  return { ok: true, id };
}

const setInstructorActiveInput = z.object({
  id: z.string().min(1),
  active: z.boolean(),
});
export type SetInstructorActiveInput = z.infer<typeof setInstructorActiveInput>;

export type SetInstructorActiveResult =
  | { ok: true; id: string; active: boolean }
  | { ok: false; code: InstructorCrudFailureCode };

/**
 * Soft remove / restore an instructor by toggling `active`. This is the "remove"
 * action (active=false): a SOFT deactivate that drops the instructor from the
 * active-only Instructors list while PRESERVING the row and every FK that references
 * it (class_instances / class_templates / instructor_availability). Restoring sets
 * active=true again. A missing instructor → UNKNOWN_INSTRUCTOR.
 *
 * No-DB dev path: validate, return ok echoing the requested state.
 */
export async function setInstructorActive(
  raw: SetInstructorActiveInput,
): Promise<SetInstructorActiveResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = setInstructorActiveInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const { id, active } = parsed.data;

  if (!process.env.DATABASE_URL) {
    return { ok: true, id, active };
  }

  const db = getDb();
  const updated = await db
    .update(instructors)
    .set({ active })
    .where(eq(instructors.id, id))
    .returning({ id: instructors.id });

  if (updated.length === 0) return { ok: false, code: "UNKNOWN_INSTRUCTOR" };

  revalidatePath("/admin/instructors");
  return { ok: true, id, active };
}
