// Read model for the admin "Today at a glance" screen (spec §4, admin-today.jsx).
// Returns every class happening today with its live roster (attendees + check-in
// state), its waitlist, and the aggregate stat tiles. Read-only: check-in itself
// is a separate write (app/actions/admin.ts).
//
// The admin view is the studio's OWN schedule, so unlike the customer queries it
// does NOT apply tiered visibility — the front desk sees every class regardless
// of member/guest gating. Seat counts come live from the bookings table (the
// source of truth) so they can never drift.
//
// No-DB dev fallback: when DATABASE_URL is unset the functions return mock data
// mirroring admin-data.jsx (TODAY / MEMBERS), anchored to "today", so the screen
// renders without a database. The DB path is the real one.

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { studioInstant, studioParts, studioStartOfDay } from "@/lib/time";
import { bookings, classInstances, households, instructors, users, waitlist } from "@/lib/db/schema";
import type { ClassType, ReformerPosition } from "@/lib/domain/types";
import { effectiveCapacity } from "@/lib/domain/types";
import { mockDataMode } from "@/lib/mock-mode";
import {
  instructorMetaFor,
  metaFor,
  type ClassTypeMeta,
  type InstructorMeta,
} from "@/lib/schedule/queries";

// ───────────────────────── contract (frontend imports these) ─────────────────────────

/** One booked attendee on a class's roster. */
export interface AdminAttendee {
  bookingId: string;
  userId: string;
  name: string;
  phone: string;
  /** House number, or null for guests / unaffiliated users. */
  house: string | null;
  isMember: boolean;
  position: ReformerPosition | null;
  /** Checked in iff the booking carries a check-in timestamp (no separate flag). */
  checkedIn: boolean;
}

/** One person waiting on a full class, in FIFO order. */
export interface AdminWaitEntry {
  waitlistId: string;
  userId: string;
  name: string;
  phone: string;
  /** FIFO queue position (1 = head). */
  position: number;
  /** True when this entry holds a live offer (`status='offered'`). */
  offered: boolean;
}

/** A single class on the Today timeline, with roster + waitlist. */
export interface AdminTodayClass {
  id: string;
  startsAt: string; // ISO 8601
  endsAt: string; // ISO 8601 (startsAt + durationMin)
  durationMin: number;
  type: ClassType;
  typeMeta: ClassTypeMeta;
  instructor: InstructorMeta | null;
  /** Effective (hard-capped) capacity — the same one the booking debit uses. */
  capacity: number;
  booked: number;
  checkedIn: number;
  full: boolean;
  roster: AdminAttendee[];
  waitlist: AdminWaitEntry[];
}

/** The five stat tiles at the top of the Today screen. */
export interface AdminTodayStats {
  classes: number;
  attendees: number;
  capacity: number;
  checkedIn: number;
  waitlisted: number;
  /** Attendees / capacity as an integer percentage (0 when there is no capacity). */
  utilisation: number;
}

export interface AdminTodayOverview {
  /** Midnight of "today" (ISO) — the header date, formatted client-side per lang. */
  date: string;
  stats: AdminTodayStats;
  classes: AdminTodayClass[];
}

// ───────────────────────── pure helpers ─────────────────────────

/** The instant of Bangkok 00:00 (studio "today") of the day containing `d`. */
function startOfDay(d: Date): Date {
  return studioStartOfDay(d);
}

/** Roll up the stat tiles from the assembled class list. */
function computeStats(classes: AdminTodayClass[]): AdminTodayStats {
  let attendees = 0;
  let capacity = 0;
  let checkedIn = 0;
  let waitlisted = 0;
  for (const c of classes) {
    attendees += c.booked;
    capacity += c.capacity;
    checkedIn += c.checkedIn;
    waitlisted += c.waitlist.length;
  }
  return {
    classes: classes.length,
    attendees,
    capacity,
    checkedIn,
    waitlisted,
    utilisation: capacity > 0 ? Math.round((attendees / capacity) * 100) : 0,
  };
}

// ───────────────────────── public query ─────────────────────────

/**
 * Every class happening today (any status — the front desk sees the whole
 * schedule), each enriched with its live roster, waitlist and check-in counts,
 * plus the rolled-up stat tiles. Classes are ordered by start time.
 *
 * No-DB fallback: returns mock data mirroring admin-data.jsx so the screen
 * renders without a database.
 */
