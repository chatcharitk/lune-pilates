// Read model for the customer "My Bookings" screen and the Home "next class"
// card. Scope is LIST + NEXT only — reschedule is a separate follow-up, and
// cancellation goes through the existing `cancelBookingAction` (app/actions/
// booking.ts), not this module.
//
// The cancellation eligibility on every upcoming booking is computed
// server-side via `evaluateCancellation` (CLAUDE.md §5, invariant 7: free up to
// 5 hours before start) so the UI can render "free cancel" vs "within 5 hours"
// without trusting any client-supplied clock or balance. The refund a free
// cancel returns is the booking's EXACT debited cost (`creditCost`), never a
// hardcoded 1 — matching how `cancelBooking` actually refunds.
//
// Reuses the bilingual TYPE_META / INSTRUCTOR_META catalogs from
// lib/schedule/queries (metaFor / instructorMetaFor) rather than duplicating
// them, so the bookings list and the bookable week agree on labels.
//
// No-DB dev fallback: when DATABASE_URL is unset, the functions return mock
// data mirroring lune-extra.jsx / lune-data.jsx so the screen renders without a
// database. The DB path is the real one; the mock path is gated behind the env.

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { bookings, classInstances, instructors } from "@/lib/db/schema";
import type { Bilingual } from "@/lib/i18n";
import type { BookingStatus, ClassType, ReformerPosition } from "@/lib/domain/types";
import type { SessionUser } from "@/lib/auth/session";
import { evaluateCancellation } from "@/lib/credits/policy";
import {
  instructorMetaFor,
  metaFor,
  type ClassTypeMeta,
  type InstructorMeta,
} from "@/lib/schedule/queries";

// ───────────────────────── contract (frontend imports these) ─────────────────────────

/**
 * Server-computed cancellation eligibility for a booking, given the booking's
 * DYNAMIC window locked at booking time (`freeCancelHours`, 5 | 1 — CLAUDE.md §5,
 * invariant 7). `free` ⇒ within that window ⇒ a cancel refunds the booking's
 * credit cost; outside it the cost is kept. The UI uses this purely to label the
 * cancel affordance (and show the right cutoff, "5 hours" vs "1 hour") — the
 * authoritative decision is re-evaluated server-side inside `cancelBookingAction`.
 */
export interface BookingCancellation {
  /** true ⇒ within the booking's free window ⇒ a cancel is free (cost refunded). */
  free: boolean;
  /** Hours from `now` until class start (can be negative for past classes). */
  hoursUntilStart: number;
  /** Credits a free cancel would return — the booking's exact debited cost. */
  refundCredits: number;
  /** The free window (hours before start) locked on this booking (5 | 1). */
  freeCancelHours: number;
}

/** One row in the customer's bookings list (upcoming or past). */
export interface MyBooking {
  bookingId: string;
  classInstanceId: string;
  type: ClassType;
  typeMeta: ClassTypeMeta;
  startsAt: string; // ISO 8601
  durationMin: number;
  instructor: InstructorMeta | null;
  position: ReformerPosition | null;
  creditCost: number;
  status: BookingStatus;
  cancellation: BookingCancellation;
}

export interface MyBookings {
  upcoming: MyBooking[];
  past: MyBooking[];
}

/** Max past bookings returned — the history list is bounded for the UI. */
export const PAST_BOOKINGS_LIMIT = 20;

// ───────────────────────── pure shaping helper ─────────────────────────

/** Fields needed to shape one `MyBooking`, independent of the data source. */
export interface BookingRow {
  bookingId: string;
  classInstanceId: string;
  type: ClassType;
  startsAt: Date;
  durationMin: number;
  instructorId: string | null;
  instructorName: string | null;
  instructorNameTh: string | null;
  instructorTag: string | null;
  position: ReformerPosition | null;
  creditCost: number;
  status: BookingStatus;
  /** The free window (hours) locked on this booking at booking time (5 | 1). */
  freeCancelHours: number;
}

/**
 * Shape a raw booking row into the `MyBooking` contract, computing the
 * cancellation eligibility server-side from `now` against the booking's OWN
 * locked window (`freeCancelHours`). Pure (no I/O) so it is unit testable and
 * shared by the DB and mock paths.
 *
 * The refund a free cancel returns is the row's exact `creditCost` (CLAUDE.md
 * §5 invariant 7 — refund the amount actually debited, not a hardcoded 1).
 */
