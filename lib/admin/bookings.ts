// Read model for the admin "Bookings & waitlist control" screen (spec §4,
// admin-more.jsx `BookingsAdminScreen`). Two views the screen renders as tabs:
//   - All bookings: every relevant booking (booked + cancelled) with its customer,
//     class, status, check-in state, credit cost, and — for upcoming ones — the
//     cancellation eligibility (so the front desk knows whether cancelling refunds).
//   - Waitlist: full classes grouped into cards, each listing its FIFO queue with
//     member|guest, phone, and the live confirm-window (minutes left) or a Notify
//     affordance for a still-`waiting` head.
//
// Like the other admin read models (today.ts, schedule.ts), this is the studio's
// OWN view, so it does NOT apply tiered visibility — the front desk sees every
// booking regardless of member/guest gating. Seat counts, check-in state and the
// cancellation policy are all derived server-side (CLAUDE.md §8): booked counts
// come live from the bookings table, check-in is `bookings.checkedInAt !== null`,
// and the cancellation verdict reuses `evaluateCancellation` against the booking's
// LOCKED `freeCancelHours` (invariant 7) — never a client-supplied value.
//
// Waitlist offers are LAZILY expired here via `effectiveWaitlistStatus` so a stale
// `offered` row past its hold reads as `waiting`-equivalent (re-offerable) and the
// screen never shows a dead countdown between cron sweeps (CLAUDE.md §5 inv 6).
//
// No-DB dev fallback: when DATABASE_URL is unset the functions return mock data
// mirroring admin-data.jsx (BOOKINGS / WAITLIST / TODAY / MEMBERS), so the screen
// renders without a database. The DB path is the real one.

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { bookings, classInstances, households, instructors, users, waitlist } from "@/lib/db/schema";
import type { BookingStatus, ClassType, WaitlistStatus } from "@/lib/domain/types";
import { WAITLIST_HOLD_MINUTES } from "@/lib/domain/types";
import { evaluateCancellation } from "@/lib/credits/policy";
import { effectiveWaitlistStatus } from "@/lib/waitlist/queries";
import {
  instructorMetaFor,
  metaFor,
  type ClassTypeMeta,
  type InstructorMeta,
} from "@/lib/schedule/queries";
import {
  addDays,
  formatStudioTime,
  studioDayFromYmd,
  studioInstant,
  studioParts,
  studioStartOfDay,
} from "@/lib/time";

// ───────────────────────── contract (frontend imports these) ─────────────────────────

/** The customer a booking belongs to, as the row renders them. */
export interface AdminBookingCustomer {
  userId: string;
  name: string;
  phone: string;
  isMember: boolean;
  /** House number, or null for guests / unaffiliated users. */
  house: string | null;
}

/** The class a booking is for, as the row renders it. */
export interface AdminBookingClass {
  classInstanceId: string;
  type: ClassType;
  typeMeta: ClassTypeMeta;
  startsAt: string; // ISO 8601
  /** Local "HH:MM" of startsAt, for the row's "day · time" line. */
  time: string;
  instructor: InstructorMeta | null;
}

/**
 * Server-computed cancellation eligibility for an UPCOMING booking, judged against
 * the window LOCKED on that booking (`freeCancelHours`, always 5 — CLAUDE.md §5 inv 7).
 * `free` ⇒ within the window ⇒ cancelling refunds the booking's exact cost; outside
 * it the cost is kept. The admin cancel action re-evaluates this server-side — this
 * is purely so the screen can label the cancel affordance. Null for past/cancelled
 * bookings (nothing to cancel).
 */
export interface AdminBookingCancellation {
  /** true ⇒ within the booking's free window ⇒ cancelling refunds the cost. */
  free: boolean;
  /** Hours from `now` until class start (can be negative for past classes). */
  hoursUntilStart: number;
  /** Credits a free cancel would return — the booking's exact debited cost. */
  refundCredits: number;
  /** The free window (hours before start) locked on this booking (always 5). */
  freeCancelHours: number;
}

