// Read model for the admin "Instructors" screen (spec §4; prototypes
// admin-more.jsx `InstructorsScreen` + admin-mobile-more.jsx `MInstructors` /
// `MAvailEditor`). Returns, per active instructor: their bilingual name + tag, an
// avatar initial, TODAY's classes with live roster counts, the rolled-up class /
// attendee totals, today's availability ranges (+ an off-today flag), and the full
// weekly availability the editor binds to.
//
// Like every other lib/admin/* read model this is READ-ONLY and does NOT apply
// tiered visibility — the front desk sees the whole schedule. Roster counts come
// live from the bookings table (the source of truth) so they can never drift, and
// today's-classes logic mirrors lib/admin/today.ts exactly (same studio-day window,
// same effective-capacity clamp) rather than reinventing it.
//
// No-DB dev fallback: when DATABASE_URL is unset the function returns mock data
// mirroring admin-data.jsx (AINSTR) + admin-mobile-data.jsx (GANTT_DAY / AVAIL_DAY /
// AVAIL_WEEK), anchored to "today", so the screen renders without a database.

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  bookings,
  classInstances,
  instructorAvailability,
  instructors,
} from "@/lib/db/schema";
import type { Bilingual } from "@/lib/i18n";
import type { ClassType } from "@/lib/domain/types";
import { effectiveCapacity } from "@/lib/domain/types";
import { instructorMetaFor, metaFor, type ClassTypeMeta } from "@/lib/schedule/queries";

// ───────────────────────── contract (frontend imports these) ─────────────────────────

/** Ordered weekday keys for the availability editor (Mon-first, matching the prototype). */
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** A single working time-range, "HH:MM" 24h, end > start. */
export interface AvailabilityRange {
  start: string;
  end: string;
}

/** A full weekly availability template, one (possibly empty) range list per weekday. */
export type WeekAvailability = Record<Weekday, AvailabilityRange[]>;

/** One of an instructor's classes happening today, in start-time order. */
export interface AdminInstructorClass {
  id: string;
  /** Local start time, "HH:MM" 24h. */
  time: string;
  type: ClassType;
  typeMeta: ClassTypeMeta;
  /** Live booked count (source of truth = bookings table). */
  booked: number;
  /** Effective (hard-capped) capacity — the same one the booking debit uses. */
  capacity: number;
}

/** One instructor card on the admin Instructors screen. */
export interface AdminInstructor {
  id: string;
  name: Bilingual;
  tag: Bilingual | null;
  /**
   * Raw EN name as stored on the row (= name.en) — the value the owner edit form
   * binds to and submits back to updateInstructor. Exposed explicitly so the form
   * never has to reach through the resolved Bilingual/meta wrapping.
   */
  nameEn: string;
  /** Raw TH name as stored on the row (= name.th) — the edit form's TH field. */
  nameRawTh: string;
  /** Raw editable tag text (the stored instructors.tag, or "" when null). */
  tagRaw: string;
  /** Whether this instructor is active (always true in this active-only list). */
  active: boolean;
  /** Avatar initial (e.g. "M" / "P" / "N"), derived from the name. */
  initials: string;
  todaysClasses: AdminInstructorClass[];
  /** Number of classes today (= todaysClasses.length). */
  classCount: number;
  /** Sum of booked across today's classes. */
  attendees: number;
  /** Today's working ranges (rows for today's weekday), sorted by start. */
  todayAvailability: AvailabilityRange[];
  /** True when the instructor has no ranges today (Day off). */
  offToday: boolean;
  /** Full weekly availability for the editor; sorted within each day. */
  weekAvailability: WeekAvailability;
}

// ───────────────────────── pure helpers ─────────────────────────

