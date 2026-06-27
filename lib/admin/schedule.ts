// Read model for the admin Schedule management screen (spec §4 "Schedule mgmt —
// baseline + publish", admin-schedule.jsx). Returns one week of class instances
// grouped by day (draft + published), each with its live booked count, plus a
// changes-vs-baseline diff so the admin can review what changed before publishing.
//
// This is the studio's own schedule, so — like the Today read model — it does NOT
// apply tiered visibility. Booked counts come live from the bookings table.
//
// No-DB dev fallback: when DATABASE_URL is unset it returns the baseline
// materialised as drafts for the week (plus a couple of appointment classes), so
// the screen renders without a database. The DB path is the real one.

import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { bookings, classInstances, instructors } from "@/lib/db/schema";
import type { ClassStatus, ClassType } from "@/lib/domain/types";
import { effectiveCapacity } from "@/lib/domain/types";
import {
  instructorMetaFor,
  metaFor,
  type ClassTypeMeta,
  type InstructorMeta,
} from "@/lib/schedule/queries";
import {
  baselineSlotsForDate,
  isoDayOfWeek,
  startOfWeekMonday,
  startsAtFor,
} from "@/lib/schedule/baseline";

// ───────────────────────── contract ─────────────────────────

export interface AdminScheduleClass {
  id: string;
  startsAt: string; // ISO 8601
  /** Local "HH:MM" of startsAt — for display and to seed the editor. */
  time: string;
  durationMin: number;
  type: ClassType;
  typeMeta: ClassTypeMeta;
  instructorId: string | null;
  instructor: InstructorMeta | null;
  capacity: number;
  booked: number;
  status: ClassStatus;
}

export interface AdminScheduleDay {
  /** ISO midnight of the day. */
  date: string;
  /** ISO day of week 1..7 (Mon..Sun). */
  dayOfWeek: number;
  classes: AdminScheduleClass[];
}

/** Changes of this week's instances vs the recurring baseline (group slots). */
export interface BaselineDiff {
  /** Instances with no matching baseline slot (incl. all appointment classes). */
  added: number;
  /** Baseline group slots with no instance this week (cancelled vs baseline). */
  removed: number;
  /** Matched baseline group slots whose capacity differs from the baseline. */
  changed: number;
}

export interface AdminWeekSchedule {
  /** ISO Monday midnight of the week. */
  weekStart: string;
  days: AdminScheduleDay[]; // always 7, Mon..Sun
  draftCount: number;
  publishedCount: number;
  diff: BaselineDiff;
}

// ───────────────────────── helpers ─────────────────────────

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const slotKey = (dayOfWeek: number, time: string) => `${dayOfWeek}|${time}`;

/** Compute the changes-vs-baseline diff for a week's assembled days. */
function computeDiff(days: AdminScheduleDay[]): BaselineDiff {
  // Baseline group slots keyed by (dow|time) with their baseline capacity.
  const baseline = new Map<string, number>();
  for (const day of days) {
    for (const slot of baselineSlotsForDate(new Date(day.date))) {
      baseline.set(slotKey(slot.dayOfWeek, slot.time), slot.capacity);
    }
  }

  const seenBaseline = new Set<string>();
  let added = 0;
  let changed = 0;
  for (const day of days) {
    for (const c of day.classes) {
      const key = slotKey(day.dayOfWeek, c.time);
      const baseCap = c.type === "group" ? baseline.get(key) : undefined;
      if (baseCap === undefined) {
        added++; // no baseline slot (appointment class, or a group at a new time)
      } else {
        seenBaseline.add(key);
        if (c.capacity !== baseCap) changed++;
      }
    }
  }
  const removed = [...baseline.keys()].filter((k) => !seenBaseline.has(k)).length;
  return { added, removed, changed };
}

/** Build the 7 empty day buckets (Mon..Sun) for `weekStart`. */
function emptyWeek(weekStart: Date): AdminScheduleDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + i);
    return { date: date.toISOString(), dayOfWeek: isoDayOfWeek(date), classes: [] };
  });
}

function shape(row: {
  id: string;
  startsAt: Date;
  durationMin: number;
  type: ClassType;
  capacity: number;
  status: ClassStatus;
  instructorId: string | null;
  instructorName: string | null;
  instructorNameTh: string | null;
  instructorTag: string | null;
  booked: number;
}): AdminScheduleClass {
  return {
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    time: hhmm(row.startsAt),
    durationMin: row.durationMin,
    type: row.type,
    typeMeta: metaFor(row.type),
    instructorId: row.instructorId,
    instructor: instructorMetaFor(
      row.instructorId,
      row.instructorName ?? undefined,
      row.instructorNameTh ?? undefined,
      row.instructorTag,
    ),
    capacity: effectiveCapacity(row.capacity, row.type),
    booked: row.booked,
    status: row.status,
  };
}