export async function getTodayOverview(
  now: Date = new Date(),
  opts?: { instructorId?: string },
): Promise<AdminTodayOverview> {
  const dayStart = startOfDay(now);
  const scopeInstructorId = opts?.instructorId;

  if (mockDataMode()) {
    return mockTodayOverview(dayStart, scopeInstructorId);
  }

  const db = getDb();
  const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000);

  // 1) Today's classes (all statuses) + instructor. When scoped to an instructor
  // (an instructor session — CLAUDE.md role gating), restrict to THEIR classes so
  // the screen + stats reflect only their day; an owner passes no scope (all).
  const classRows = await db
    .select({
      id: classInstances.id,
      startsAt: classInstances.startsAt,
      durationMin: classInstances.durationMin,
      type: classInstances.type,
      capacity: classInstances.capacity,
      instructorId: classInstances.instructorId,
      instructorName: instructors.name,
      instructorNameTh: instructors.nameTh,
      instructorTag: instructors.tag,
    })
    .from(classInstances)
    .leftJoin(instructors, eq(classInstances.instructorId, instructors.id))
    .where(
      and(
        sql`${classInstances.startsAt} >= ${dayStart}`,
        sql`${classInstances.startsAt} < ${dayEnd}`,
        ...(scopeInstructorId ? [eq(classInstances.instructorId, scopeInstructorId)] : []),
      ),
    )
    .orderBy(asc(classInstances.startsAt));

  if (classRows.length === 0) {
    return { date: dayStart.toISOString(), stats: computeStats([]), classes: [] };
  }

  const classIds = classRows.map((c) => c.id);

  // 2) All booked attendees on those classes + member/household context, and
  // 3) the live waitlist (waiting + offered), FIFO by position — both depend only
  // on `classIds`, so they run in ONE parallel round trip.
  const [bookingRows, waitRows] = await Promise.all([
    db
      .select({
        bookingId: bookings.id,
        classInstanceId: bookings.classInstanceId,
        userId: bookings.userId,
        position: bookings.position,
        checkedInAt: bookings.checkedInAt,
        name: users.name,
        phone: users.phone,
        tier: users.tier,
        house: households.houseNumber,
      })
      .from(bookings)
      .innerJoin(users, eq(bookings.userId, users.id))
      .leftJoin(households, eq(users.householdId, households.id))
      .where(and(inArray(bookings.classInstanceId, classIds), eq(bookings.status, "booked"))),
    db
      .select({
        waitlistId: waitlist.id,
        classInstanceId: waitlist.classInstanceId,
        userId: waitlist.userId,
        position: waitlist.position,
        status: waitlist.status,
        name: users.name,
        phone: users.phone,
      })
      .from(waitlist)
      .innerJoin(users, eq(waitlist.userId, users.id))
      .where(
        and(
          inArray(waitlist.classInstanceId, classIds),
          inArray(waitlist.status, ["waiting", "offered"]),
        ),
      )
      .orderBy(asc(waitlist.position)),
  ]);

  // Group bookings + waitlist by class id.
  const rosterByClass = new Map<string, AdminAttendee[]>();
  for (const b of bookingRows) {
    const list = rosterByClass.get(b.classInstanceId) ?? [];
    list.push({
      bookingId: b.bookingId,
      userId: b.userId,
      name: b.name,
      phone: b.phone,
      house: b.house ?? null,
      isMember: b.tier === "member",
      position: b.position,
      checkedIn: b.checkedInAt !== null,
    });
    rosterByClass.set(b.classInstanceId, list);
  }
  const waitByClass = new Map<string, AdminWaitEntry[]>();
  for (const w of waitRows) {
    const list = waitByClass.get(w.classInstanceId) ?? [];
    list.push({
      waitlistId: w.waitlistId,
      userId: w.userId,
      name: w.name,
      phone: w.phone,
      position: w.position,
      offered: w.status === "offered",
    });
    waitByClass.set(w.classInstanceId, list);
  }

  const classes: AdminTodayClass[] = classRows.map((c) => {
    const roster = rosterByClass.get(c.id) ?? [];
    const wl = waitByClass.get(c.id) ?? [];
    const capacity = effectiveCapacity(c.capacity, c.type);
    const checkedIn = roster.filter((r) => r.checkedIn).length;
    return {
      id: c.id,
      startsAt: c.startsAt.toISOString(),
      endsAt: new Date(c.startsAt.getTime() + c.durationMin * 60_000).toISOString(),
      durationMin: c.durationMin,
      type: c.type,
      typeMeta: metaFor(c.type),
      instructor: instructorMetaFor(
        c.instructorId,
        c.instructorName ?? undefined,
        c.instructorNameTh ?? undefined,
        c.instructorTag,
      ),
      capacity,
      booked: roster.length,
      checkedIn,
      full: roster.length >= capacity,
      roster,
      waitlist: wl,
    };
  });

  return { date: dayStart.toISOString(), stats: computeStats(classes), classes };
}

// ───────────────────────── no-DB mock fallback ─────────────────────────
// Mirrors admin-data.jsx (TODAY / MEMBERS), anchored to `dayStart` so the screen
// renders a believable day without a database. The DB path is authoritative.

