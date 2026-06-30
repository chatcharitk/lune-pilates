"use server";

// Admin schedule-management actions (spec §4, CLAUDE.md §5 invariant 5).
//
// INVARIANT 5 — per-week, never the baseline: every edit here writes ONLY to
// `class_instances` (a concrete week), never to the recurring baseline (which v1
// keeps in code, lib/schedule/baseline.ts). "Generate from baseline" materialises
// missing baseline slots as DRAFT instances for one week; publishing flips that
// week's drafts to `published`, computes the tiered-visibility windows, and emits
// exactly ONE `schedule.published` broadcast event.
//
// Every action is OWNER-ONLY: gated by `requireOwner()` (lib/auth/admin.ts — v1
// mock provider, real one swaps in later). An instructor is rejected like unauth
// (UNAUTHORIZED). All money- and capacity-critical values are recomputed
// server-side.

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { bookings, classInstances, classTemplates, instructors } from "@/lib/db/schema";
import type { ClassType } from "@/lib/domain/types";
import { CAPACITY, effectiveCapacity } from "@/lib/domain/types";
import { computePublicVisibleAt } from "@/lib/schedule/visibility";
import { startOfWeekMonday, startsAtFor } from "@/lib/schedule/baseline";
import { addDays, studioDayFromYmd, studioIsoDow } from "@/lib/time";
import { getTemplateSlotsByDow } from "@/lib/admin/schedule-template";
import { emit } from "@/lib/events/bus";
import { registerNotificationHandlers } from "@/lib/events/notifications";
import { requireOwner } from "@/lib/auth/admin";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const CLASS_TYPE = z.enum(["group", "private", "duo", "trio", "rental"]);

/** ISO day of week (1=Mon … 7=Sun) of an instant, in Bangkok (studio) time. */
function isoDow(date: Date): number {
  return studioIsoDow(date);
}

/** The instant of Bangkok 00:00 for a "YYYY-MM-DD" calendar day. */
function localDay(date: string): Date {
  return studioDayFromYmd(date);
}

// ───────────────────────── create ─────────────────────────

const createInput = z.object({
  date: z.string().regex(DATE_RE), // the calendar day the class lands on
  time: z.string().regex(TIME_RE),
  type: CLASS_TYPE,
  durationMin: z.number().int().min(30).max(180),
  capacity: z.number().int().min(1).max(3),
  instructorId: z.string().nullable().optional(),
});
export type CreateClassInput = z.infer<typeof createInput>;

export type CreateClassFailureCode = "UNAUTHORIZED" | "INVALID_INPUT" | "INVALID_INSTRUCTOR";
export type CreateClassResult =
  | { ok: true; id: string }
  | { ok: false; code: CreateClassFailureCode };

/** Add a single DRAFT class instance to a week. Never touches the baseline. */
export async function createClass(raw: CreateClassInput): Promise<CreateClassResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = createInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const input = parsed.data;

  if (!process.env.DATABASE_URL) {
    return { ok: true, id: "00000000-0000-4000-8000-00000000c1a5" };
  }

  const db = getDb();
  const instructorId = await resolveInstructor(input.type, input.instructorId ?? null);
  if (instructorId === INVALID) return { ok: false, code: "INVALID_INSTRUCTOR" };

  const startsAt = startsAtFor(localDay(input.date), input.time);
  const [row] = await db
    .insert(classInstances)
    .values({
      startsAt,
      durationMin: input.durationMin,
      type: input.type,
      capacity: effectiveCapacity(input.capacity, input.type),
      instructorId,
      status: "draft",
    })
    .returning({ id: classInstances.id });

  revalidatePath("/admin/schedule");
  return { ok: true, id: row!.id };
}

// ───────────────────────── update ─────────────────────────

