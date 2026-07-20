// Read model for the admin Schedule management screen (spec §4, admin-schedule.jsx).
// Returns one week of class instances grouped by day, each with its live booked
// count, plus a changes-vs-baseline diff. Instances are born `published` (the
// draft→publish ceremony was removed); draft/published counts remain in the
// contract for any pre-existing draft rows.
//
// This is the studio's own schedule, so — like the Today read model — it does NOT
// apply tiered visibility. Booked counts come live from the bookings table.
//
// No-DB dev fallback: when DATABASE_URL is unset it returns the baseline
// materialised as published instances for the week (plus a couple of appointment
// classes), so the screen renders without a database. The DB path is the real one.

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
  BASELINE_SLOTS,
  baselineSlotsForDate,
  isoDayOfWeek,
  startOfWeekMonday,
  startsAtFor,
} from "@/lib/schedule/baseline";
import { addDays, formatStudioTime, studioStartOfDay } from "@/lib/time";
import { mockDataMode } from "@/lib/mock-mode";
import {
  getTemplateSlotsByDow,
  type TemplateBaselineSlot,
} from "@/lib/admin/schedule-template";

// ───────────────────────── contract ─────────────────────────

export interface AdminScheduleClass {
  id: string;
  startsAt: string; // ISO 8601
  /** Local "HH:MM" of startsAt — for display and to seed the editor. */
  time: string;
  durationMin: number;
  type: ClassType;
  typeMeta: ClassTypeMeta;
  /** Optional custom class name; null → show the type label. */
  name: string | null;
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

/** Changes of this week's instances vs the editable recurring template. */
export interface BaselineDiff {
  /** Instances with no matching template slot (incl. all appointment classes). */
  added: number;
  /** Template slots with no instance this week (cancelled vs the template). */
  removed: number;
  /** Matched template slots whose capacity differs from the template. */
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
  return formatStudioTime(d);
}

const slotKey = (dayOfWeek: number, time: string, type: ClassType) =>
  `${dayOfWeek}|${time}|${type}`;

/**
 * Compute the changes-vs-template diff for a week's assembled days against the
 * EDITABLE template slots grouped by ISO weekday (`templateByDow`). A class matches a
 * template slot on (dayOfWeek, time, type); a matched slot whose capacity differs is
 * `changed`; a class with no matching slot is `added`; a template slot with no
 * instance this week is `removed`.
 */
function computeDiff(
  days: AdminScheduleDay[],
  templateByDow: Map<number, TemplateBaselineSlot[]>,
): BaselineDiff {
  // Template slots keyed by (dow|time|type) with their template capacity.
  const template = new Map<string, number>();
  for (const day of days) {
    for (const slot of templateByDow.get(day.dayOfWeek) ?? []) {
      template.set(slotKey(slot.dayOfWeek, slot.time, slot.type), slot.capacity);
    }
  }

  const seenTemplate = new Set<string>();
  let added = 0;
  let changed = 0;
  for (const day of days) {
    for (const c of day.classes) {
      const key = slotKey(day.dayOfWeek, c.time, c.type);
      const baseCap = template.get(key);
      if (baseCap === undefined) {
        added++; // no template slot (appointment class, or a slot at a new time/type)
      } else {
        seenTemplate.add(key);
        if (c.capacity !== baseCap) changed++;
      }
    }
  }
  const removed = [...template.keys()].filter((k) => !seenTemplate.has(k)).length;
  return { added, removed, changed };
}

/** Build the 7 empty day buckets (Mon..Sun) for `weekStart` (Bangkok days). */
function emptyWeek(weekStart: Date): AdminScheduleDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    return { date: date.toISOString(), dayOfWeek: isoDayOfWeek(date), classes: [] };
  });
}

