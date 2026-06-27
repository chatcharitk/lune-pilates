"use server";

// Server actions for the admin "Bookings & waitlist control" screen (spec §4:
// "Manual book/cancel, and waitlist with the notify-and-confirm window"). These
// are the typed contracts the frontend imports and calls directly.
//
// Every action is gated by `requireAdmin()` (lib/auth/admin.ts — v1 mock provider;
// the real staff/LINE provider swaps in at `getAdminAuth()` with no change here).
//
// Everything money- and seat-critical goes through the SAME atomic, concurrency-
// safe primitives the customer flow uses, so booking on a customer's behalf can
// never oversell credits or seats and can never double-debit (CLAUDE.md §5
// invariant 1). The admin never supplies a balance, price, package id, tier or
// household — all are recomputed server-side from the target user's row (§8).

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { bookings, classInstances } from "@/lib/db/schema";
import { CAPACITY, type ClassType } from "@/lib/domain/types";
import { bookClassWithDebit, cancelBooking, type BookFailureCode } from "@/lib/credits/debit";
import { creditCostForClassType } from "@/lib/credits/cost";
import { evaluateCancellation } from "@/lib/credits/policy";
import { selectUsablePackageForUser } from "@/lib/credits/selectPackage";
import { positionsForCapacity } from "@/lib/schedule/queries";
import { emit } from "@/lib/events/bus";
import { registerNotificationHandlers } from "@/lib/events/notifications";
import { offerNextWaitlistSeat } from "@/lib/waitlist/queries";
import { getAdminBookings } from "@/lib/admin/bookings";
import { requireAdmin } from "@/lib/auth/admin";

// ───────────────────────── admin cancel ─────────────────────────

const adminCancelInput = z.object({
  bookingId: z.string().uuid(),
  /**
   * Optional explicit refund override. When omitted, the refund follows the
   * booking's DYNAMIC policy verdict (free within the locked window → refund,
   * outside → keep). Passing `true`/`false` lets the front desk override the
   * policy for a goodwill refund (e.g. a studio-side cancellation) or to withhold
   * one — a deliberate manual decision, never a client-trusted balance change.
   */
  refund: z.boolean().optional(),
});
export type AdminCancelBookingInput = z.infer<typeof adminCancelInput>;

export type AdminCancelFailureCode = "UNAUTHORIZED" | "INVALID_INPUT" | "NOT_FOUND" | "NOT_LIVE";

export interface AdminCancelOutcome {
  /** Whether the cancellation fell within the booking's free window. */
  free: boolean;
  /** Whether the booking's exact credit cost was actually returned to the pool. */
  refunded: boolean;
  /** Whether `refunded` came from an explicit admin override (vs the policy verdict). */
  overrode: boolean;
  hoursUntilStart: number;
  /** The free window (hours) locked on this booking at booking time (5 | 1). */
  freeCancelHours: number;
}

export type AdminCancelResult =
  | { ok: true; outcome: AdminCancelOutcome }
  | { ok: false; code: AdminCancelFailureCode };

/**
 * Cancel ANY customer's booking from the front desk.
 *
 * REFUND POLICY (decided here): by default the refund follows the booking's
 * dynamic cancellation policy (CLAUDE.md §5 invariant 7) — within the locked free
 * window the booking's EXACT cost is returned (a `+cost` ledger row); outside it
 * the cost is kept. The admin may explicitly OVERRIDE with `refund: true|false`
 * (e.g. a goodwill refund for a studio-side cancellation, or withholding one); the
 * override is recorded in the outcome (`overrode`). Either way the refund amount is
 * the booking's real `creditCost` (handled inside `cancelBooking`), never a
 * hardcoded 1.
 *
 * The status flip + optional refund are ONE atomic transaction (`cancelBooking`).
 * Afterwards we emit `booking.cancelled` and best-effort offer the freed seat to
 * the waitlist head (FIFO notification head-start; occupancy untouched — invariant
 * 6), exactly as the customer cancel action does.
 *
 * No-DB dev path: returns ok with a synthesized outcome so the UI works without a
 * database (the screen runs on mock data).
 */