const updateInput = z.object({
  id: z.string().uuid(),
  time: z.string().regex(TIME_RE),
  type: CLASS_TYPE,
  durationMin: z.number().int().min(30).max(180),
  capacity: z.number().int().min(1).max(3),
  instructorId: z.string().nullable().optional(),
});
export type UpdateClassInput = z.infer<typeof updateInput>;

export type UpdateClassFailureCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "INVALID_INSTRUCTOR"
  | "CAPACITY_BELOW_BOOKED";
export type UpdateClassResult = { ok: true } | { ok: false; code: UpdateClassFailureCode };

/**
 * Edit one class instance (keeps its calendar day; only the time-of-day changes).
 * Capacity can't drop below the live booked count. A published class's
 * public-visibility window is recomputed from the new start time.
 */
export async function updateClass(raw: UpdateClassInput): Promise<UpdateClassResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = updateInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const input = parsed.data;

  if (!process.env.DATABASE_URL) return { ok: true };

  const db = getDb();
  const [existing] = await db
    .select({ startsAt: classInstances.startsAt, status: classInstances.status })
    .from(classInstances)
    .where(eq(classInstances.id, input.id))
    .limit(1);
  if (!existing) return { ok: false, code: "NOT_FOUND" };

  const instructorId = await resolveInstructor(input.type, input.instructorId ?? null);
  if (instructorId === INVALID) return { ok: false, code: "INVALID_INSTRUCTOR" };

  const cap = effectiveCapacity(input.capacity, input.type);
  const [bookedRow] = await db
    .select({ booked: sql<number>`count(*)::int` })
    .from(bookings)
    .where(and(eq(bookings.classInstanceId, input.id), eq(bookings.status, "booked")));
  if ((bookedRow?.booked ?? 0) > cap) return { ok: false, code: "CAPACITY_BELOW_BOOKED" };

  // Keep the calendar day; apply the new time-of-day to it.
  const startsAt = startsAtFor(existing.startsAt, input.time);

  await db
    .update(classInstances)
    .set({
      startsAt,
      durationMin: input.durationMin,
      type: input.type,
      capacity: cap,
      instructorId,
      // A published class stays visible to members; only its drop-in window moves.
      ...(existing.status === "published"
        ? { publicVisibleAt: computePublicVisibleAt(startsAt, input.type) }
        : {}),
    })
    .where(eq(classInstances.id, input.id));

  revalidatePath("/admin/schedule");
  return { ok: true };
}

// ───────────────────────── delete ─────────────────────────

const deleteInput = z.object({ id: z.string().uuid() });
export type DeleteClassInput = z.infer<typeof deleteInput>;

export type DeleteClassFailureCode = "UNAUTHORIZED" | "INVALID_INPUT" | "NOT_FOUND" | "HAS_BOOKINGS";
export type DeleteClassResult = { ok: true } | { ok: false; code: DeleteClassFailureCode };

/**
 * Remove a class instance. Blocked if ANY booking references it (a booked class
 * must be cancelled-with-refund through the bookings flow, not silently deleted)
 * — this keeps the ledger/booking history intact.
 */
export async function deleteClass(raw: DeleteClassInput): Promise<DeleteClassResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = deleteInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const { id } = parsed.data;

  if (!process.env.DATABASE_URL) return { ok: true };

  const db = getDb();
  const [existing] = await db
    .select({ id: classInstances.id })
    .from(classInstances)
    .where(eq(classInstances.id, id))
    .limit(1);
  if (!existing) return { ok: false, code: "NOT_FOUND" };

  const [bookedRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bookings)
    .where(eq(bookings.classInstanceId, id));
  if ((bookedRow?.n ?? 0) > 0) return { ok: false, code: "HAS_BOOKINGS" };

  await db.delete(classInstances).where(eq(classInstances.id, id));
  revalidatePath("/admin/schedule");
  return { ok: true };
}

// ───────────────────────── generate from baseline ─────────────────────────

const weekInput = z.object({ weekStart: z.string() });
export type WeekInput = z.infer<typeof weekInput>;