export function toMyBooking(row: BookingRow, now: Date): MyBooking {
  const policy = evaluateCancellation(row.startsAt, now, row.freeCancelHours);
  return {
    bookingId: row.bookingId,
    classInstanceId: row.classInstanceId,
    type: row.type,
    typeMeta: metaFor(row.type),
    startsAt: row.startsAt.toISOString(),
    durationMin: row.durationMin,
    instructor: instructorMetaFor(
      row.instructorId,
      row.instructorName ?? undefined,
      row.instructorNameTh ?? undefined,
      row.instructorTag,
    ),
    position: row.position,
    creditCost: row.creditCost,
    status: row.status,
    cancellation: {
      free: policy.free,
      hoursUntilStart: policy.hoursUntilStart,
      // Refund the EXACT cost booked, only when the cancel is free.
      refundCredits: policy.free ? row.creditCost : 0,
      freeCancelHours: row.freeCancelHours,
    },
  };
}

/** True when a booking belongs in `upcoming`: still booked AND in the future. */
function isUpcoming(status: BookingStatus, startsAt: Date, now: Date): boolean {
  return status === "booked" && startsAt.getTime() > now.getTime();
}

// ───────────────────────── public queries ─────────────────────────

/**
 * The current viewer's OWN bookings, split into:
 *   - `upcoming`: status='booked' AND class.starts_at > now, soonest first.
 *   - `past`: class.starts_at <= now OR status='cancelled', most recent first,
 *     capped at PAST_BOOKINGS_LIMIT (20).
 *
 * Only `bookings.userId = viewer.id` rows are returned — a customer sees only
 * the bookings they made (household-mates' bookings are not surfaced here).
 *
 * No-DB fallback: returns mock data mirroring lune-extra.jsx so the screen
 * renders without a database.
 */
export async function listMyBookings(
  viewer: SessionUser,
  now: Date = new Date(),
): Promise<MyBookings> {
  if (!process.env.DATABASE_URL) {
    return mockListMyBookings(now);
  }

  const db = getDb();

  // Fetch every booking the viewer owns, newest class first, then split in JS so
  // the upcoming/past partition stays in lockstep with `isUpcoming`. Past is
  // capped at PAST_BOOKINGS_LIMIT after the split (upcoming is unbounded — a
  // customer can hold many future bookings and should see them all).
  const rows = await db
    .select({
      bookingId: bookings.id,
      classInstanceId: bookings.classInstanceId,
      type: classInstances.type,
      startsAt: classInstances.startsAt,
      durationMin: classInstances.durationMin,
      instructorId: classInstances.instructorId,
      instructorName: instructors.name,
      instructorNameTh: instructors.nameTh,
      instructorTag: instructors.tag,
      position: bookings.position,
      creditCost: bookings.creditCost,
      freeCancelHours: bookings.freeCancelHours,
      status: bookings.status,
    })
    .from(bookings)
    .innerJoin(classInstances, eq(bookings.classInstanceId, classInstances.id))
    .leftJoin(instructors, eq(classInstances.instructorId, instructors.id))
    .where(eq(bookings.userId, viewer.id))
    // Secondary key by booking id makes the order deterministic when two classes
    // start at the same instant (so reverse-of-desc == the asc getNextBooking uses).
    .orderBy(desc(classInstances.startsAt), desc(bookings.id));

  const upcoming: MyBooking[] = [];
  const past: MyBooking[] = [];
  for (const r of rows) {
    const shaped = toMyBooking(r, now);
    if (isUpcoming(r.status, r.startsAt, now)) upcoming.push(shaped);
    else past.push(shaped);
  }

  // upcoming: soonest first (rows came newest-first → reverse the future slice).
  upcoming.reverse();
  // past: already most-recent-first from the query; cap at the limit.
  return { upcoming, past: past.slice(0, PAST_BOOKINGS_LIMIT) };
}

/**
 * The single soonest upcoming booking for the viewer, or null when they have
 * none. Replaces the mock next-class card on Home. Computed from the same
 * read model as `listMyBookings` so the card and the list never disagree.
 */
export async function getNextBooking(
  viewer: SessionUser,
  now: Date = new Date(),
): Promise<MyBooking | null> {
  if (!process.env.DATABASE_URL) {
    const { upcoming } = mockListMyBookings(now);
    return upcoming[0] ?? null;
  }

  const db = getDb();
  const [row] = await db
    .select({
      bookingId: bookings.id,
      classInstanceId: bookings.classInstanceId,
      type: classInstances.type,
      startsAt: classInstances.startsAt,
      durationMin: classInstances.durationMin,
      instructorId: classInstances.instructorId,
      instructorName: instructors.name,
      instructorNameTh: instructors.nameTh,
      instructorTag: instructors.tag,
      position: bookings.position,
      creditCost: bookings.creditCost,
      freeCancelHours: bookings.freeCancelHours,
      status: bookings.status,
    })
    .from(bookings)
    .innerJoin(classInstances, eq(bookings.classInstanceId, classInstances.id))
    .leftJoin(instructors, eq(classInstances.instructorId, instructors.id))
    .where(
      and(
        eq(bookings.userId, viewer.id),
        eq(bookings.status, "booked"),
        sql`${classInstances.startsAt} > ${now}`,
      ),
    )
    .orderBy(asc(classInstances.startsAt), asc(bookings.id)) // soonest first, deterministic tie-break
    .limit(1);

  return row ? toMyBooking(row, now) : null;
}

