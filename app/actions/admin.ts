"use server";

// Server actions for the admin app. Every action is gated by `requireAdmin()`
// (lib/auth/admin.ts) — a v1 MOCK provider (front desk always signed in); the
// real staff/LINE provider swaps in at `getAdminAuth()` with no change here.
//
// Roster check-in (admin Today screen, admin-today.jsx): a check-in is recorded
// purely as a timestamp on the booking (`checked_in_at`). A booking is "checked
// in" iff that column is non-null — there is no separate boolean to drift from
// it, mirroring how cancellation uses `cancelled_at`.

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { bookings } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/admin";

const setCheckInInput = z.object({
  bookingId: z.string().uuid(),
  /** true = check the attendee in; false = undo a check-in. */
  checkedIn: z.boolean(),
});
export type SetCheckInInput = z.infer<typeof setCheckInInput>;

export type SetCheckInFailureCode = "UNAUTHORIZED" | "INVALID_INPUT" | "NOT_FOUND" | "NOT_BOOKED";

export type SetCheckInResult =
  | { ok: true; checkedIn: boolean }
  | { ok: false; code: SetCheckInFailureCode };

/**
 * Record (or undo) a roster check-in. Stamps `bookings.checked_in_at` with the
 * current instant when checking in, or clears it when undoing. Only a live
 * (`status='booked'`) booking can be checked in — a cancelled booking returns
 * NOT_BOOKED.
 *
 * No-DB dev path: returns ok so the UI's optimistic toggle works without a
 * database (the screen runs on mock data).
 */
export async function setCheckIn(raw: SetCheckInInput): Promise<SetCheckInResult> {
  if (!(await requireAdmin())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = setCheckInInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const { bookingId, checkedIn } = parsed.data;

  if (!process.env.DATABASE_URL) {
    // UI dev against mock data — the client holds optimistic check-in state.
    return { ok: true, checkedIn };
  }

  const db = getDb();
  const [row] = await db
    .select({ id: bookings.id, status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!row) return { ok: false, code: "NOT_FOUND" };
  if (row.status !== "booked") return { ok: false, code: "NOT_BOOKED" };

  await db
    .update(bookings)
    .set({ checkedInAt: checkedIn ? new Date() : null })
    .where(eq(bookings.id, bookingId));

  revalidatePath("/admin/today");
  return { ok: true, checkedIn };
}