export type GenerateResult =
  | { ok: true; created: number }
  | { ok: false; code: "UNAUTHORIZED" | "INVALID_INPUT" };

/**
 * Materialise the EDITABLE recurring template into a week as DRAFT instances.
 * Slots are sourced from the active `class_templates` rows (grouped by ISO weekday
 * via getTemplateSlotsByDow), so editing the template changes what gets generated.
 * The fallback to BASELINE_SLOTS (when the table is empty) lives in that read model,
 * so a fresh/unseeded DB still generates the original group baseline.
 *
 * Idempotent: only template slots with no existing instance at that exact start+type
 * are created, so re-running never duplicates. Each generated instance carries the
 * source template's id in `template_id` (FK) where one exists. The template itself is
 * never mutated (invariant 5 — edits to a week never touch the recurring template).
 */
export async function generateWeekFromBaseline(raw: WeekInput): Promise<GenerateResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = weekInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const weekStart = startOfWeekMonday(studioDayFromYmd(parsed.data.weekStart));

  if (!process.env.DATABASE_URL) return { ok: true, created: 0 };

  const db = getDb();
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3_600_000);

  // The active editable template, grouped by ISO weekday (falls back to
  // BASELINE_SLOTS when the table is empty — see getTemplateSlotsByDow).
  const slotsByDow = await getTemplateSlotsByDow();

  // Existing starts in the week, to skip already-present template slots.
  const existing = await db
    .select({ startsAt: classInstances.startsAt, type: classInstances.type })
    .from(classInstances)
    .where(
      and(
        sql`${classInstances.startsAt} >= ${weekStart}`,
        sql`${classInstances.startsAt} < ${weekEnd}`,
      ),
    );
  const present = new Set(existing.map((e) => `${e.startsAt.getTime()}|${e.type}`));

  const toInsert: (typeof classInstances.$inferInsert)[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    for (const slot of slotsByDow.get(isoDow(date)) ?? []) {
      const startsAt = startsAtFor(date, slot.time);
      if (present.has(`${startsAt.getTime()}|${slot.type}`)) continue;
      toInsert.push({
        templateId: slot.templateId ?? null,
        startsAt,
        durationMin: slot.durationMin,
        type: slot.type,
        capacity: slot.capacity,
        instructorId: slot.instructorId ?? null,
        status: "draft",
      });
    }
  }

  if (toInsert.length > 0) await db.insert(classInstances).values(toInsert);
  revalidatePath("/admin/schedule");
  return { ok: true, created: toInsert.length };
}

// ───────────────────────── publish ─────────────────────────

export type PublishResult =
  | { ok: true; published: number }
  | { ok: false; code: "UNAUTHORIZED" | "INVALID_INPUT" };

/**
 * Publish a week: flip every DRAFT instance in [weekStart, +7d) to `published`,
 * stamping `published_at` / `members_visible_at` = now and computing
 * `public_visible_at = starts_at − N` per type (CLAUDE.md §5 invariant 4). The
 * flip runs in ONE transaction; exactly ONE `schedule.published` event is emitted
 * after it commits (the CRM is a thin listener — invariant 5 / spec §6).
 * Idempotent: already-published instances are untouched.
 */