export async function adminCancelBooking(raw: AdminCancelBookingInput): Promise<AdminCancelResult> {
  if (!(await requireAdmin())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = adminCancelInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const { bookingId, refund: override } = parsed.data;
  const now = new Date();

  if (!process.env.DATABASE_URL) {
    // UI dev against mock data — mirror the read model's OWN cancellation verdict
    // (mock↔read-model parity) so the toast matches what the drawer showed. The
    // mock seeds include same-day classes, so we must NOT assume a free cancel.
    const mock = await getAdminBookings({ scope: "all" }, now);
    const b = mock.find((x) => x.bookingId === bookingId);
    if (!b) return { ok: false, code: "NOT_FOUND" };
    if (b.status !== "booked" || !b.cancellation) return { ok: false, code: "NOT_LIVE" };
    const free = b.cancellation.free;
    return {
      ok: true,
      outcome: {
        free,
        refunded: override ?? free,
        overrode: override !== undefined,
        hoursUntilStart: b.cancellation.hoursUntilStart,
        freeCancelHours: b.cancellation.freeCancelHours,
      },
    };
  }

  // Front desk acts on the customer's behalf; the actor stamped on the ledger row
  // is the admin session user (so the audit trail shows who issued the cancel).
  const admin = await getCurrentUser();

  const loaded = await loadBookingForAdminCancel(bookingId);
  if (!loaded) {
    return { ok: false, code: "NOT_FOUND" };
  }
  if (loaded.status !== "booked") {
    return { ok: false, code: "NOT_LIVE" };
  }

  // Judge against the window LOCKED on this booking, not a fresh recomputation.
  const policy = evaluateCancellation(loaded.startsAt, now, loaded.freeCancelHours);
  // Default to the policy verdict; an explicit admin boolean overrides it.
  const doRefund = override ?? policy.free;

  const cancelled = await cancelBooking({
    bookingId,
    actorUserId: admin.id,
    refund: doRefund,
  });
  if (!cancelled.ok) {
    return { ok: false, code: cancelled.code };
  }

  registerNotificationHandlers();
  await emit({
    type: "booking.cancelled",
    bookingId,
    userId: loaded.bookingUserId,
    refunded: cancelled.refunded,
  });

  // A seat just freed up → offer it to the head of this class's waitlist queue.
  // Best-effort: a failed offer must NEVER break the cancel, which has committed.
  try {
    await offerNextWaitlistSeat(loaded.classInstanceId, now);
  } catch (err) {
    console.error(`[admin] waitlist offer after cancel ${bookingId} failed:`, err);
  }

  revalidatePath("/admin/bookings");
  return {
    ok: true,
    outcome: {
      free: policy.free,
      refunded: cancelled.refunded,
      overrode: override !== undefined,
      hoursUntilStart: policy.hoursUntilStart,
      freeCancelHours: loaded.freeCancelHours,
    },
  };
}

// ───────────────────────── admin offer waitlist seat ("Notify") ─────────────────────────

const adminOfferInput = z.object({
  classInstanceId: z.string().uuid(),
});
export type AdminOfferWaitlistSeatInput = z.infer<typeof adminOfferInput>;

export type AdminOfferFailureCode = "UNAUTHORIZED" | "INVALID_INPUT" | "NO_QUEUE_HEAD";

export interface AdminOfferOutcome {
  waitlistId: string;
  userId: string;
  position: number;
  /** Hold deadline for the offer (ISO) — now + WAITLIST_HOLD_MINUTES. */
  holdExpiresAt: string;
}

export type AdminOfferWaitlistSeatResult =
  | { ok: true; outcome: AdminOfferOutcome }
  | { ok: false; code: AdminOfferFailureCode };

/**
 * Manually offer ("Notify") a freed seat to the FIFO head of a class's waitlist
 * queue, granting a 30-minute confirm window and emitting `waitlist.offered`.
 *
 * Honors invariant 6 ("first to confirm wins"): this is a notification HEAD-START,
 * NOT a seat reservation — `offerNextWaitlistSeat` never touches occupancy; the
 * freed seat stays openly bookable and the customer's confirm runs the normal
 * atomic booking. Idempotent per freed seat: it only offers to a still-`waiting`
 * head, so re-pressing Notify on an already-offered head is a no-op
 * (NO_QUEUE_HEAD).
 *
 * No-DB dev path: returns ok with a synthesized offer so the UI works on mock data.
 */
export async function adminOfferWaitlistSeat(
  raw: AdminOfferWaitlistSeatInput,
): Promise<AdminOfferWaitlistSeatResult> {
  if (!(await requireAdmin())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = adminOfferInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const { classInstanceId } = parsed.data;
  const now = new Date();

  if (!process.env.DATABASE_URL) {
    return {
      ok: true,
      outcome: {
        waitlistId: "00000000-0000-4000-8000-0000000000f1",
        userId: "00000000-0000-4000-8000-0000000000f2",
        position: 1,
        holdExpiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
      },
    };
  }

  const offered = await offerNextWaitlistSeat(classInstanceId, now);
  if (!offered) {
    return { ok: false, code: "NO_QUEUE_HEAD" };
  }

  // `offerNextWaitlistSeat` already emits `waitlist.offered`; no second emit here.
  revalidatePath("/admin/bookings");
  return {
    ok: true,
    outcome: {
      waitlistId: offered.waitlistId,
      userId: offered.userId,
      position: offered.position,
      holdExpiresAt: offered.holdExpiresAt.toISOString(),
    },
  };
}

// ───────────────────────── admin book for customer ─────────────────────────

const adminBookInput = z.object({
  classInstanceId: z.string().uuid(),
  /** The customer to book FOR — never the admin. Their pool is resolved server-side. */
  userId: z.string().uuid(),
  position: z.enum(["left", "middle", "right"]).optional(),
});
export type AdminBookForCustomerInput = z.infer<typeof adminBookInput>;

/**
 * Why a manual booking could not be completed. Extends the transactional failure
 * codes with the action-level ones (bad input, class not found, the customer has no
 * usable package).
 */
export type AdminBookFailureCode =
  | BookFailureCode
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  | "CLASS_NOT_FOUND"
  | "NO_USABLE_PACKAGE";

export type AdminBookForCustomerResult =
  | { ok: true; bookingId: string; hoursLeft: number; freeCancelHours: number }
  | { ok: false; code: AdminBookFailureCode };

/**
 * Book a class on a customer's behalf, debiting THAT customer's pool atomically.
 *
 * The booking goes through the SAME `bookClassWithDebit` the customer flow uses
 * (CLAUDE.md §5 invariant 1) — one transaction, concurrency-safe, all-or-nothing —
 * so a front-desk booking can never oversell seats/credits or double-debit. The
 * package is selected server-side for the TARGET user via
 * `selectUsablePackageForUser`, which recomputes their tier/household pool from the
 * DB; the admin never supplies a package id, balance, or price (§8).
 *
 * Security note: the actor stamped on the ledger is the customer (`userId`), since
 * it is their credit being used — matching the customer path's actor semantics (the
 * ledger records whose credit moved). Who *issued* the booking (the front desk) is
 * an admin-session concern that audits separately when staff auth lands.
 *
 * No-DB dev path: returns ok with synthesized values so the UI works on mock data.
 */
export async function adminBookForCustomer(
  raw: AdminBookForCustomerInput,
): Promise<AdminBookForCustomerResult> {
  if (!(await requireAdmin())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = adminBookInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const input = parsed.data;
  const now = new Date();

  if (!process.env.DATABASE_URL) {
    return {
      ok: true,
      bookingId: "00000000-0000-4000-8000-0000000000b1",
      hoursLeft: 7,
      freeCancelHours: 5,
    };
  }

  // Resolve the class meta server-side so we pick the right package category and
  // can validate the requested seat against the class's real capacity.
  const cls = await loadClassMeta(input.classInstanceId);
  if (!cls) {
    return { ok: false, code: "CLASS_NOT_FOUND" };
  }

  // Reject an illegal reformer position early — never trust the client to send a
  // seat the class doesn't offer. (The transaction re-validates under lock.)
  if (input.position) {
    const allowed = positionsForCapacity(Math.min(cls.capacity, CAPACITY[cls.type]));
    if (!allowed.includes(input.position)) {
      return { ok: false, code: "INVALID_POSITION" };
    }
  }

  // Pick the package to debit for THE CUSTOMER (not the admin) — cost-aware,
  // recomputed from their pool; never a client-supplied id (§8).
  const packageId = await selectUsablePackageForUser(
    input.userId,
    cls.type,
    now,
    creditCostForClassType(cls.type),
  );
  if (!packageId) {
    // Either the user doesn't exist or they have no usable package in this pool.
    return { ok: false, code: "NO_USABLE_PACKAGE" };
  }

  // The one atomic, concurrency-safe transaction (re-validates everything). The
  // front desk operates the schedule and can book any PUBLISHED class regardless
  // of the customer-facing public-visibility window, so it books with full
  // ("member") visibility — the tiered gate (CLAUDE.md §5 inv 4) is a customer
  // browsing restriction, not an admin one.
  const result = await bookClassWithDebit(
    {
      classInstanceId: input.classInstanceId,
      userId: input.userId,
      viewerTier: "member",
      packageId,
      position: input.position,
    },
    now,
  );
  if (!result.ok) {
    return { ok: false, code: result.code };
  }

  registerNotificationHandlers();
  await emit({
    type: "booking.confirmed",
    bookingId: result.bookingId,
    userId: input.userId,
    classInstanceId: input.classInstanceId,
  });

  revalidatePath("/admin/bookings");
  return {
    ok: true,
    bookingId: result.bookingId,
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

interface BookingForAdminCancel {
  status: "booked" | "cancelled";
  startsAt: Date;
  bookingUserId: string;
  /** The class whose seat is freed on cancel — used to offer the waitlist head. */
  classInstanceId: string;
  /** The free window (hours) locked on this booking at booking time (5 | 1). */
  freeCancelHours: number;
}

async function loadBookingForAdminCancel(bookingId: string): Promise<BookingForAdminCancel | null> {
  const db = getDb();
  const [row] = await db
    .select({
      status: bookings.status,
      startsAt: classInstances.startsAt,
      bookingUserId: bookings.userId,
      classInstanceId: bookings.classInstanceId,
      freeCancelHours: bookings.freeCancelHours,
    })
    .from(bookings)
    .innerJoin(classInstances, eq(bookings.classInstanceId, classInstances.id))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  return row ?? null;
}
