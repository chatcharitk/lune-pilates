// Cancellation / reschedule policy (CLAUDE.md §5, invariant 7).
//
// The free window is DYNAMIC, fixed at booking time and stored on the booking as
// `free_cancel_hours` (5 when booked ≥5h ahead, 1 for last-minute bookings — see
// `freeCancelHoursFor` in lib/domain/types). A cancel/reschedule is free when the
// remaining lead time still meets that locked window; inside it, the booking's
// credit cost is kept (deducted). This helper is pure — callers pass the
// booking's own `freeCancelHours`, so the same booking is judged by the window it
// was created with, never a fresh recomputation.

export interface CancellationOutcome {
  /** true ⇒ within the booking's free window ⇒ the booking's credit cost is refunded. */
  free: boolean;
  hoursUntilStart: number;
}

// NOTE: the refund AMOUNT is intentionally NOT here — it is the booking's exact
// `creditCost` (1.0 / 1.5), which this pure helper has no access to. Callers
// refund `free ? booking.creditCost : 0` (see cancelBooking / toMyBooking), never
// a hardcoded 1 (CLAUDE.md §5 invariant 7).
//
// `freeCancelHours` is the window LOCKED on the booking at creation (5 | 1) — pass
// `bookings.free_cancel_hours`, not the global constant.
export function evaluateCancellation(
  startsAt: Date,
  now: Date,
  freeCancelHours: number,
): CancellationOutcome {
  const hoursUntilStart = (startsAt.getTime() - now.getTime()) / 3_600_000;
  const free = hoursUntilStart >= freeCancelHours;
  return { free, hoursUntilStart };
}