interface MockMember {
  id: string;
  name: string;
  phone: string;
  house: string;
  member: boolean;
}

const MOCK_MEMBERS: Record<string, MockMember> = {
  m1: { id: "m1", name: "Pim Srisai", phone: "081 234 5678", house: "A-114", member: true },
  m2: { id: "m2", name: "Nok Charoen", phone: "089 887 1200", house: "B-203", member: true },
  m3: { id: "m3", name: "June Wattana", phone: "062 553 9981", house: "A-114", member: false },
  m4: { id: "m4", name: "Best Pongsak", phone: "084 119 2235", house: "C-007", member: true },
  m5: { id: "m5", name: "Fah Intira", phone: "090 442 0087", house: "C-007", member: true },
  m6: { id: "m6", name: "Mind Arunee", phone: "081 778 5512", house: "D-051", member: false },
  m7: { id: "m7", name: "Gus Theerapat", phone: "083 901 7766", house: "A-114", member: true },
  m8: { id: "m8", name: "Ann Kanya", phone: "086 220 4419", house: "E-088", member: true },
};

interface MockTodaySeed {
  id: string;
  time: string; // "HH:MM"
  dur: number;
  type: ClassType;
  instr: string;
  roster: [memberId: string, checkedIn: boolean][];
  wait?: string[]; // member ids, FIFO
}

const MOCK_TODAY: MockTodaySeed[] = [
  { id: "t1", time: "07:00", dur: 50, type: "group", instr: "mai", roster: [["m1", true], ["m3", true], ["m8", false]] },
  { id: "t2", time: "09:30", dur: 50, type: "private", instr: "nina", roster: [["m4", false]] },
  { id: "t3", time: "11:00", dur: 50, type: "duo", instr: "ploy", roster: [["m5", false], ["m2", false]] },
  { id: "t4", time: "17:30", dur: 50, type: "group", instr: "mai", roster: [["m1", false], ["m7", false], ["m8", false]], wait: ["m6", "m2"] },
  { id: "t5", time: "18:30", dur: 50, type: "group", instr: "ploy", roster: [["m3", false], ["m4", false]] },
];

const POS_BY_INDEX: ReformerPosition[] = ["left", "middle", "right"];

/**
 * A deterministic, valid v4-shaped UUID from a small integer, so mock booking
 * ids pass the same `z.string().uuid()` gate the real ids do — the check-in
 * action (app/actions/admin.ts) validates UUIDs, and the no-DB path must clear
 * that gate too or the optimistic toggle would revert.
 */
function mockUuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

function mockTodayOverview(dayStart: Date, scopeInstructorId?: string): AdminTodayOverview {
  // When scoped to an instructor (instructor session), filter the mock day to
  // only their classes so the stats reflect the filtered set — same as the DB path.
  const seeds = scopeInstructorId
    ? MOCK_TODAY.filter((s) => s.instr === scopeInstructorId)
    : MOCK_TODAY;
  const { year, month0, day } = studioParts(dayStart);
  const classes: AdminTodayClass[] = seeds.map((seed, ci) => {
    const [h, m] = seed.time.split(":").map((n) => Number.parseInt(n, 10));
    const startsAt = studioInstant(year, month0, day, h ?? 0, m ?? 0);
    const capacity = effectiveCapacity(99, seed.type);
    const roster: AdminAttendee[] = seed.roster.map(([memId, checkedIn], i) => {
      const mem = MOCK_MEMBERS[memId]!;
      return {
        bookingId: mockUuid(ci * 10 + i + 1),
        userId: memId,
        name: mem.name,
        phone: mem.phone,
        house: mem.house,
        isMember: mem.member,
        position: POS_BY_INDEX[i] ?? null,
        checkedIn,
      };
    });
    const wl: AdminWaitEntry[] = (seed.wait ?? []).map((memId, i) => {
      const mem = MOCK_MEMBERS[memId]!;
      return {
        waitlistId: `${seed.id}-w-${memId}`,
        userId: memId,
        name: mem.name,
        phone: mem.phone,
        position: i + 1,
        offered: i === 0, // head of the queue holds the live offer
      };
    });
    return {
      id: seed.id,
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + seed.dur * 60_000).toISOString(),
      durationMin: seed.dur,
      type: seed.type,
      typeMeta: metaFor(seed.type),
      instructor: instructorMetaFor(seed.instr),
      capacity,
      booked: roster.length,
      checkedIn: roster.filter((r) => r.checkedIn).length,
      full: roster.length >= capacity,
      roster,
      waitlist: wl,
    };
  });

  return { date: dayStart.toISOString(), stats: computeStats(classes), classes };
}