function shape(row: {
  id: string;
  startsAt: Date;
  durationMin: number;
  type: ClassType;
  name: string | null;
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
    name: row.name,
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

function assemble(
  weekStart: Date,
  classes: AdminScheduleClass[],
  templateByDow: Map<number, TemplateBaselineSlot[]>,
): AdminWeekSchedule {
  const days = emptyWeek(weekStart);
  // Bucket by the Bangkok day-start instant so a class lands on its STUDIO day,
  // not the runtime-TZ day (toDateString would shift on a UTC host).
  const byDate = new Map(days.map((d) => [studioStartOfDay(new Date(d.date)).getTime(), d]));
  for (const c of classes) {
    const day = byDate.get(studioStartOfDay(new Date(c.startsAt)).getTime());
    if (day) day.classes.push(c);
  }
  for (const d of days) d.classes.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return {
    weekStart: weekStart.toISOString(),
    days,
    draftCount: classes.filter((c) => c.status === "draft").length,
    publishedCount: classes.filter((c) => c.status === "published").length,
    diff: computeDiff(days, templateByDow),
  };
}

// ───────────────────────── public query ─────────────────────────

/**
 * One week of class instances (draft + published) grouped by day, with live
 * booked counts and the changes-vs-baseline diff. `anyDate` is snapped to the
 * Monday of its week.
 */
export async function getWeekSchedule(
  anyDate: Date = new Date(),
  opts?: { instructorId?: string },
): Promise<AdminWeekSchedule> {
  const weekStart = startOfWeekMonday(anyDate);
  const scopeInstructorId = opts?.instructorId;

  if (mockDataMode()) {
    const week = mockWeekSchedule(weekStart);
    if (!scopeInstructorId) return week;
    // Instructor scope on the mock: keep only their classes per day.
    return {
      ...week,
      days: week.days.map((d) => ({
        ...d,
        classes: d.classes.filter((c) => c.instructorId === scopeInstructorId),
      })),
    };
  }

  const db = getDb();
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3_600_000);

  const bookedCount = sql<number>`(
    select count(*)::int from ${bookings}
    where ${bookings.classInstanceId} = ${classInstances.id}
      and ${bookings.status} = 'booked'
  )`;

  // The editable template (active class_templates rows, grouped by ISO weekday;
  // falls back to BASELINE_SLOTS when the table is empty) — the diff compares this
  // week's instances against it. Independent of the instances query, so both run
  // in ONE parallel round trip.
  const [templateByDow, rows] = await Promise.all([
    getTemplateSlotsByDow(),
    db
    .select({
      id: classInstances.id,
      startsAt: classInstances.startsAt,
      durationMin: classInstances.durationMin,
      type: classInstances.type,
      name: classInstances.name,
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
        // Instructor sessions see only THEIR classes (role scoping, like Today).
        ...(scopeInstructorId ? [eq(classInstances.instructorId, scopeInstructorId)] : []),
      ),
    )
    .orderBy(asc(classInstances.startsAt)),
  ]);

  return assemble(
    weekStart,
    rows.map((r) => shape({ ...r, booked: r.booked ?? 0 })),
    templateByDow,
  );
}

// ───────────────────────── no-DB mock fallback ─────────────────────────
// The baseline materialised for the week, plus a couple of appointment classes,
// so the screen (and the diff) render without a database. Everything is
// `published` — instances are born live (the draft→publish ceremony was removed;
// draftCount stays in the contract only for pre-existing draft rows in the DB path).

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

  // Baseline group slots → live (published) instances for the whole week.
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    for (const slot of baselineSlotsForDate(date)) {
      const startsAt = startsAtFor(date, slot.time);
      classes.push({
        id: mockUuid(n++),
        startsAt: startsAt.toISOString(),
        time: slot.time,
        durationMin: slot.durationMin,
        type: "group",
        typeMeta: metaFor("group"),
        name: null,
        instructorId: null,
        instructor: null,
        capacity: slot.capacity,
        booked: (i + slot.time.length) % 4, // some believable spread
        status: "published",
      });
    }
  }

  for (const a of MOCK_APPOINTMENTS) {
    const date = addDays(weekStart, a.dayIndex);
    const startsAt = startsAtFor(date, a.time);
    classes.push({
      id: mockUuid(n++),
      startsAt: startsAt.toISOString(),
      time: a.time,
      durationMin: a.type === "group" ? 60 : 50,
      type: a.type,
      typeMeta: metaFor(a.type),
      name: null,
      instructorId: a.instr,
      instructor: instructorMetaFor(a.instr),
      capacity: effectiveCapacity(99, a.type),
      booked: a.booked,
      status: "published",
    });
  }

  // No-DB diff source = the BASELINE_SLOTS fallback grouped by weekday (identical to
  // getTemplateSlotsByDow's no-DB return), so the mock screen's diff is unchanged.
  const templateByDow = new Map<number, TemplateBaselineSlot[]>();
  for (const s of BASELINE_SLOTS) {
    const slot: TemplateBaselineSlot = { ...s, templateId: null, instructorId: null, name: null };
    const list = templateByDow.get(s.dayOfWeek) ?? [];
    list.push(slot);
    templateByDow.set(s.dayOfWeek, list);
  }

  return assemble(weekStart, classes, templateByDow);
}
