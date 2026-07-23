// Studio-rental scheduling rules (decided 2026-07-23):
//
//   1. MONTHLY RELEASE WINDOW — a customer may book a pre-scheduled rental instance
//      only once its booking window has OPENED. The window opens at 00:00 Bangkok on
//      the FIRST day of the month IMMEDIATELY BEFORE the rental's Bangkok start month
//      (e.g. a September slot opens on Aug 1 00:00 Bangkok). The front desk bypasses
//      this (bookedByAdmin) — it operates the schedule.
//
//   2. ROOM EXCLUSIVITY — the studio has ONE room, so a rental may not overlap in
//      time with any other ACTIVE (status != 'cancelled') class instance, and no
//      class may be placed over an active rental. Scoped to rentals ONLY: two
//      NON-rental classes may still coexist (unchanged existing behaviour).
//
// All wall-clock math goes through the Bangkok helpers in lib/time.ts — never
// hand-rolled timezone arithmetic. Pure + clock-injectable so the boundary can be
// unit-tested under any runtime TZ.

import { and, ne, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { classInstances } from "@/lib/db/schema";
import type { ClassType } from "@/lib/domain/types";
import { studioInstant, studioParts } from "@/lib/time";

/**
 * The instant a rental starting at `startsAt` becomes bookable by customers: 00:00
 * Bangkok on the FIRST day of the month immediately BEFORE `startsAt`'s Bangkok
 * month. Purely a function of the Bangkok calendar month of `startsAt` — the day and
 * time of day are irrelevant. `studioInstant` normalises a month index of -1 into the
 * previous December, so a January start correctly opens on the prior December 1.
 */
export function rentalBookingOpensAt(startsAt: Date): Date {
  const { year, month0 } = studioParts(startsAt);
  // First day of the month BEFORE the start month, 00:00 Bangkok.
  return studioInstant(year, month0 - 1, 1, 0, 0);
}

/** True iff the rental at `startsAt` is within its customer booking window at `now`. */
export function isRentalBookingOpen(startsAt: Date, now: Date): boolean {
  return now.getTime() >= rentalBookingOpensAt(startsAt).getTime();
}

/** A time-boxed class candidate for the in-memory overlap check. */
export interface TimeBox {
  startsAt: Date;
  durationMin: number;
  type: ClassType;
}

/** Half-open interval overlap of two time boxes: a.start < b.end AND b.start < a.end. */
function intervalsOverlap(a: TimeBox, b: TimeBox): boolean {
  const aEnd = a.startsAt.getTime() + a.durationMin * 60_000;
  const bEnd = b.startsAt.getTime() + b.durationMin * 60_000;
  return a.startsAt.getTime() < bEnd && b.startsAt.getTime() < aEnd;
}

/**
 * Pure rental-scoped room conflict between two candidates (for in-memory batch checks
 * where neither is persisted yet, e.g. generateWeekFromBaseline). Conflict iff at
 * least ONE is a rental AND their intervals overlap — mirrors the DB `hasRoomConflict`
 * rule. Two non-rentals never conflict.
 */
export function rentalRoomOverlap(a: TimeBox, b: TimeBox): boolean {
  if (a.type !== "rental" && b.type !== "rental") return false;
  return intervalsOverlap(a, b);
}

/** A drizzle executor — the pooled db OR an open transaction both satisfy this. */
type Executor = Pick<Database, "select">;

/**
 * Does placing/booking a class of `candidateType` at [startsAt, startsAt+durationMin)
 * violate room exclusivity against the CURRENT active instances?
 *
 * Conflict = a RENTAL-vs-anything time overlap:
 *   - candidate is a RENTAL  → ANY active instance overlapping is a conflict;
 *   - candidate is NON-rental → only an active RENTAL overlapping is a conflict.
 *
 * Two non-rental classes never conflict here (no global no-overlap — that would
 * change existing behaviour). Overlap is half-open interval intersection:
 * existing.start < candidate.end AND existing.end > candidate.start. `excludeId`
 * omits the row being updated/booked itself. Cancelled instances are ignored.
 */
export async function hasRoomConflict(
  exec: Executor,
  startsAt: Date,
  durationMin: number,
  candidateType: ClassType,
  opts: { excludeId?: string } = {},
): Promise<boolean> {
  const candidateEnd = new Date(startsAt.getTime() + durationMin * 60_000);

  const conditions = [
    ne(classInstances.status, "cancelled"),
    // Half-open interval overlap: existing.start < candEnd AND existing.end > candStart.
    sql`${classInstances.startsAt} < ${candidateEnd}`,
    sql`(${classInstances.startsAt} + make_interval(mins => ${classInstances.durationMin})) > ${startsAt}`,
  ];

  // A non-rental candidate only conflicts with an existing RENTAL; a rental candidate
  // conflicts with anything active.
  if (candidateType !== "rental") {
    conditions.push(sql`${classInstances.type} = 'rental'`);
  }
  if (opts.excludeId) {
    conditions.push(ne(classInstances.id, opts.excludeId));
  }

  const rows = await exec
    .select({ id: classInstances.id })
    .from(classInstances)
    .where(and(...conditions))
    .limit(1);

  return rows.length > 0;
}
