// Pure, side-effect-free guards for the credit/booking invariants.
// Kept separate from the transactional code so they can be unit-tested in
// isolation (see tests/credits.test.ts).

export type DebitBlockReason = "EXPIRED" | "NO_CREDITS" | "NOT_YET_ACTIVE";

/**
 * Why a package cannot cover a debit of `cost` credits right now, or null if it
 * can. Mirrors the re-check performed inside the booking transaction.
 *
 * Order matters: a package that is not yet usable reports NOT_YET_ACTIVE, then
 * expiry, then balance — so a customer is told the most specific true reason rather
 * than "no credits" for a balance they can plainly see.
 *
 * DORMANT BUNDLE COMPONENTS (2026-09-08). A component whose clock has not started
 * has a NULL expiry — the free group class in the trial cannot be used until the
 * paid private class has been taken. Null is treated as NOT usable here, matching
 * the SQL side (`expires_at > now()` is never true for NULL), so the gate fails
 * CLOSED in both languages. `activatesAt` guards the near edge of the window the
 * same way `expiresAt` guards the far edge: once the private class is booked the
 * free class is stamped with the class's start time, and stays unusable until then.
 *
 * @param cost credits the booking will debit (1 group / 2 private·duo·trio).
 */
export function packageDebitBlock(
  pkg: { hoursLeft: number; expiresAt: Date | null; activatesAt?: Date | null },
  cost: number,
  now: Date,
): DebitBlockReason | null {
  if (pkg.expiresAt === null) return "NOT_YET_ACTIVE";
  if (pkg.activatesAt != null && pkg.activatesAt.getTime() > now.getTime()) {
    return "NOT_YET_ACTIVE";
  }
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