/** Midnight (local) of `d`. */
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** ISO weekday (1=Mon … 7=Sun) for a Date (JS getDay is 0=Sun … 6=Sat). */
function isoDayOfWeek(d: Date): number {
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

/** Weekday key (Mon…Sun) for an ISO day-of-week (1…7). */
function weekdayKey(dow: number): Weekday {
  return WEEKDAYS[dow - 1]!;
}

/** Local "HH:MM" 24h of a Date. */
function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** First letter of the last whitespace-separated token of the EN name (e.g. "Kru Mai" → "M"). */
function initialsFor(name: Bilingual): string {
  const tokens = name.en.trim().split(/\s+/).filter(Boolean);
  const last = tokens[tokens.length - 1] ?? name.en.trim();
  return (last.charAt(0) || "?").toUpperCase();
}

/** An empty week template (every day off) — the base for assembling weekAvailability. */
function emptyWeek(): WeekAvailability {
  return {
    Mon: [],
    Tue: [],
    Wed: [],
    Thu: [],
    Fri: [],
    Sat: [],
    Sun: [],
  };
}

const byStart = (a: AvailabilityRange, b: AvailabilityRange): number => a.start.localeCompare(b.start);

// ───────────────────────── public query ─────────────────────────

/**
 * All ACTIVE instructors with today's classes (+ live roster counts), today's
 * availability, and the full weekly availability for the editor. Ordered by name
 * for a stable, deterministic listing.
 *
 * No-DB fallback: returns mock data mirroring the prototype seed so the screen
 * renders without a database. The DB path is authoritative.
 */
export async function getAdminInstructors(now: Date = new Date()): Promise<AdminInstructor[]> {
  const dayStart = startOfDay(now);

  if (!process.env.DATABASE_URL) {
    return mockAdminInstructors(dayStart);
  }

  const db = getDb();
  const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000);
  const todayDow = isoDayOfWeek(dayStart);

  // 1) Active instructors, stably ordered.
  const instrRows = await db
    .select({
      id: instructors.id,
      name: instructors.name,
      nameTh: instructors.nameTh,
      tag: instructors.tag,
    })
    .from(instructors)
    .where(eq(instructors.active, true))
    .orderBy(asc(instructors.name));

  if (instrRows.length === 0) return [];

  const instrIds = instrRows.map((i) => i.id);

  // 2) Today's classes for those instructors, with a live booked count.
  const bookedCount = sql<number>`(
    select count(*)::int from ${bookings}
    where ${bookings.classInstanceId} = ${classInstances.id}
      and ${bookings.status} = 'booked'
  )`;
  const classRows = await db
    .select({
      id: classInstances.id,
      startsAt: classInstances.startsAt,
      type: classInstances.type,
      capacity: classInstances.capacity,
      instructorId: classInstances.instructorId,
      booked: bookedCount,
    })
    .from(classInstances)
    .where(
      and(
        inArray(classInstances.instructorId, instrIds),
        sql`${classInstances.startsAt} >= ${dayStart}`,
        sql`${classInstances.startsAt} < ${dayEnd}`,
      ),
    )
    .orderBy(asc(classInstances.startsAt));

  // 3) All availability rows for those instructors (whole week → editor + today).
  const availRows = await db
    .select({
      instructorId: instructorAvailability.instructorId,
      dayOfWeek: instructorAvailability.dayOfWeek,
      startTime: instructorAvailability.startTime,
      endTime: instructorAvailability.endTime,
    })
    .from(instructorAvailability)
    .where(inArray(instructorAvailability.instructorId, instrIds));

  // Group classes by instructor.
  const classesByInstr = new Map<string, AdminInstructorClass[]>();
  for (const c of classRows) {
    if (!c.instructorId) continue;
    const list = classesByInstr.get(c.instructorId) ?? [];
    const capacity = effectiveCapacity(c.capacity, c.type);
    list.push({
      id: c.id,
      time: hhmm(c.startsAt),
      type: c.type,
      typeMeta: metaFor(c.type),
      booked: c.booked ?? 0,
      capacity,
    });
    classesByInstr.set(c.instructorId, list);
  }

  // Group availability into a full week per instructor.
  const weekByInstr = new Map<string, WeekAvailability>();
  for (const a of availRows) {
    const week = weekByInstr.get(a.instructorId) ?? emptyWeek();
    const key = weekdayKey(a.dayOfWeek);
    week[key].push({ start: a.startTime, end: a.endTime });
    weekByInstr.set(a.instructorId, week);
  }

  return instrRows.map((ins) => {
    const name: Bilingual = { en: ins.name, th: ins.nameTh };
    const meta = instructorMetaFor(ins.id, ins.name, ins.nameTh, ins.tag);
    const week = weekByInstr.get(ins.id) ?? emptyWeek();
    for (const key of WEEKDAYS) week[key].sort(byStart);
    const todayAvailability = [...week[weekdayKey(todayDow)]];
    const todaysClasses = classesByInstr.get(ins.id) ?? [];
    return {
      id: ins.id,
      name,
      tag: meta?.tag ?? (ins.tag ? { en: ins.tag, th: ins.tag } : null),
      // Raw editable fields come from the DB ROW (never the static catalog meta), so
      // the owner edit form binds to what is actually persisted.
      nameEn: ins.name,
      nameRawTh: ins.nameTh,
      tagRaw: ins.tag ?? "",
      active: true, // this query is active-only (where active = true)
      initials: initialsFor(name),
      todaysClasses,
      classCount: todaysClasses.length,
      attendees: todaysClasses.reduce((sum, c) => sum + c.booked, 0),
      todayAvailability,
      offToday: todayAvailability.length === 0,
      weekAvailability: week,
    };
  });
}

