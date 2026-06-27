"use server";

// Server actions for the customer booking flow. These are the typed contracts
// the frontend imports and calls directly.
//
// Security (CLAUDE.md §8): the client only supplies the class instance id and an
// optional reformer position. Everything money-critical — identity, tier,
// household, which package to debit, the price (1 credit), and the resulting
// balance — is resolved/recomputed server-side. No client-supplied balance,
// price, or package id is ever trusted.

import { z } from "zod";
import { getCurrentUser, type SessionUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import {
  bookClassWithDebit,
  cancelBooking,
  rescheduleWithinTransaction,
  type BookFailureCode,
} from "@/lib/credits/debit";
import { selectUsablePackage, selectPackageForReschedule } from "@/lib/credits/selectPackage";
import { creditCostForClassType } from "@/lib/credits/cost";
import { evaluateCancellation } from "@/lib/credits/policy";
import { bookings, classInstances } from "@/lib/db/schema";
import type { ClassType } from "@/lib/domain/types";
import { CAPACITY } from "@/lib/domain/types";
import { positionsForCapacity } from "@/lib/schedule/queries";
import { emit } from "@/lib/events/bus";
import { registerNotificationHandlers } from "@/lib/events/notifications";
import { offerNextWaitlistSeat } from "@/lib/waitlist/queries";
import { eq } from "drizzle-orm";

// ───────────────────────── book ─────────────────────────

const bookClassInput = z.object({
  classInstanceId: z.string().uuid(),
  position: z.enum(["left", "middle", "right"]).optional(),
});
export type BookClassInput = z.infer<typeof bookClassInput>;

/**
 * Why a booking could not be completed. Extends the transactional failure codes
 * with the action-level ones (bad input, no usable package, class not found).
 */
export type BookActionFailureCode =
  | BookFailureCode
  | "INVALID_INPUT"
  | "CLASS_NOT_FOUND"
  | "NO_USABLE_PACKAGE";

export type BookResult =
  | { ok: true; bookingId: string; hoursLeft: number; freeCancelHours: number }
  | { ok: false; code: BookActionFailureCode };

/**
 * Book a class for the current customer, debiting one credit from the package
 * resolved server-side. On success emits `booking.confirmed` and returns the new
 * household-pool balance.
 */
export async function bookClass(raw: BookClassInput): Promise<BookResult> {
  const parsed = bookClassInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const input = parsed.data;
  const now = new Date();

  const viewer = await getCurrentUser();

  // Resolve the class meta server-side so we pick the correct package category
  // and can validate the requested seat against the class's real capacity.
  const cls = await loadClassMeta(input.classInstanceId);
  if (!cls) {
    return { ok: false, code: "CLASS_NOT_FOUND" };
  }

  // Reject an illegal reformer position early — never trust the client to send a
  // seat the class actually offers. (The transaction re-validates under lock.)
  if (input.position) {
    const allowed = positionsForCapacity(Math.min(cls.capacity, CAPACITY[cls.type]));
    if (!allowed.includes(input.position)) {
      return { ok: false, code: "INVALID_POSITION" };
    }
  }

  // Pick the package to debit — never trust a client-supplied package id. Pass the
  // booking's cost so we choose a package that can actually cover it (the pool may
  // hold credits in another package even if the soonest-expiring one is short).
  const packageId = await selectUsablePackage(viewer, cls.type, now, creditCostForClassType(cls.type));
  if (!packageId) {
    return { ok: false, code: "NO_USABLE_PACKAGE" };
  }

  // The one atomic, concurrency-safe transaction (re-validates everything,
  // including tiered visibility from the server-resolved viewer tier).
  const result = await bookClassWithDebit(
    {
      classInstanceId: input.classInstanceId,
      userId: viewer.id,
      viewerTier: viewer.tier,
      packageId,
      position: input.position,
    },
    now,
  );

  if (!result.ok) {
    return { ok: false, code: result.code };
  }

  // CRM is a thin listener on the domain event — ensure handlers are attached,
  // then emit. A failing handler never breaks the booking (best-effort bus).
  registerNotificationHandlers();
  await emit({
    type: "booking.confirmed",
    bookingId: result.bookingId,
    userId: viewer.id,
    classInstanceId: input.classInstanceId,
  });

  // Surface the locked free-cancel window so the "You're booked" success screen
  // can show the applicable policy (5h vs 1h) — CLAUDE.md §5 invariant 7.
  return {
    ok: true,
    bookingId: result.bookingId,
    hoursLeft: result.hoursLeft,
    freeCancelHours: result.freeCancelHours,
  };
}

// ───────────────────────── cancel ─────────────────────────

const cancelInput = z.object({
  bookingId: z.string().uuid(),
});
export type CancelBookingInput = z.infer<typeof cancelInput>;

export type CancelActionFailureCode = "INVALID_INPUT" | "NOT_FOUND" | "NOT_LIVE" | "FORBIDDEN";

export interface CancelOutcome {
  /** true ⇒ within the booking's free window ⇒ credit refunded. */
  free: boolean;
  /** Whether the booking's exact credit cost was actually returned to the balance. */
  refunded: boolean;
  hoursUntilStart: number;
  /** The free window (hours) this booking was locked to at booking time (5 | 1). */
  freeCancelHours: number;
}

export type CancelResult =
  | { ok: true; outcome: CancelOutcome }
  | { ok: false; code: CancelActionFailureCode };

/**
 * Cancel a booking for the current customer. Evaluates the booking's DYNAMIC
 * cancellation policy server-side against the window locked at booking time
 * (`freeCancelHours`, 5 | 1), refunds the credit only when free, then emits
 * `booking.cancelled`. The policy decision is recomputed here — never taken from
 * the client.
 */
export async function cancelBookingAction(raw: CancelBookingInput): Promise<CancelResult> {
  const parsed = cancelInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const { bookingId } = parsed.data;
  const now = new Date();

  const viewer = await getCurrentUser();

  const loaded = await loadBookingForCancel(bookingId);
  if (!loaded) {
    return { ok: false, code: "NOT_FOUND" };
  }
  // Ownership before liveness: a non-owner always gets FORBIDDEN and can never
  // distinguish a live vs cancelled booking they don't own.
  if (!canCancel(viewer, loaded.bookingUserId)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  if (loaded.status !== "booked") {
    return { ok: false, code: "NOT_LIVE" };
  }

  // Judge against the window LOCKED on this booking, not a fresh recomputation.
  const policy = evaluateCancellation(loaded.startsAt, now, loaded.freeCancelHours);

  const cancelled = await cancelBooking({
    bookingId,
    actorUserId: viewer.id,
    refund: policy.free,
  });

  if (!cancelled.ok) {
    return { ok: false, code: cancelled.code };
  }

  registerNotificationHandlers();
  await emit({
    type: "booking.cancelled",
    bookingId,
    userId: viewer.id,
    refunded: cancelled.refunded,
  });

  // A seat just freed up → offer it to the head of this class's waitlist queue
  // (FIFO notification head-start; occupancy is untouched — the seat stays openly
  // bookable, CLAUDE.md §5 invariant 6). Best-effort: a failed offer must NEVER
  // break the cancel itself, which has already committed.
  try {
    await offerNextWaitlistSeat(loaded.classInstanceId, now);
  } catch (err) {
    console.error(`[booking] waitlist offer after cancel ${bookingId} failed:`, err);
  }

  return {
    ok: true,
    outcome: {
      free: policy.free,
      refunded: cancelled.refunded,
      hoursUntilStart: policy.hoursUntilStart,
      freeCancelHours: loaded.freeCancelHours,
    },
  };
}

// ───────────────────────── reschedule ─────────────────────────

const rescheduleInput = z.object({
  bookingId: z.string().uuid(),
  newClassInstanceId: z.string().uuid(),
  position: z.enum(["left", "middle", "right"]).optional(),
});
export type RescheduleBookingInput = z.infer<typeof rescheduleInput>;

/**
 * Why a reschedule could not be completed. Covers loading the old booking
 * (NOT_FOUND / FORBIDDEN / NOT_LIVE), the policy gate
 * (RESCHEDULE_WINDOW_CLOSED — past the booking's free window), and every reason
 * the NEW booking could fail (the full `BookActionFailureCode`).
 */
export type RescheduleActionFailureCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "NOT_LIVE"
  | "RESCHEDULE_WINDOW_CLOSED"
  // The new booking was made but releasing the old one threw; we rolled the new
  // booking back, so the customer is left exactly as before and can retry.
  | "RESCHEDULE_FAILED"
  | BookActionFailureCode;

export type RescheduleResult =
  | { ok: true; newBookingId: string; hoursLeft: number; freeCancelHours: number }
  | { ok: false; code: RescheduleActionFailureCode };

/**
 * Move a live booking to a different class instance, free of charge, within the
 * old booking's free window (CLAUDE.md §5 invariant 7: reschedule is only allowed
 * inside the free window — a free move). Net credit effect: refund the old cost +
 * debit the new cost, net-zero for same-cost class types.
 *
 * ATOMIC: both legs (refund-old + debit-new) run in ONE interactive transaction
 * (`rescheduleWithinTransaction`) that locks the old booking, the new class, and
 * the affected package(s) in a fixed order, then commits or rolls back together.
 * There is NO crash window in which the customer could hold both bookings or lose
 * the old refund — the prior two-transaction implementation's only residual risk
 * is gone, so RESCHEDULE_FAILED can no longer occur (the code is retained in the
 * union for backward compatibility but is never returned).
 *
 * The new booking is stamped with its OWN `freeCancelHours`, derived from the new
 * class's lead time (so a move to a last-minute slot correctly inherits the 1h
 * window). The new package is resolved server-side (cost-aware) before the tx;
 * the old package (refund target) is read from the old booking row inside the tx.
 */
export async function rescheduleBooking(raw: RescheduleBookingInput): Promise<RescheduleResult> {
  const parsed = rescheduleInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const input = parsed.data;
  const now = new Date();

  const viewer = await getCurrentUser();

  // 1) Load the OLD booking and gate OWNERSHIP server-side (a non-owner gets
  //    FORBIDDEN and can never probe a booking they don't own). Liveness and the
  //    free-window check are re-validated under the lock inside the transaction —
  //    this pre-read only carries identity + the old class id for the waitlist
  //    offer afterwards.
  const old = await loadBookingForCancel(input.bookingId);
  if (!old) {
    return { ok: false, code: "NOT_FOUND" };
  }
  if (!canCancel(viewer, old.bookingUserId)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  if (old.status !== "booked") {
    return { ok: false, code: "NOT_LIVE" };
  }

  // 2) Resolve the NEW class server-side (its type drives package category and
  //    seat validation) — never trust the client for any of it. The position is
  //    re-validated under the lock too; this is an early reject.
  const newCls = await loadClassMeta(input.newClassInstanceId);
  if (!newCls) {
    return { ok: false, code: "CLASS_NOT_FOUND" };
  }
  if (input.position) {
    const allowed = positionsForCapacity(Math.min(newCls.capacity, CAPACITY[newCls.type]));
    if (!allowed.includes(input.position)) {
      return { ok: false, code: "INVALID_POSITION" };
    }
  }

  // 3) Pick the package the NEW leg debits — never a client-supplied id. Reschedule
  //    is a net-zero free move: the OLD package is refunded first, so the selector
  //    prefers it when its post-refund balance covers the new cost (making a
  //    same-cost move work even from a depleted package), else falls back to a
  //    different package that covers the new cost on its own. This keeps selection
  //    consistent with the transaction's post-refund debit guard.
  const newCost = creditCostForClassType(newCls.type);
  const packageId = await selectPackageForReschedule(
    viewer,
    newCls.type,
    old.packageId,
    old.creditCost,
    newCost,
    now,
  );
  if (!packageId) {
    return { ok: false, code: "NO_USABLE_PACKAGE" };
  }

  // 4) THE ONE atomic transaction: refund-old + debit-new together, all-or-nothing.
  //    Liveness, the free window, tiered visibility, capacity, dupe and position
  //    are all re-checked under the lock.
  const result = await rescheduleWithinTransaction(
    {
      oldBookingId: input.bookingId,
      newClassInstanceId: input.newClassInstanceId,
      userId: viewer.id,
      viewerTier: viewer.tier,
      newPackageId: packageId,
      position: input.position,
    },
    now,
  );

  if (!result.ok) {
    // Map the transaction's old-leg codes to the action-level ones the UI knows.
    switch (result.code) {
      case "OLD_NOT_FOUND":
        return { ok: false, code: "NOT_FOUND" };
      case "OLD_NOT_LIVE":
        return { ok: false, code: "NOT_LIVE" };
      default:
        // RESCHEDULE_WINDOW_CLOSED and every BookFailureCode pass straight through.
        return { ok: false, code: result.code };
    }
  }

  // CRM is a thin listener — emit the events that already exist in the model.
  registerNotificationHandlers();
  await emit({
    type: "booking.confirmed",
    bookingId: result.newBookingId,
    userId: viewer.id,
    classInstanceId: input.newClassInstanceId,
  });
  await emit({
    type: "booking.cancelled",
    bookingId: input.bookingId,
    userId: viewer.id,
    // The reschedule always refunds the old cost (it is a free in-window move).
    refunded: true,
  });

  // The OLD class's seat just freed up → offer it to the head of that class's
  // waitlist queue (same FIFO head-start as a plain cancel; occupancy untouched).
  // Best-effort — a failed offer must never undo the committed reschedule.
  try {
    await offerNextWaitlistSeat(old.classInstanceId, now);
  } catch (err) {
    console.error(
      `[booking] waitlist offer after reschedule release ${input.bookingId} failed:`,
      err,
    );
  }

  return {
    ok: true,
    newBookingId: result.newBookingId,
    hoursLeft: result.hoursLeft,
    freeCancelHours: result.freeCancelHours,
  };
}

// ───────────────────────── server-side lookups ─────────────────────────

interface ClassMeta {
  type: ClassType;
  capacity: number;
}

async function loadClassMeta(classInstanceId: string): Promise<ClassMeta | null> {
  const db = getDb();
  const [row] = await db
    .select({ type: classInstances.type, capacity: classInstances.capacity })
    .from(classInstances)
    .where(eq(classInstances.id, classInstanceId))
    .limit(1);
  return row ?? null;
}

interface BookingForCancel {
  status: "booked" | "cancelled";
  startsAt: Date;
  bookingUserId: string;
  householdId: string | null;
  /** The class whose seat is freed on cancel — used to offer the waitlist head. */
  classInstanceId: string;
  /** The free window (hours) locked on this booking at booking time (5 | 1). */
  freeCancelHours: number;
  /** The exact credit cost this booking debited (refunded on a free move/cancel). */
  creditCost: number;
  /** The package this booking debited — the refund target on a free move/cancel. */
  packageId: string;
}

async function loadBookingForCancel(bookingId: string): Promise<BookingForCancel | null> {
  const db = getDb();
  const [row] = await db
    .select({
      status: bookings.status,
      startsAt: classInstances.startsAt,
      bookingUserId: bookings.userId,
      classInstanceId: bookings.classInstanceId,
      freeCancelHours: bookings.freeCancelHours,
      creditCost: bookings.creditCost,
      packageId: bookings.packageId,
    })
    .from(bookings)
    .innerJoin(classInstances, eq(bookings.classInstanceId, classInstances.id))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!row) return null;
  return {
    status: row.status,
    startsAt: row.startsAt,
    bookingUserId: row.bookingUserId,
    householdId: null,
    classInstanceId: row.classInstanceId,
    freeCancelHours: row.freeCancelHours,
    creditCost: row.creditCost,
    packageId: row.packageId,
  };
}

/**
 * A customer may cancel their own booking. (Household-mate cancellation can be
 * layered on later by comparing household ids; v1 keeps it to the booking owner
 * to avoid surprises.)
 */
function canCancel(viewer: SessionUser, bookingUserId: string): boolean {
  return viewer.id === bookingUserId;
}
