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
  type BookFailureCode,
} from "@/lib/credits/debit";
import { selectUsablePackage } from "@/lib/credits/selectPackage";
import { creditCostForClassType } from "@/lib/credits/cost";
import { evaluateCancellation } from "@/lib/credits/policy";
import { bookings, classInstances } from "@/lib/db/schema";
import type { ClassType } from "@/lib/domain/types";
import { CAPACITY, isCustomerBookable } from "@/lib/domain/types";
import { isRentalBookingOpen } from "@/lib/schedule/rental";
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

  // Front-desk-only types (private/duo/trio) can never be self-booked — bail BEFORE
  // selecting a package or touching the ledger (CUSTOMER_BOOKABLE_TYPES is the single
  // source; the atomic debit re-checks it under the lock as defense in depth).
  if (!isCustomerBookable(cls.type)) {
    return { ok: false, code: "ADMIN_ONLY" };
  }

  // Rental release window: a customer may book a rental only once its monthly window
  // has opened (lib/schedule/rental.ts). Bail before debiting; the debit re-checks it.
  if (cls.type === "rental" && !isRentalBookingOpen(cls.startsAt, now)) {
    return { ok: false, code: "RENTAL_WINDOW_CLOSED" };
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

export type CancelActionFailureCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "NOT_LIVE"
  | "FORBIDDEN"
  | "TOO_LATE_TO_CANCEL";

export interface CancelOutcome {
  /** Always true on ok: a self-cancel is only permitted within the free window. */
  free: boolean;
  /** Always true on ok: a permitted cancel always refunds the booking's cost. */
  refunded: boolean;
  hoursUntilStart: number;
  /** The free window (hours before start) — the fixed 5h policy constant. */
  freeCancelHours: number;
}

export type CancelResult =
  | { ok: true; outcome: CancelOutcome }
  | { ok: false; code: CancelActionFailureCode };

/**
 * Cancel a booking for the current customer. The cancellation policy is a single
 * FIXED 5h free window (CLAUDE.md §5 invariant 7, decided 2026-06-28): a self-cancel
 * is allowed ONLY at least 5h before start and is then ALWAYS free (the booking's
 * exact cost refunded). Within the 5h window the cancel is BLOCKED entirely —
 * `TOO_LATE_TO_CANCEL` is returned BEFORE any DB mutation, so a blocked cancel never
 * touches the booking or the ledger. The decision is recomputed server-side here,
 * never taken from the client.
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

  // Fixed-window policy: a cancel within 5h of start is BLOCKED entirely. Decide
  // BEFORE any mutation so a too-late cancel never touches the DB.
  const policy = evaluateCancellation(loaded.startsAt, now);
  if (!policy.cancellable) {
    return { ok: false, code: "TOO_LATE_TO_CANCEL" };
  }

  // A permitted cancel is always free → always refund the booking's exact cost.
  const cancelled = await cancelBooking({
    bookingId,
    actorUserId: viewer.id,
    refund: true,
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
      free: true,
      refunded: cancelled.refunded,
      hoursUntilStart: policy.hoursUntilStart,
      freeCancelHours: loaded.freeCancelHours,
    },
  };
}

// ───────────────────────── server-side lookups ─────────────────────────

interface ClassMeta {
  type: ClassType;
  capacity: number;
  startsAt: Date;
}

async function loadClassMeta(classInstanceId: string): Promise<ClassMeta | null> {
  const db = getDb();
  const [row] = await db
    .select({
      type: classInstances.type,
      capacity: classInstances.capacity,
      startsAt: classInstances.startsAt,
    })
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
  /** The free window (hours) locked on this booking at booking time (always 5). */
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