export async function publishWeek(raw: WeekInput): Promise<PublishResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = weekInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const weekStart = startOfWeekMonday(studioDayFromYmd(parsed.data.weekStart));
  const now = new Date();

  if (!process.env.DATABASE_URL) return { ok: true, published: 0 };

  const db = getDb();
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3_600_000);

  const published = await db.transaction(async (tx) => {
    const drafts = await tx
      .select({
        id: classInstances.id,
        startsAt: classInstances.startsAt,
        type: classInstances.type,
      })
      .from(classInstances)
      .where(
        and(
          eq(classInstances.status, "draft"),
          sql`${classInstances.startsAt} >= ${weekStart}`,
          sql`${classInstances.startsAt} < ${weekEnd}`,
        ),
      )
      .for("update");

    if (drafts.length === 0) return 0;

    // public_visible_at depends on each row's start + type, so flip per row.
    for (const d of drafts) {
      await tx
        .update(classInstances)
        .set({
          status: "published",
          publishedAt: now,
          membersVisibleAt: now,
          publicVisibleAt: computePublicVisibleAt(d.startsAt, d.type as ClassType),
        })
        .where(eq(classInstances.id, d.id));
    }
    return drafts.length;
  });

  // ONE broadcast event after commit — CRM/notify is a thin listener on it.
  if (published > 0) {
    registerNotificationHandlers();
    await emit({ type: "schedule.published", weekStart: weekStart.toISOString() });
  }

  revalidatePath("/admin/schedule");
  return { ok: true, published };
}

// ───────────────────────── template CRUD (Owner-only) ─────────────────────────
// Create / edit / soft-remove rows of the EDITABLE recurring weekly schedule
// template (`class_templates`). Each is OWNER-ONLY (requireOwner first, BEFORE input
// parsing and the no-DB branch — same ordering as every other admin action, see
// tests/admin-auth.test.ts), zod-validated server-side (CLAUDE.md §8), and returns a
// typed result union (never throws on an expected conflict).
//
// The template is the recurring baseline; editing it changes what
// generateWeekFromBaseline materialises and what the changes-vs-template diff
// compares against. Edits here NEVER touch concrete class_instances (invariant 5 is
// the inverse: per-week edits never touch the template; template edits never
// retroactively mutate already-generated weeks).
//
// Capacity is validated against the type's HARD cap (CAPACITY[type]) so a Duo slot
// can never be saved with capacity 3, etc. Delete is a SOFT delete (active=false) to
// preserve the class_instances.template_id FK on any instances generated from a slot.

export type TemplateCrudFailureCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  | "UNKNOWN_TEMPLATE"
  | "UNKNOWN_INSTRUCTOR";

// dayOfWeek 1..7, "HH:MM" 24h, duration > 0, capacity ≥ 1 (the per-type hard-cap
// check is applied after parse since it depends on `type`).
const createTemplateInput = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  time: z.string().regex(TIME_RE),
  type: CLASS_TYPE,
  durationMin: z.number().int().positive().max(180),
  capacity: z.number().int().min(1),
  instructorId: z.string().min(1).nullable().optional(),
});
export type CreateTemplateSlotInput = z.infer<typeof createTemplateInput>;

export type CreateTemplateSlotResult =
  | { ok: true; id: string }
  | { ok: false; code: TemplateCrudFailureCode };

/**
 * Add one ACTIVE recurring template slot. Validates the time format, dayOfWeek 1..7,
 * a positive duration, and capacity within the type's hard cap (CAPACITY[type]); a
 * provided instructorId must exist. Inserted active.
 */
export async function createTemplateSlot(
  raw: CreateTemplateSlotInput,
): Promise<CreateTemplateSlotResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = createTemplateInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const input = parsed.data;

  // Capacity may not exceed the type's hard reformer cap.
  if (input.capacity > CAPACITY[input.type]) return { ok: false, code: "INVALID_INPUT" };

  if (!process.env.DATABASE_URL) {
    return { ok: true, id: "00000000-0000-4000-a000-0000000000c1" };
  }

  const db = getDb();
  const instructorId = await resolveInstructor(input.type, input.instructorId ?? null);
  if (instructorId === INVALID) return { ok: false, code: "UNKNOWN_INSTRUCTOR" };

  const [row] = await db
    .insert(classTemplates)
    .values({
      dayOfWeek: input.dayOfWeek,
      time: input.time,
      type: input.type,
      durationMin: input.durationMin,
      capacity: effectiveCapacity(input.capacity, input.type),
      instructorId,
      active: true,
    })
    .returning({ id: classTemplates.id });

  revalidatePath("/admin/schedule");
  return { ok: true, id: row!.id };
}

