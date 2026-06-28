// Pure, side-effect-free guards for the credit/booking invariants.
// Kept separate from the transactional code so they can be unit-tested in
// isolation (see tests/credits.test.ts).

export type DebitBlockReason = "EXPIRED" | "NO_CREDITS";

/**
 * Why a package cannot cover a debit of `cost` credits right now, or null if it
 * can. Mirrors the re-check performed inside the booking transaction. Expiry is
 * checked before balance so an expired pack reports EXPIRED regardless of cost.
 *
 * @param cost credits the booking will debit (1 group / 2 private·duo·trio).
 */
export function packageDebitBlock(
  pkg: { hoursLeft: number; expiresAt: Date },
  cost: number,
  now: Date,
): DebitBlockReason | null {
  if (pkg.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  if (pkg.hoursLeft < cost) return "NO_CREDITS";
  return null;
}

/** Seats still open given a hard capacity and current booked count. */
export function seatsLeft(capacity: number, booked: number): number {
  return Math.max(0, capacity - booked);
}

export function isFull(capacity: number, booked: number): boolean {
  return booked >= capacity;
}