// ───────────────────────── no-DB mock fallback ─────────────────────────
// Mirrors lune-extra.jsx (one upcoming "today" group booking + a couple of past
// sessions) and lune-data.jsx so the My Bookings / Home screens render without a
// database. The DB path is the authoritative one.

interface MockBookingSeed {
  bookingId: string;
  classInstanceId: string;
  type: ClassType;
  /** Hours offset from `now`; positive = future, negative = past. */
  offsetHours: number;
  durationMin: number;
  instructorId: string | null;
  position: ReformerPosition | null;
  creditCost: number;
  /** Window locked at booking time (5 | 1) — mirrors bookings.free_cancel_hours. */
  freeCancelHours: number;
  status: BookingStatus;
}

const MOCK_BOOKINGS: MockBookingSeed[] = [
  // Upcoming: a group class later today (well outside the 5-hour window → free
  // cancel) so the cancel affordance renders in its "free" state.
  {
    bookingId: "b1",
    classInstanceId: "s4",
    type: "group",
    offsetHours: 8,
    durationMin: 60,
    instructorId: null,
    position: "left",
    creditCost: 1,
    freeCancelHours: 5,
    status: "booked",
  },
  // Past: a completed private session (mirrors lune-extra.jsx past list).
  {
    bookingId: "b2",
    classInstanceId: "s3",
    type: "private",
    offsetHours: -48,
    durationMin: 50,
    instructorId: "mai",
    position: "middle",
    creditCost: 1.5,
    freeCancelHours: 5,
    status: "booked",
  },
  // Past: a completed group session.
  {
    bookingId: "b3",
    classInstanceId: "s1",
    type: "group",
    offsetHours: -120,
    durationMin: 60,
    instructorId: null,
    position: "right",
    creditCost: 1,
    freeCancelHours: 5,
    status: "booked",
  },
  // Cancelled: shows the cancelled state in the past tab regardless of time.
  {
    bookingId: "b4",
    classInstanceId: "s7",
    type: "group",
    offsetHours: -12,
    durationMin: 60,
    instructorId: null,
    position: null,
    creditCost: 1,
    freeCancelHours: 5,
    status: "cancelled",
  },
];

function mockSeedToRow(seed: MockBookingSeed, now: Date): BookingRow {
  const startsAt = new Date(now.getTime() + seed.offsetHours * 3_600_000);
  const instr = seed.instructorId ? instructorMetaFor(seed.instructorId) : null;
  return {
    bookingId: seed.bookingId,
    classInstanceId: seed.classInstanceId,
    type: seed.type,
    startsAt,
    durationMin: seed.durationMin,
    instructorId: seed.instructorId,
    // The mock instructor catalog is bilingual already; pass the EN name through
    // so the row-derived fallback in instructorMetaFor is never hit on mock data.
    instructorName: instr?.name.en ?? null,
    instructorNameTh: instr?.name.th ?? null,
    instructorTag: instr?.tag?.en ?? null,
    position: seed.position,
    creditCost: seed.creditCost,
    freeCancelHours: seed.freeCancelHours,
    status: seed.status,
  };
}

function mockListMyBookings(now: Date): MyBookings {
  const shaped = MOCK_BOOKINGS.map((s) => ({
    seed: s,
    row: mockSeedToRow(s, now),
  }));

  const upcoming = shaped
    .filter(({ row }) => isUpcoming(row.status, row.startsAt, now))
    .sort((a, b) => a.row.startsAt.getTime() - b.row.startsAt.getTime()) // soonest first
    .map(({ row }) => toMyBooking(row, now));

  const past = shaped
    .filter(({ row }) => !isUpcoming(row.status, row.startsAt, now))
    .sort((a, b) => b.row.startsAt.getTime() - a.row.startsAt.getTime()) // most recent first
    .slice(0, PAST_BOOKINGS_LIMIT)
    .map(({ row }) => toMyBooking(row, now));

  return { upcoming, past };
}

// Re-export the bilingual meta types so frontend importers get the full
// `MyBooking` shape from one module.
export type { ClassTypeMeta, InstructorMeta, Bilingual };