/** One row in the admin "All bookings" table. */
export interface AdminBooking {
  bookingId: string;
  customer: AdminBookingCustomer;
  class: AdminBookingClass;
  status: BookingStatus;
  /** Checked in iff the booking carries a check-in timestamp (no separate flag). */
  checkedIn: boolean;
  /** Credits debited for this booking (1 group/rental · 2 private·duo·trio). */
  creditCost: number;
  /** Whether the class is still in the future (and so the booking is cancellable). */
  upcoming: boolean;
  /** Cancellation eligibility for an upcoming, live booking; null otherwise. */
  cancellation: AdminBookingCancellation | null;
}

/** One person waiting on a full class, in FIFO order, for the waitlist tab. */
export interface AdminWaitlistEntry {
  waitlistId: string;
  userId: string;
  name: string;
  phone: string;
  isMember: boolean;
  /** FIFO queue position (1 = head). */
  position: number;
  /**
   * Effective status — LAZILY expired: an `offered` row already past its hold reads
   * as `waiting` (re-offerable) so the screen never shows a dead live offer between
   * sweeps. So in this view a row is one of: `waiting` | `offered`.
   */
  status: WaitlistStatus;
  /** Hold deadline for a LIVE offer (ISO), else null. Drives the countdown. */
  holdExpiresAt: string | null;
  /** Whole minutes left on a live offer (ceil), else null. Mirrors the `Xm` badge. */
  minutesLeft: number | null;
}

/** A full class with its FIFO waitlist, grouped as one card. */
export interface AdminWaitlistClass {
  classInstanceId: string;
  type: ClassType;
  typeMeta: ClassTypeMeta;
  startsAt: string; // ISO 8601
  time: string; // local "HH:MM"
  instructor: InstructorMeta | null;
  entries: AdminWaitlistEntry[];
}

/** The whole screen's read model: both tabs in one fetch. */
export interface AdminBookingsOverview {
  bookings: AdminBooking[];
  waitlist: AdminWaitlistClass[];
}

/** Optional filter for the bookings list. Defaults to today + upcoming, all statuses. */
export interface AdminBookingsFilter {
  /**
   * Which bookings to include by time:
   *   - "upcoming" (default): classes from the start of `now`'s day onward.
   *   - "all": every booking regardless of when its class is.
   */
  scope?: "upcoming" | "all";
  /** Restrict to a single booking status (booked | cancelled). Omit for both. */
  status?: BookingStatus;
  /** Restrict to a single calendar day ("YYYY-MM-DD", local). Omit for the scope window. */
  day?: string;
}

// ───────────────────────── pure helpers ─────────────────────────

/** Bangkok (studio) "HH:MM" of an instant. */
function hhmm(d: Date): string {
  return formatStudioTime(d);
}

/** Bangkok 00:00 (studio day-start) of the day containing `d`. */
function startOfDay(d: Date): Date {
  return studioStartOfDay(d);
}

/** The instant of Bangkok 00:00 for a "YYYY-MM-DD" string, or null when malformed. */
function localDay(date: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return null;
  return studioDayFromYmd(date);
}

/** Whole minutes (ceil) from `now` to `holdExpiresAt`, never below 0. */
function minutesLeftUntil(holdExpiresAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((holdExpiresAt.getTime() - now.getTime()) / 60_000));
}

/** Fields needed to shape one `AdminBooking`, independent of the data source. */
export interface AdminBookingRow {
  bookingId: string;
  userId: string;
  customerName: string;
  customerPhone: string;
  isMember: boolean;
  house: string | null;
  classInstanceId: string;
  type: ClassType;
  startsAt: Date;
  instructorId: string | null;
  instructorName: string | null;
  instructorNameTh: string | null;
  instructorTag: string | null;
  status: BookingStatus;
  checkedInAt: Date | null;
  creditCost: number;
  /** The free window (hours) locked on this booking at booking time (always 5). */
  freeCancelHours: number;
}

/**
 * Shape a raw booking row into the `AdminBooking` contract, computing the
 * cancellation eligibility server-side against the booking's OWN locked window
 * (`freeCancelHours`) — only for live, upcoming bookings (a past or cancelled
 * booking can't be cancelled, so `cancellation` is null). Pure (no I/O) so it is
 * unit testable and shared by the DB and mock paths. The refund a free cancel
 * returns is the row's exact `creditCost`, never a hardcoded 1 (CLAUDE.md §5 inv 7).
 */