const updateTemplateInput = z.object({
  id: z.string().uuid(),
  time: z.string().regex(TIME_RE),
  type: CLASS_TYPE,
  durationMin: z.number().int().positive().max(180),
  capacity: z.number().int().min(1),
  instructorId: z.string().min(1).nullable().optional(),
});
export type UpdateTemplateSlotInput = z.infer<typeof updateTemplateInput>;

export type UpdateTemplateSlotResult =
  | { ok: true }
  | { ok: false; code: TemplateCrudFailureCode };

/**
 * Edit a template slot's time / type / duration / capacity / instructor. The id and
 * the active flag are never changed here (active is toggled via deleteTemplateSlot).
 * Same validation as create. A missing (or already soft-deleted) slot →
 * UNKNOWN_TEMPLATE.
 */
export async function updateTemplateSlot(
  raw: UpdateTemplateSlotInput,
): Promise<UpdateTemplateSlotResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = updateTemplateInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const input = parsed.data;

  if (input.capacity > CAPACITY[input.type]) return { ok: false, code: "INVALID_INPUT" };

  if (!process.env.DATABASE_URL) return { ok: true };

  const db = getDb();
  const instructorId = await resolveInstructor(input.type, input.instructorId ?? null);
  if (instructorId === INVALID) return { ok: false, code: "UNKNOWN_INSTRUCTOR" };

  const updated = await db
    .update(classTemplates)
    .set({
      time: input.time,
      type: input.type,
      durationMin: input.durationMin,
      capacity: effectiveCapacity(input.capacity, input.type),
      instructorId,
    })
    .where(and(eq(classTemplates.id, input.id), eq(classTemplates.active, true)))
    .returning({ id: classTemplates.id });

  if (updated.length === 0) return { ok: false, code: "UNKNOWN_TEMPLATE" };

  revalidatePath("/admin/schedule");
  return { ok: true };
}

const deleteTemplateInput = z.object({ id: z.string().uuid() });
export type DeleteTemplateSlotInput = z.infer<typeof deleteTemplateInput>;

export type DeleteTemplateSlotResult =
  | { ok: true }
  | { ok: false; code: TemplateCrudFailureCode };

/**
 * SOFT-remove a template slot (active=false) so it drops out of the editor and out
 * of generation/diff, while PRESERVING the row and the class_instances.template_id FK
 * on any instances already generated from it. A missing (or already removed) slot →
 * UNKNOWN_TEMPLATE.
 */
export async function deleteTemplateSlot(
  raw: DeleteTemplateSlotInput,
): Promise<DeleteTemplateSlotResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = deleteTemplateInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const { id } = parsed.data;

  if (!process.env.DATABASE_URL) return { ok: true };

  const db = getDb();
  const updated = await db
    .update(classTemplates)
    .set({ active: false })
    .where(and(eq(classTemplates.id, id), eq(classTemplates.active, true)))
    .returning({ id: classTemplates.id });

  if (updated.length === 0) return { ok: false, code: "UNKNOWN_TEMPLATE" };

  revalidatePath("/admin/schedule");
  return { ok: true };
}

// ───────────────────────── instructor resolution ─────────────────────────

const INVALID = Symbol("invalid-instructor");

/**
 * Validate an instructor selection. Group/Rental may have no instructor (null is
 * fine). For any provided id, it must exist. Returns the id, null, or INVALID.
 */
async function resolveInstructor(
  _type: ClassType,
  instructorId: string | null,
): Promise<string | null | typeof INVALID> {
  if (!instructorId) return null;
  const db = getDb();
  const [row] = await db
    .select({ id: instructors.id })
    .from(instructors)
    .where(eq(instructors.id, instructorId))
    .limit(1);
  return row ? row.id : INVALID;
}
