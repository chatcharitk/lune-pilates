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
import { bookings, classInstances, instructors } from "@/lib/db/schema";
import type { ClassType } from "@/lib/domain/types";
import { effectiveCapacity } from "@/lib/domain/types";
import { computePublicVisibleAt } from "@/lib/schedule/visibility";
import {
  baselineSlotsForDate,
  startOfWeekMonday,
  startsAtFor,
} from "@/lib/schedule/baseline";
import { emit } from "@/lib/events/bus";
import { registerNotificationHandlers } from "@/lib/events/notifications";
import { requireOwner } from "@/lib/auth/admin";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const CLASS_TYPE = z.enum(["group", "private", "duo", "trio", "rental"]);

/** Local midnight Date for a "YYYY-MM-DD" string. */
function localDay(date: string): Date {
  return new Date(`${date}T00:00:00`);
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
 * Materialise the recurring baseline into a week as DRAFT instances. Idempotent:
 * only baseline group slots with no existing instance at that exact start are
 * created, so re-running never duplicates. The baseline itself is never mutated.
 */
export async function generateWeekFromBaseline(raw: WeekInput): Promise<GenerateResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = weekInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const weekStart = startOfWeekMonday(new Date(parsed.data.weekStart));

  if (!process.env.DATABASE_URL) return { ok: true, created: 0 };

  const db = getDb();
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3_600_000);

  // Existing starts in the week, to skip already-present baseline slots.
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
    const date = new Date(weekStart);
    date.setDate(date.getDate() + i);
    for (const slot of baselineSlotsForDate(date)) {
      const startsAt = startsAtFor(date, slot.time);
      if (present.has(`${startsAt.getTime()}|${slot.type}`)) continue;
      toInsert.push({
        startsAt,
        durationMin: slot.durationMin,
        type: slot.type,
        capacity: slot.capacity,
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
  const weekStart = startOfWeekMonday(new Date(parsed.data.weekStart));
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