export function toAdminBooking(row: AdminBookingRow, now: Date): AdminBooking {
  const upcoming = row.status === "booked" && row.startsAt.getTime() > now.getTime();
  let cancellation: AdminBookingCancellation | null = null;
  if (upcoming) {
    const policy = evaluateCancellation(row.startsAt, now);
    cancellation = {
      free: policy.free,
      hoursUntilStart: policy.hoursUntilStart,
      refundCredits: policy.free ? row.creditCost : 0,
      freeCancelHours: row.freeCancelHours,
    };
  }
  return {
    bookingId: row.bookingId,
    customer: {
      userId: row.userId,
      name: row.customerName,
      phone: row.customerPhone,
      isMember: row.isMember,
      house: row.house,
    },
    class: {
      classInstanceId: row.classInstanceId,
      type: row.type,
      typeMeta: metaFor(row.type),
      startsAt: row.startsAt.toISOString(),
      time: hhmm(row.startsAt),
      instructor: instructorMetaFor(
        row.instructorId,
        row.instructorName ?? undefined,
        row.instructorNameTh ?? undefined,
        row.instructorTag,
      ),
    },
    status: row.status,
    checkedIn: row.checkedInAt !== null,
    creditCost: row.creditCost,
    upcoming,
    cancellation,
  };
}

/** Fields needed to shape one `AdminWaitlistEntry`, independent of the data source. */
export interface AdminWaitlistRow {
  waitlistId: string;
  userId: string;
  name: string;
  phone: string;
  isMember: boolean;
  position: number;
  status: WaitlistStatus;
  holdExpiresAt: Date | null;
}

/**
 * Shape a raw waitlist row into the `AdminWaitlistEntry` contract, applying lazy
 * expiry: an `offered` row past its hold reads as `waiting` (re-offerable) so the
 * screen never counts down a dead offer. Pure (no I/O), shared by both paths. The
 * minutes-left + hold deadline are surfaced only while the offer is still live.
 */
export function toAdminWaitlistEntry(row: AdminWaitlistRow, now: Date): AdminWaitlistEntry {
  const effective = effectiveWaitlistStatus(row.status, row.holdExpiresAt, now);
  // `effectiveWaitlistStatus` maps a stale offer to "expired"; in this admin view a
  // dead offer is shown as a re-offerable "waiting" head (the screen offers Notify).
  const status: WaitlistStatus = effective === "expired" ? "waiting" : effective;
  const live = status === "offered" && row.holdExpiresAt !== null;
  return {
    waitlistId: row.waitlistId,
    userId: row.userId,
    name: row.name,
    phone: row.phone,
    isMember: row.isMember,
    position: row.position,
    status,
    holdExpiresAt: live ? row.holdExpiresAt!.toISOString() : null,
    minutesLeft: live ? minutesLeftUntil(row.holdExpiresAt!, now) : null,
  };
}

// ───────────────────────── public query ─────────────────────────

/**
 * The whole "Bookings & waitlist control" screen in one fetch: the bookings list
 * (filtered) and the waitlist grouped by full class.
 *
 * Bookings default scope is today + upcoming (status='booked' or 'cancelled'),
 * deterministically ordered by class start then booking id. The waitlist view
 * includes every class with at least one live (`waiting`/`offered`) queue entry,
 * FIFO within each class, soonest class first.
 *
 * No-DB fallback: returns mock data mirroring admin-data.jsx so the screen renders
 * without a database. The DB path is authoritative.
 */
export async function getAdminBookingsOverview(
  filter: AdminBookingsFilter = {},
  now: Date = new Date(),
): Promise<AdminBookingsOverview> {
  if (!process.env.DATABASE_URL) {
    return mockAdminBookingsOverview(filter, now);
  }
  const [bookingList, waitlistGroups] = await Promise.all([
    getAdminBookings(filter, now),
    getAdminWaitlist(now),
  ]);
  return { bookings: bookingList, waitlist: waitlistGroups };
}

