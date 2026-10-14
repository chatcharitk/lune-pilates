// Activating and de-activating DORMANT bundle components.
//
// A bundle component can be anchored to a sibling instead of to the purchase date:
// the studio's ฿1,800 trial grants a private (1:1) class valid 14 days from payment,
// plus a free group class valid 7 days from THAT PRIVATE CLASS. The free half is
// created dormant — `expires_at IS NULL`, which every bookable/balance query already
// excludes — and only starts running once the private class is actually booked.
//
// The clock is anchored to the CLASS's start time, not the moment of booking (owner's
// decision, 2026-09-08): booking a private for three weeks out must not burn the free
// class's window, and the free class must not become usable before the private has
// happened. `activates_at` (the class start) gates the near edge, `expires_at`
// (class start + the component's window) the far edge.
//
// Cancelling the anchor booking puts the package BACK to dormant. Without that, a
// customer could book the private purely to unlock the free class, cancel the
// private, and keep the unlocked credit.

import { and, eq, isNull, min } from "drizzle-orm";
import { bookings, classInstances, packages } from "@/lib/db/schema";
import { expiryFromValidity } from "@/lib/catalog/validity";
import type { ValidityUnit } from "@/lib/catalog/packages";
import type { Database } from "@/lib/db/client";

/** The transaction handle, mirroring lib/credits/creditPackage.ts's local alias. */
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

function isValidityUnit(v: string | null): v is ValidityUnit {
  return v === "day" || v === "month";
}

/**
 * Start the clock on every dormant package anchored to `anchorPackageId`, using
 * `anchorClassStartsAt` as the origin. Call INSIDE the booking transaction, right
 * after the anchor package is debited, so unlocking is atomic with the booking that
 * earned it.
 *
 * Only touches rows that are still dormant (`expires_at IS NULL`), so re-booking
 * against the same anchor package later never restarts an already-running window.
 *
 * A row with a missing or malformed window is LEFT DORMANT rather than guessed at:
 * the owner can see and fix it, whereas an invented expiry silently gives away or
 * destroys credit.
 */
export async function activateAnchoredPackages(
  tx: Tx,
  anchorPackageId: string,
  anchorClassStartsAt: Date,
  bookingId: string,
): Promise<void> {
  const dormant = await tx
    .select({
      id: packages.id,
      activationAmount: packages.activationAmount,
      activationUnit: packages.activationUnit,
    })
    .from(packages)
    .where(
      and(
        eq(packages.activationAnchorPackageId, anchorPackageId),
        isNull(packages.expiresAt),
      ),
    );

  for (const d of dormant) {
    if (d.activationAmount === null || !isValidityUnit(d.activationUnit)) continue;
    await tx
      .update(packages)
      .set({
        activatesAt: anchorClassStartsAt,
        // Same inclusive whole-Bangkok-day rule as every other expiry: the final
        // day is usable in full (lib/catalog/validity.ts).
        expiresAt: expiryFromValidity(
          d.activationAmount,
          d.activationUnit,
          anchorClassStartsAt,
        ),
        activationBookingId: bookingId,
      })
      .where(and(eq(packages.id, d.id), isNull(packages.expiresAt)));
  }
}

/**
 * Undo the above when the anchor booking is cancelled: any package this booking
 * unlocked goes back to dormant (no expiry, no activation window), so it cannot be
 * spent until the anchor class is booked and taken for real.
 *
 * Scoped to `activation_booking_id` so it only reverts what THIS booking unlocked —
 * a package activated by some other booking is untouched.
 */
export async function deactivateAnchoredPackages(tx: Tx, bookingId: string): Promise<void> {
  await tx
    .update(packages)
    .set({ activatesAt: null, expiresAt: null, activationBookingId: null })
    .where(eq(packages.activationBookingId, bookingId));
}

// ───────────────────────── validity from the first class ─────────────────────────

/**
 * Recompute the expiry of a package whose validity counts from its FIRST CLASS
 * (2026-10-14). A no-op for every other package (first_class_deadline null).
 *
 *   start   = the earliest class still BOOKED on this package (attended classes stay
 *             "booked"), capped at first_class_deadline; the deadline itself when
 *             nothing is booked
 *   expires = start + the window, by the same whole-Bangkok-day rule as every expiry
 *
 * Deriving it from the bookings rather than stamping it once keeps it right in every
 * order of events: a later booking for an EARLIER class pulls the start forward,
 * and cancelling the only booking puts the clock back to "not started" — so a
 * customer can't start the clock and then cancel to keep a running window, or lose
 * one to a booking they cancelled.
 *
 * Call INSIDE the transaction that changed the package's bookings, after the change.
 */
export async function recomputeFirstClassClock(tx: Tx, packageId: string): Promise<void> {
  const [pkg] = await tx
    .select({
      deadline: packages.firstClassDeadline,
      amount: packages.firstClassWindowAmount,
      unit: packages.firstClassWindowUnit,
    })
    .from(packages)
    .where(eq(packages.id, packageId))
    .limit(1);
  if (!pkg?.deadline || pkg.amount === null || !isValidityUnit(pkg.unit)) return;

  const [first] = await tx
    .select({ startsAt: min(classInstances.startsAt) })
    .from(bookings)
    .innerJoin(classInstances, eq(classInstances.id, bookings.classInstanceId))
    .where(and(eq(bookings.packageId, packageId), eq(bookings.status, "booked")));

  const firstClass = first?.startsAt ?? null;
  const start = firstClass && firstClass < pkg.deadline ? firstClass : pkg.deadline;
  await tx
    .update(packages)
    .set({
      expiresAt: expiryFromValidity(pkg.amount, pkg.unit, start),
      // Started once a class is booked on it; otherwise only when the deadline has
      // passed (readers treat a past deadline as started either way).
      firstClassStartedAt: firstClass ? start : null,
    })
    .where(eq(packages.id, packageId));
}