function assemble(weekStart: Date, classes: AdminScheduleClass[]): AdminWeekSchedule {
  const days = emptyWeek(weekStart);
  const byDate = new Map(days.map((d) => [new Date(d.date).toDateString(), d]));
  for (const c of classes) {
    const day = byDate.get(new Date(c.startsAt).toDateString());
    if (day) day.classes.push(c);
  }
  for (const d of days) d.classes.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return {
    weekStart: weekStart.toISOString(),
    days,
    draftCount: classes.filter((c) => c.status === "draft").length,
    publishedCount: classes.filter((c) => c.status === "published").length,
    diff: computeDiff(days),
  };
}

// ───────────────────────── public query ─────────────────────────

/**
 * One week of class instances (draft + published) grouped by day, with live
 * booked counts and the changes-vs-baseline diff. `anyDate` is snapped to the
 * Monday of its week.
 */
export async function getWeekSchedule(anyDate: Date = new Date()): Promise<AdminWeekSchedule> {
  const weekStart = startOfWeekMonday(anyDate);

  if (!process.env.DATABASE_URL) {
    return mockWeekSchedule(weekStart);
  }

  const db = getDb();
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3_600_000);

  const bookedCount = sql<number>`(
    select count(*)::int from ${bookings}
    where ${bookings.classInstanceId} = ${classInstances.id}
      and ${bookings.status} = 'booked'
  )`;

  const rows = await db
    .select({
      id: classInstances.id,
      startsAt: classInstances.startsAt,
      durationMin: classInstances.durationMin,
      type: classInstances.type,
      capacity: classInstances.capacity,
      status: classInstances.status,
      instructorId: classInstances.instructorId,
      instructorName: instructors.name,
      instructorNameTh: instructors.nameTh,
      instructorTag: instructors.tag,
      booked: bookedCount,
    })
    .from(classInstances)
    .leftJoin(instructors, eq(classInstances.instructorId, instructors.id))
    .where(
      and(
        sql`${classInstances.startsAt} >= ${weekStart}`,
        sql`${classInstances.startsAt} < ${weekEnd}`,
      ),
    )
    .orderBy(asc(classInstances.startsAt));

  return assemble(
    weekStart,
    rows.map((r) => shape({ ...r, booked: r.booked ?? 0 })),
  );
}

// ───────────────────────── no-DB mock fallback ─────────────────────────
// The baseline materialised as drafts for the week, plus a couple of appointment
// classes, so the screen (and the diff) render without a database.

function mockUuid(n: number): string {
  return `00000000-0000-4000-9000-${n.toString(16).padStart(12, "0")}`;
}

interface MockAppointment {
  dayIndex: number; // 0=Mon..6=Sun
  time: string;
  type: ClassType;
  instr: string;
  booked: number;
}

const MOCK_APPOINTMENTS: MockAppointment[] = [
  { dayIndex: 2, time: "13:00", type: "duo", instr: "ploy", booked: 1 }, // Wed Duo (added vs baseline)
  { dayIndex: 4, time: "12:00", type: "private", instr: "nina", booked: 1 }, // Fri Private
];

function mockWeekSchedule(weekStart: Date): AdminWeekSchedule {
  const classes: AdminScheduleClass[] = [];
  let n = 1;

  // Baseline group slots → published drafts for the week (most days), with the
  // first day's classes left as draft to exercise the publish bar.
  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + i);
    for (const slot of baselineSlotsForDate(date)) {
      const startsAt = startsAtFor(date, slot.time);
      classes.push({
        id: mockUuid(n++),
        startsAt: startsAt.toISOString(),
        time: slot.time,
        durationMin: slot.durationMin,
        type: "group",
        typeMeta: metaFor("group"),
        instructorId: null,
        instructor: null,
        capacity: slot.capacity,
        booked: (i + slot.time.length) % 4, // some believable spread
        status: i === 0 ? "draft" : "published",
      });
    }
  }

  for (const a of MOCK_APPOINTMENTS) {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + a.dayIndex);
    const startsAt = startsAtFor(date, a.time);
    classes.push({
      id: mockUuid(n++),
      startsAt: startsAt.toISOString(),
      time: a.time,
      durationMin: a.type === "group" ? 60 : 50,
      type: a.type,
      typeMeta: metaFor(a.type),
      instructorId: a.instr,
      instructor: instructorMetaFor(a.instr),
      capacity: effectiveCapacity(99, a.type),
      booked: a.booked,
      status: "draft",
    });
  }

  return assemble(weekStart, classes);
}