/**
 * The "All bookings" table rows, filtered. Default scope = today + upcoming; pass
 * `scope: "all"` for the whole history, `status` to pin one status, or `day` to
 * restrict to a single calendar day. Ordered by class start, then booking id, so
 * the list is deterministic across renders.
 */
export async function getAdminBookings(
  filter: AdminBookingsFilter = {},
  now: Date = new Date(),
): Promise<AdminBooking[]> {
  if (!process.env.DATABASE_URL) {
    return mockAdminBookingsOverview(filter, now).bookings;
  }

  const db = getDb();
  const conds = [];

  // Time window: a single day takes precedence over the scope; otherwise the
  // default "upcoming" scope starts at the beginning of today (so a class earlier
  // today is still shown). `scope: "all"` adds no time bound.
  if (filter.day) {
    const dayStart = localDay(filter.day);
    if (dayStart) {
      const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000);
      conds.push(sql`${classInstances.startsAt} >= ${dayStart}`);
      conds.push(sql`${classInstances.startsAt} < ${dayEnd}`);
    }
  } else if ((filter.scope ?? "upcoming") === "upcoming") {
    conds.push(sql`${classInstances.startsAt} >= ${startOfDay(now)}`);
  }
  if (filter.status) {
    conds.push(eq(bookings.status, filter.status));
  }

  const rows = await db
    .select({
      bookingId: bookings.id,
      userId: bookings.userId,
      customerName: users.name,
      customerPhone: users.phone,
      tier: users.tier,
      house: households.houseNumber,
      classInstanceId: bookings.classInstanceId,
      type: classInstances.type,
      startsAt: classInstances.startsAt,
      instructorId: classInstances.instructorId,
      instructorName: instructors.name,
      instructorNameTh: instructors.nameTh,
      instructorTag: instructors.tag,
      status: bookings.status,
      checkedInAt: bookings.checkedInAt,
      creditCost: bookings.creditCost,
      freeCancelHours: bookings.freeCancelHours,
    })
    .from(bookings)
    .innerJoin(users, eq(bookings.userId, users.id))
    .leftJoin(households, eq(users.householdId, households.id))
    .innerJoin(classInstances, eq(bookings.classInstanceId, classInstances.id))
    .leftJoin(instructors, eq(classInstances.instructorId, instructors.id))
    .where(conds.length ? and(...conds) : undefined)
    // Deterministic: by class start (soonest first), then booking id.
    .orderBy(asc(classInstances.startsAt), asc(bookings.id));

  return rows.map((r) =>
    toAdminBooking(
      {
        bookingId: r.bookingId,
        userId: r.userId,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        isMember: r.tier === "member",
        house: r.house ?? null,
        classInstanceId: r.classInstanceId,
        type: r.type,
        startsAt: r.startsAt,
        instructorId: r.instructorId,
        instructorName: r.instructorName,
        instructorNameTh: r.instructorNameTh,
        instructorTag: r.instructorTag,
        status: r.status,
        checkedInAt: r.checkedInAt,
        creditCost: r.creditCost,
        freeCancelHours: r.freeCancelHours,
      },
      now,
    ),
  );
}

/**
 * The waitlist tab: every class with at least one live (`waiting`/`offered`) queue
 * entry, grouped into one card per class, FIFO within each class, soonest class
 * first. Offers are lazily expired so a stale hold reads as a re-offerable head.
 * Only future classes with a non-empty live queue are returned (a past class can no
 * longer free a seat to offer).
 */
