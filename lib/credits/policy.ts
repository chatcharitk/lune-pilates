// Cancellation policy (CLAUDE.md §5, invariant 7).
//
// The free window is a SINGLE FIXED window (FREE_CANCEL_HOURS = 5) for EVERY
// booking (decided 2026-06-28). A self-cancel is free (the booking's exact credit
// cost is refunded) only when made at least 5h before start (inclusive at exactly
// 5h); within the 5h window the cancel is BLOCKED entirely — there is no customer
// late-cancel-with-deduction path. This helper is pure (no I/O, no booking row);
// it judges purely on lead time so the same rule is single-sourced.

import { FREE_CANCEL_HOURS } from "@/lib/domain/types";

export interface CancellationOutcome {
  /** Coarse verdict: "free" ⇒ cancellable & refunded; "too_late" ⇒ blocked. */
  status: "free" | "too_late";
  /** true ⇒ the booking may be cancelled at all (only ≥5h before start). */
  cancellable: boolean;
  /** true ⇒ within the free window ⇒ the booking's credit cost is refunded. */
  free: boolean;
  hoursUntilStart: number;
}

// NOTE: the refund AMOUNT is intentionally NOT here — it is the booking's exact
// `creditCost` (1 / 2), which this pure helper has no access to. Callers refund
// the exact `booking.creditCost` on a free cancel, never a hardcoded 1
// (CLAUDE.md §5 invariant 7).
//
// `cancellable === free === (hoursUntilStart >= FREE_CANCEL_HOURS)`: under the
// fixed-window policy a cancel is only ever allowed when it is also free, so the
// three derive from the same boundary. The constant lives in lib/domain/types.
export function evaluateCancellation(startsAt: Date, now: Date): CancellationOutcome {
  const hoursUntilStart = (startsAt.getTime() - now.getTime()) / 3_600_000;
  const free = hoursUntilStart >= FREE_CANCEL_HOURS;
  return {
    status: free ? "free" : "too_late",
    cancellable: free,
    free,
    hoursUntilStart,
  };
}