// ───────────────────────── no-DB mock fallback ─────────────────────────
// Mirrors admin-data.jsx (AINSTR) + admin-mobile-data.jsx (GANTT_DAY / AVAIL_DAY /
// AVAIL_WEEK) so the screen renders without a database. The DB path is authoritative.

interface MockGanttClass {
  time: string; // "HH:MM"
  type: ClassType;
  booked: number;
}

// GANTT_DAY (admin-mobile-data.jsx) — today's classes per instructor. The prototype
// carries no per-class roster count, so we mirror the desktop InstructorsScreen,
// which reads roster length from TODAY; here we use the type's full cap as a
// believable "booked" for the mock (the DB path is the real source of truth).
const MOCK_GANTT: Record<string, MockGanttClass[]> = {
  mai: [
    { time: "07:00", type: "group", booked: 3 },
    { time: "09:00", type: "private", booked: 1 },
    { time: "17:30", type: "group", booked: 2 },
  ],
  ploy: [
    { time: "08:00", type: "group", booked: 2 },
    { time: "11:00", type: "duo", booked: 2 },
    { time: "18:30", type: "group", booked: 3 },
  ],
  nina: [
    { time: "09:30", type: "private", booked: 1 },
    { time: "17:00", type: "trio", booked: 2 },
  ],
};

// AVAIL_WEEK (admin-mobile-data.jsx) — the editor's source of truth, per instructor.
const MOCK_AVAIL_WEEK: Record<string, Record<Weekday, [string, string][]>> = {
  mai: {
    Mon: [["07:00", "13:00"], ["17:00", "19:00"]],
    Tue: [["07:00", "13:00"]],
    Wed: [["07:00", "12:00"]],
    Thu: [["07:00", "13:00"], ["17:00", "19:00"]],
    Fri: [["07:00", "13:00"]],
    Sat: [["08:00", "12:00"]],
    Sun: [],
  },
  ploy: {
    Mon: [["08:00", "12:00"], ["17:00", "20:00"]],
    Tue: [["17:00", "20:00"]],
    Wed: [["08:00", "12:00"], ["17:00", "20:00"]],
    Thu: [["17:00", "20:00"]],
    Fri: [["08:00", "12:00"], ["17:00", "20:00"]],
    Sat: [["09:00", "13:00"]],
    Sun: [["09:00", "12:00"]],
  },
  nina: {
    Mon: [["09:00", "12:00"], ["16:00", "18:30"]],
    Tue: [["09:00", "12:00"]],
    Wed: [],
    Thu: [["09:00", "12:00"], ["16:00", "18:30"]],
    Fri: [["09:00", "12:00"]],
    Sat: [],
    Sun: [],
  },
};

const MOCK_ORDER = ["mai", "ploy", "nina"] as const;

function weekFromMock(raw: Record<Weekday, [string, string][]>): WeekAvailability {
  const week = emptyWeek();
  for (const key of WEEKDAYS) {
    week[key] = raw[key]
      .map(([start, end]) => ({ start, end }))
      .sort(byStart);
  }
  return week;
}

function mockAdminInstructors(dayStart: Date): AdminInstructor[] {
  const todayDow = isoDayOfWeek(dayStart);
  return MOCK_ORDER.map((id) => {
    const meta = instructorMetaFor(id)!; // mai/ploy/nina are in the static catalog
    const week = weekFromMock(MOCK_AVAIL_WEEK[id]!);
    const todayAvailability = [...week[weekdayKey(todayDow)]];
    const todaysClasses: AdminInstructorClass[] = (MOCK_GANTT[id] ?? []).map((g, i) => ({
      id: `${id}-c${i + 1}`,
      time: g.time,
      type: g.type,
      typeMeta: metaFor(g.type),
      booked: Math.min(g.booked, effectiveCapacity(99, g.type)),
      capacity: effectiveCapacity(99, g.type),
    }));
    return {
      id,
      name: meta.name,
      tag: meta.tag,
      nameEn: meta.name.en,
      nameRawTh: meta.name.th,
      tagRaw: meta.tag?.en ?? "",
      active: true,
      initials: initialsFor(meta.name),
      todaysClasses,
      classCount: todaysClasses.length,
      attendees: todaysClasses.reduce((sum, c) => sum + c.booked, 0),
      todayAvailability,
      offToday: todayAvailability.length === 0,
      weekAvailability: week,
    };
  });
}