export async function getAdminWaitlist(now: Date = new Date()): Promise<AdminWaitlistClass[]> {
  if (!process.env.DATABASE_URL) {
    return mockAdminBookingsOverview({}, now).waitlist;
  }

  const db = getDb();

  const rows = await db
    .select({
      waitlistId: waitlist.id,
      userId: waitlist.userId,
      name: users.name,
      phone: users.phone,
      tier: users.tier,
      position: waitlist.position,
      status: waitlist.status,
      holdExpiresAt: waitlist.holdExpiresAt,
      classInstanceId: waitlist.classInstanceId,
      type: classInstances.type,
      startsAt: classInstances.startsAt,
      instructorId: classInstances.instructorId,
      instructorName: instructors.name,
      instructorNameTh: instructors.nameTh,
      instructorTag: instructors.tag,
    })
    .from(waitlist)
    .innerJoin(users, eq(waitlist.userId, users.id))
    .innerJoin(classInstances, eq(waitlist.classInstanceId, classInstances.id))
    .leftJoin(instructors, eq(classInstances.instructorId, instructors.id))
    .where(
      and(
        inArray(waitlist.status, ["waiting", "offered"]),
        sql`${classInstances.startsAt} > ${now}`,
      ),
    )
    .orderBy(asc(classInstances.startsAt), asc(waitlist.position), asc(waitlist.id));

  // Group rows into one card per class, preserving the FIFO order from the query.
  const byClass = new Map<string, AdminWaitlistClass>();
  for (const r of rows) {
    let card = byClass.get(r.classInstanceId);
    if (!card) {
      card = {
        classInstanceId: r.classInstanceId,
        type: r.type,
        typeMeta: metaFor(r.type),
        startsAt: r.startsAt.toISOString(),
        time: hhmm(r.startsAt),
        instructor: instructorMetaFor(
          r.instructorId,
          r.instructorName ?? undefined,
          r.instructorNameTh ?? undefined,
          r.instructorTag,
        ),
        entries: [],
      };
      byClass.set(r.classInstanceId, card);
    }
    card.entries.push(
      toAdminWaitlistEntry(
        {
          waitlistId: r.waitlistId,
          userId: r.userId,
          name: r.name,
          phone: r.phone,
          isMember: r.tier === "member",
          position: r.position,
          status: r.status,
          holdExpiresAt: r.holdExpiresAt,
        },
        now,
      ),
    );
  }

  return [...byClass.values()];
}

// ───────────────────────── no-DB mock fallback ─────────────────────────
// Mirrors admin-data.jsx (MEMBERS / BOOKINGS / TODAY / WAITLIST), anchored to
// `now` so the screen renders a believable list without a database. The DB path is
// authoritative.

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

/**
 * A deterministic, valid v4-shaped UUID from a small integer, so mock ids pass the
 * same `z.string().uuid()` gate the real ids do — the admin cancel/offer actions
 * validate UUIDs, and the no-DB path must clear that gate too.
 */
function mockUuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

interface MockBookingSeed {
  member: string;
  type: ClassType;
  time: string; // "HH:MM"
  /** Day offset from `now`'s day (0 = today, 1 = tomorrow, -1 = yesterday). */
  dayOffset: number;
  status: BookingStatus;
  checkedIn: boolean;
}

// Mirrors admin-data.jsx BOOKINGS (checked/booked/confirmed → our booked|cancelled
// + checkedIn), anchored to `now`. "Wed" in the prototype maps to a near-future day.
const MOCK_BOOKINGS: MockBookingSeed[] = [
  { member: "m1", type: "group", time: "07:00", dayOffset: 0, status: "booked", checkedIn: true },
  { member: "m4", type: "private", time: "09:30", dayOffset: 0, status: "booked", checkedIn: false },
  { member: "m5", type: "duo", time: "11:00", dayOffset: 0, status: "booked", checkedIn: false },
  { member: "m8", type: "group", time: "08:00", dayOffset: 1, status: "booked", checkedIn: false },
  { member: "m3", type: "group", time: "18:30", dayOffset: 0, status: "booked", checkedIn: false },
  { member: "m2", type: "trio", time: "12:00", dayOffset: 2, status: "booked", checkedIn: false },
];

interface MockWaitClassSeed {
  classInstanceId: string;
  type: ClassType;
  time: string;
  instr: string;
  /** FIFO members; the head holds a live offer with `mins` left. */
  queue: { member: string; mins?: number }[];
}

