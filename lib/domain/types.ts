// Shared domain types & constants. Single source of truth for the rules the
// whole app keys off (see CLAUDE.md §5). Pricing/seed numbers come from the spec
// and lune-pilates/project/lune-data.jsx.

export type UserTier = "member" | "guest";
export type PackageCategory = "group" | "private" | "rental";
export type ClassType = "group" | "private" | "duo" | "trio" | "rental";
export type ClassStatus = "draft" | "published";
export type BookingStatus = "booked" | "cancelled";
export type WaitlistStatus = "waiting" | "offered" | "claimed" | "expired";
export type ReformerPosition = "left" | "middle" | "right";

/** Hard capacity per class type. Reformer max is 3 per class. */
export const CAPACITY: Record<ClassType, number> = {
  group: 3,
  private: 1,
  duo: 2,
  trio: 3,
  rental: 3,
};

/**
 * The real bookable seat count for an instance: its stored capacity clamped to
 * the hard cap for its type, so a mis-seeded instance (e.g. a Duo row with
 * capacity 3) can never exceed the type's reformer limit. The SINGLE definition
 * of "effective capacity" — booking debit, the bookable read model, and the
 * waitlist full-check all use it so they can never disagree (CLAUDE.md §5 inv 8).
 */
export function effectiveCapacity(capacity: number, type: ClassType): number {
  return Math.min(capacity, CAPACITY[type]);
}

/** Free cancel/reschedule window, in hours, before class start. */
export const FREE_CANCEL_HOURS = 5;

/**
 * Cancellation policy is a DYNAMIC window fixed at booking time (CLAUDE.md §5
 * invariant 7, decided 2026-06-19). The window stored on the booking depends on
 * how far ahead it was booked:
 *   - booked ≥ LAST_MINUTE_BOOKING_HOURS before class  → 5h free window
 *   - booked  < LAST_MINUTE_BOOKING_HOURS before class → 1h free window
 *
 * LAST_MINUTE_BOOKING_HOURS is the lead-time threshold that decides which window
 * applies; LAST_MINUTE_FREE_CANCEL_HOURS is the (smaller) window a last-minute
 * booking gets. Both are tunable here without a schema change.
 */
export const LAST_MINUTE_BOOKING_HOURS = 5;
export const LAST_MINUTE_FREE_CANCEL_HOURS = 1;

/**
 * The free cancel/reschedule window (in hours) to lock onto a booking, decided
 * by its lead time at booking. Pure and unit-testable — the single place this
 * decision lives, used at booking time to stamp `bookings.free_cancel_hours`.
 *
 * Returns FREE_CANCEL_HOURS (5) when the booking is made at least
 * LAST_MINUTE_BOOKING_HOURS ahead of start (inclusive at the boundary), else the
 * last-minute window LAST_MINUTE_FREE_CANCEL_HOURS (1).
 */
export function freeCancelHoursFor(startsAt: Date, bookedAt: Date): number {
  const leadHours = (startsAt.getTime() - bookedAt.getTime()) / 3_600_000;
  return leadHours >= LAST_MINUTE_BOOKING_HOURS ? FREE_CANCEL_HOURS : LAST_MINUTE_FREE_CANCEL_HOURS;
}

/** Waitlist confirm hold, in minutes, once a freed seat is offered. */
export const WAITLIST_HOLD_MINUTES = 30;

/**
 * Default lead, in hours, before `starts_at` at which guests (non-members) can
 * first see/book a published class. `public_visible_at = starts_at − N`.
 * Tunable per class type without a schema change.
 */
export const DEFAULT_PUBLIC_LEAD_HOURS: Record<ClassType, number> = {
  group: 24,
  private: 24,
  duo: 24,
  trio: 24,
  rental: 24,
};

export const STUDIO_OPEN_HOUR = 8; // 08:00
export const STUDIO_CLOSE_HOUR = 20; // 20:00
