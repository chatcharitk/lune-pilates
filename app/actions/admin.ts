"use server";

// Server actions for the admin app. Check-in is gated by `requireAdmin()`
// (lib/auth/admin.ts) — a v1 MOCK provider (front desk always signed in); the
// real staff/LINE provider swaps in at `getAdminAuth()` with no change here.
//
// Check-in is INSTRUCTOR-ALLOWED (unlike the owner-only admin actions): both an
// owner and an instructor may check attendees in. An instructor, however, is
// SCOPED to their OWN classes — checking in a booking whose class belongs to a
// different instructor returns FORBIDDEN. An owner has no scope restriction.
//
// Roster check-in (admin Today screen, admin-today.jsx): a check-in is recorded
// purely as a timestamp on the booking (`checked_in_at`). A booking is "checked
// in" iff that column is non-null — there is no separate boolean to drift from
// it, mirroring how cancellation uses `cancelled_at`.

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { bookings, classInstances } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/admin";

const setCheckInInput = z.object({
  bookingId: z.string().uuid(),
  /** true = check the attendee in; false = undo a check-in. */
  checkedIn: z.boolean(),
});
export type SetCheckInInput = z.infer<typeof setCheckInInput>;

export type SetCheckInFailureCode =
  | "UNAUTHORIZED"
  // An instructor tried to check in a booking on a class that isn't theirs.
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "NOT_BOOKED";

export type SetCheckInResult =
  | { ok: true; checkedIn: boolean }
  | { ok: false; code: SetCheckInFailureCode };

/**
 * Record (or undo) a roster check-in. Stamps `bookings.checked_in_at` with the
 * current instant when checking in, or clears it when undoing. Only a live
 * (`status='booked'`) booking can be checked in — a cancelled booking returns
 * NOT_BOOKED.
 *
 * INSTRUCTOR-ALLOWED + SCOPED: both roles may check attendees in, but an
 * instructor may only act on bookings whose class is theirs
 * (`classInstances.instructorId === session.instructorId`); otherwise FORBIDDEN.
 * An owner has no scope restriction.
 *
 * No-DB dev path: returns ok so the UI's optimistic toggle works without a
 * database (the screen runs on mock data). The instructor scope check lives on
 * the DB path (it needs the booking's class) — the no-DB path stays owner-
 * equivalent (returns ok for both roles), as the mock screen is owner-shaped.
 */
export async function setCheckIn(raw: SetCheckInInput): Promise<SetCheckInResult> {
  const session = await requireAdmin();
  if (!session) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = setCheckInInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const { bookingId, checkedIn } = parsed.data;

  if (!process.env.DATABASE_URL) {
    // UI dev against mock data — the client holds optimistic check-in state. The
    // mock screen is owner-shaped, so this path is owner-equivalent for both roles
    // (the real instructor scope check is enforced on the DB path below).
    return { ok: true, checkedIn };
  }

  const db = getDb();
  const [row] = await db
    .select({
      id: bookings.id,
      status: bookings.status,
      instructorId: classInstances.instructorId,
    })
    .from(bookings)
    .innerJoin(classInstances, eq(bookings.classInstanceId, classInstances.id))
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!row) return { ok: false, code: "NOT_FOUND" };
  if (row.status !== "booked") return { ok: false, code: "NOT_BOOKED" };

  // Instructor scope: an instructor may only check in their OWN classes. An owner
  // is unrestricted (instructorId is null on an owner session → no check).
  if (session.role === "instructor" && row.instructorId !== session.instructorId) {
    return { ok: false, code: "FORBIDDEN" };
  }

  await db
    .update(bookings)
    .set({ checkedInAt: checkedIn ? new Date() : null })
    .where(eq(bookings.id, bookingId));

  revalidatePath("/admin/today");
  return { ok: true, checkedIn };
}
