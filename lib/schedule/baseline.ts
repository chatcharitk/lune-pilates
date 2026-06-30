// The recurring weekly BASELINE (spec §2, CLAUDE.md §5 invariant 5).
//
// Group classes follow a weekly baseline the admin adjusts per-week and
// republishes; Private/Duo/Trio/Rental sit OUTSIDE the baseline (booked by
// appointment into any open hour). So the recurring template is group-only.
//
// v1 keeps the baseline as code — the single source of truth shared by the seed,
// the admin "generate from baseline" action, and the changes-vs-baseline diff.
// The `class_templates` table is reserved for a future editable baseline; until
// then this constant is authoritative so the three callers can never disagree.

import type { ClassType } from "@/lib/domain/types";
import { CAPACITY } from "@/lib/domain/types";
import {
  studioInstant,
  studioIsoDow,
  studioParts,
  studioStartOfWeekMonday,
} from "@/lib/time";

export interface BaselineSlot {
  /** ISO day of week: 1 = Monday … 7 = Sunday. */
  dayOfWeek: number;
  /** Local start time, "HH:MM". */
  time: string;
  type: ClassType;
  durationMin: number;
  capacity: number;
}

/** Group baseline times per ISO weekday (spec §2 Operating model). */
const GROUP_TIMES_BY_DOW: Record<number, string[]> = {
  1: ["08:00", "09:00", "16:00", "17:00"], // Mon
  2: ["09:00", "10:00", "17:00", "18:00"], // Tue
  3: ["08:00", "09:00", "16:00", "17:00"], // Wed
  4: ["09:00", "10:00", "17:00", "18:00"], // Thu
  5: ["08:00", "09:00", "16:00", "17:00"], // Fri
  6: ["09:00", "10:00", "11:00", "17:00"], // Sat
  7: ["09:00", "10:00", "11:00", "17:00"], // Sun
};

/** Every baseline slot, flattened. Group-only, 60-minute, capacity = group cap. */
export const BASELINE_SLOTS: BaselineSlot[] = Object.entries(GROUP_TIMES_BY_DOW).flatMap(
  ([dow, times]) =>
    times.map(
      (time): BaselineSlot => ({
        dayOfWeek: Number(dow),
        time,
        type: "group",
        durationMin: 60,
        capacity: CAPACITY.group,
      }),
    ),
);

/**
 * ISO day of week (1 = Mon … 7 = Sun) of an instant, in BANGKOK time (studio time)
 * — independent of the runtime timezone (CLAUDE.md: all class times are ICT).
 */
export function isoDayOfWeek(date: Date): number {
  return studioIsoDow(date);
}

/** The baseline slots that fall on the given date's BANGKOK weekday. */
export function baselineSlotsForDate(date: Date): BaselineSlot[] {
  const dow = isoDayOfWeek(date);
  return BASELINE_SLOTS.filter((s) => s.dayOfWeek === dow);
}

/** The instant of Bangkok Monday 00:00 of the week containing `date`. */
export function startOfWeekMonday(date: Date): Date {
  return studioStartOfWeekMonday(date);
}

/**
 * Build the start instant for `time` ("HH:MM") on the BANGKOK calendar day of
 * `date`. Pinned to Asia/Bangkok wall-clock so the stored `timestamptz` is the
 * correct ICT instant regardless of the runtime timezone.
 */
export function startsAtFor(date: Date, time: string): Date {
  const [h, m] = time.split(":").map((n) => Number.parseInt(n, 10));
  const { year, month0, day } = studioParts(date);
  return studioInstant(year, month0, day, h ?? 0, m ?? 0);
}
