// Shared domain types & constants. Single source of truth for the rules the
// whole app keys off (see CLAUDE.md §5). Pricing/seed numbers come from the spec
// and lune-pilates/project/lune-data.jsx.

export type UserTier = "member" | "guest";
export type PackageCategory = "group" | "private" | "rental";
export type ClassType = "group" | "private" | "duo" | "trio" | "rental";
export type ClassStatus = "draft" | "published" | "cancelled";
export type BookingStatus = "booked" | "cancelled";
export type WaitlistStatus = "waiting" | "offered" | "claimed" | "expired";
export type ReformerPosition = "left" | "middle" | "right";

/**
 * The class types a CUSTOMER may self-book (and self-waitlist). Private, Duo and
 * Trio are ADMIN-ONLY — bookable only through the front desk (adminBookForCustomer),
 * never from the customer app (decided 2026-07-23). This is the SINGLE source of
 * truth the booking action, the atomic debit guard, and the waitlist join all key
 * off, so the rule can never disagree across paths.
 */
export const CUSTOMER_BOOKABLE_TYPES: ReadonlySet<ClassType> = new Set<ClassType>([
  "group",
  "rental",
]);

/** True iff a customer may self-book `type` (group/rental). See CUSTOMER_BOOKABLE_TYPES. */
export function isCustomerBookable(type: ClassType): boolean {
  return CUSTOMER_BOOKABLE_TYPES.has(type);
}

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

/**
 * Free cancellation window, in hours, before class start (CLAUDE.md §5 invariant 7,
 * fixed window decided 2026-06-28; widened 5h → 6h 2026-07-20). This is a SINGLE
 * fixed window for EVERY booking: a customer self-cancel is free (cost refunded)
 * only when made at least this many hours before start (inclusive at exactly 6h);
 * within the window the cancel is BLOCKED entirely (there is no customer
 * late-cancel-with-deduction path). Stamped on the booking as an audit constant,
 * not a per-booking live input.
 */
export const FREE_CANCEL_HOURS = 6;

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
  // Rentals open to all viewers up to 14 days (336h) before start — a far longer
  // booking horizon than studio-led classes (CLAUDE.md §5, decided 2026-06-28).
  rental: 336,
};

export const STUDIO_OPEN_HOUR = 8; // 08:00
export const STUDIO_CLOSE_HOUR = 20; // 20:00