// Mirrors admin-data.jsx TODAY[t4].wait + WAITLIST (t4: m6 notified 22m, m2 queued).
const MOCK_WAITLIST: MockWaitClassSeed[] = [
  {
    classInstanceId: "t4",
    type: "group",
    time: "17:30",
    instr: "mai",
    queue: [{ member: "m6", mins: 22 }, { member: "m2" }],
  },
];

/** Build a concrete start instant for a mock entry, anchored to `now`'s Bangkok
 * day (so the displayed Bangkok HH:MM is correct under any runtime TZ). */
function mockStartsAt(now: Date, dayOffset: number, time: string): Date {
  const [h, m] = time.split(":").map((n) => Number.parseInt(n, 10));
  const dayStart = addDays(startOfDay(now), dayOffset);
  const { year, month0, day } = studioParts(dayStart);
  return studioInstant(year, month0, day, h ?? 0, m ?? 0);
}

function mockAdminBookingsOverview(
  filter: AdminBookingsFilter,
  now: Date,
): AdminBookingsOverview {
  const dayStart = startOfDay(now);
  const filterDay = filter.day ? localDay(filter.day) : null;

  const allRows: AdminBookingRow[] = MOCK_BOOKINGS.map((seed, i) => {
    const mem = MOCK_MEMBERS[seed.member]!;
    const startsAt = mockStartsAt(now, seed.dayOffset, seed.time);
    const instr = instructorMetaFor(seed.type === "group" ? null : "mai");
    return {
      bookingId: mockUuid(i + 1),
      userId: mem.id,
      customerName: mem.name,
      customerPhone: mem.phone,
      isMember: mem.member,
      house: mem.house,
      classInstanceId: `mc-${i + 1}`,
      type: seed.type,
      startsAt,
      // Mock instructors are bilingual already; pass EN through so the row-derived
      // fallback in instructorMetaFor is never hit on mock data.
      instructorId: instr?.id ?? null,
      instructorName: instr?.name.en ?? null,
      instructorNameTh: instr?.name.th ?? null,
      instructorTag: instr?.tag?.en ?? null,
      status: seed.status,
      checkedInAt: seed.checkedIn ? now : null,
      creditCost: seed.type === "group" || seed.type === "rental" ? 1 : 2,
      freeCancelHours: 5,
    };
  });

  const bookingList = allRows
    .filter((row) => {
      if (filter.status && row.status !== filter.status) return false;
      if (filterDay) {
        const d = startOfDay(row.startsAt);
        return d.getTime() === filterDay.getTime();
      }
      if ((filter.scope ?? "upcoming") === "upcoming") {
        return row.startsAt.getTime() >= dayStart.getTime();
      }
      return true;
    })
    .sort(
      (a, b) =>
        a.startsAt.getTime() - b.startsAt.getTime() || a.bookingId.localeCompare(b.bookingId),
    )
    .map((row) => toAdminBooking(row, now));

  const waitlistGroups: AdminWaitlistClass[] = MOCK_WAITLIST.map((seed) => {
    const startsAt = mockStartsAt(now, 0, seed.time);
    const entries: AdminWaitlistEntry[] = seed.queue.map((q, i) => {
      const mem = MOCK_MEMBERS[q.member]!;
      const holdExpiresAt =
        q.mins !== undefined ? new Date(now.getTime() + q.mins * 60_000) : null;
      return toAdminWaitlistEntry(
        {
          waitlistId: `${seed.classInstanceId}-w-${mem.id}`,
          userId: mem.id,
          name: mem.name,
          phone: mem.phone,
          isMember: mem.member,
          position: i + 1,
          status: holdExpiresAt ? "offered" : "waiting",
          holdExpiresAt,
        },
        now,
      );
    });
    return {
      classInstanceId: seed.classInstanceId,
      type: seed.type,
      typeMeta: metaFor(seed.type),
      startsAt: startsAt.toISOString(),
      time: seed.time,
      instructor: instructorMetaFor(seed.instr),
      entries,
    };
  });

  return { bookings: bookingList, waitlist: waitlistGroups };
}

// The default hold window (minutes) is re-exported for the frontend so the
// "Notify → confirm window" copy can describe the head-start length without
// re-deriving it.
export { WAITLIST_HOLD_MINUTES };
