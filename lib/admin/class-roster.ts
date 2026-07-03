// Per-class roster read model for the admin Schedule screen. Given ONE class
// instance id, returns its live attendees (+ member/household context), its FIFO
// waitlist, and the reformer positions already held — so the roster drawer can
// do check-in, position changes, and cancellation. Read-only (the writes are
// separate server actions: setCheckIn, adminSetBookingPosition, adminCancelBooking).
//
// Reuses the AdminAttendee / AdminWaitEntry shapes from ./today. No-DB dev path
// returns a small synthesized roster so the drawer renders without a database.

import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { requireAdmin } from "@/lib/auth/admin";
import { bookings, classInstances, households, instructors, users, waitlist } from "@/lib/db/schema";
import { effectiveCapacity, type ClassType, type ReformerPosition } from "@/lib/domain/types";
import {
  instructorMetaFor,
  metaFor,
  type ClassTypeMeta,
  type InstructorMeta,
} from "@/lib/schedule/queries";
import type { AdminAttendee, AdminWaitEntry } from "./today";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AdminClassRoster {
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
  /** Reformer positions currently held by a LIVE booking (so the picker can grey them out). */
  takenPositions: ReformerPosition[];
  roster: AdminAttendee[];
  waitlist: AdminWaitEntry[];
}

/**
 * The full roster for a single class instance. Returns null when the caller is
 * not an admin, or the class does not exist. Admin-scoped (owner + instructor):
 * viewing the roster is allowed for both; the mutating actions carry their own
 * gate (position/cancel are owner-only; check-in is instructor-allowed & scoped).
 */
export async function getClassRoster(classInstanceId: string): Promise<AdminClassRoster | null> {
  if (!(await requireAdmin())) return null;

  // No-DB dev path first (mock class ids may not be UUIDs — short-circuit before
  // any strict parse, per the mock-id note).
  if (!process.env.DATABASE_URL) return mockClassRoster(classInstanceId);

  if (!UUID_RE.test(classInstanceId)) return null;

  const db = getDb();
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
    .where(eq(classInstances.id, classInstanceId))
    .limit(1);

  const c = classRows[0];
  if (!c) return null;

  // Live attendees + member/household context, and the FIFO waitlist (waiting +
  // offered) — both keyed only on this class id, so one parallel round trip.
  const [bookingRows, waitRows] = await Promise.all([
    db
      .select({
        bookingId: bookings.id,
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
      .where(and(eq(bookings.classInstanceId, classInstanceId), eq(bookings.status, "booked"))),
    db
      .select({
        waitlistId: waitlist.id,
        userId: waitlist.userId,
        position: waitlist.position,
        status: waitlist.status,
        name: users.name,
        phone: users.phone,
      })
      .from(waitlist)
      .innerJoin(users, eq(waitlist.userId, users.id))
      .where(and(eq(waitlist.classInstanceId, classInstanceId), eq(waitlist.status, "waiting")))
      .orderBy(asc(waitlist.position)),
  ]);

  const roster: AdminAttendee[] = bookingRows.map((b) => ({
    bookingId: b.bookingId,
    userId: b.userId,
    name: b.name,
    phone: b.phone,
    house: b.house ?? null,
    isMember: b.tier === "member",
    position: b.position,
    checkedIn: b.checkedInAt !== null,
  }));

  const wl: AdminWaitEntry[] = waitRows.map((w) => ({
    waitlistId: w.waitlistId,
    userId: w.userId,
    name: w.name,
    phone: w.phone,
    position: w.position,
    offered: w.status === "offered",
  }));

  const capacity = effectiveCapacity(c.capacity, c.type);
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
    checkedIn: roster.filter((r) => r.checkedIn).length,
    takenPositions: roster
      .map((r) => r.position)
      .filter((p): p is ReformerPosition => p !== null),
    roster,
    waitlist: wl,
  };
}

// ───────────────────────── no-DB mock fallback ─────────────────────────

/** A believable 2-person group roster so the drawer renders without a database. */
function mockClassRoster(id: string): AdminClassRoster {
  const roster: AdminAttendee[] = [
    {
      bookingId: `${id}-b1`,
      userId: "m1",
      name: "Pim Srisai",
      phone: "081 234 5678",
      house: "A-114",
      isMember: true,
      position: "left",
      checkedIn: false,
    },
    {
      bookingId: `${id}-b2`,
      userId: "m2",
      name: "Nok Charoen",
      phone: "089 887 1200",
      house: "B-203",
      isMember: true,
      position: "middle",
      checkedIn: true,
    },
  ];
  return {
    id,
    startsAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    durationMin: 60,
    type: "group",
    typeMeta: metaFor("group"),
    instructor: null,
    capacity: 3,
    booked: roster.length,
    checkedIn: roster.filter((r) => r.checkedIn).length,
    takenPositions: ["left", "middle"],
    roster,
    waitlist: [],
  };
}
