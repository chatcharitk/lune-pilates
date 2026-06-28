"use server";

// Server actions for the admin "Bookings & waitlist control" screen (spec §4:
// "Manual book/cancel, and waitlist with the notify-and-confirm window"). These
// are the typed contracts the frontend imports and calls directly.
//
// Every action is OWNER-ONLY: gated by `requireOwner()` (lib/auth/admin.ts — v1
// mock provider; the real staff/LINE provider swaps in at `getAdminAuth()`). An
// instructor is rejected like unauth (UNAUTHORIZED).
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
import {
  bookClassWithDebit,
  cancelBooking,
  rescheduleWithinTransaction,
  type BookFailureCode,
  type RescheduleFailureCode,
} from "@/lib/credits/debit";
import { creditCostForClassType } from "@/lib/credits/cost";
import { evaluateCancellation } from "@/lib/credits/policy";
import {
  selectUsablePackageForUser,
  selectPackageForRescheduleForUser,
} from "@/lib/credits/selectPackage";
import { positionsForCapacity } from "@/lib/schedule/queries";
import { emit } from "@/lib/events/bus";
import { registerNotificationHandlers } from "@/lib/events/notifications";
import { offerNextWaitlistSeat } from "@/lib/waitlist/queries";
import { getAdminBookings } from "@/lib/admin/bookings";
import { requireOwner } from "@/lib/auth/admin";

// ───────────────────────── admin cancel ─────────────────────────

const adminCancelInput = z.object({
  bookingId: z.string().uuid(),
  /**
   * Optional explicit refund override. When omitted, the refund follows the
   * booking's policy verdict (free within the fixed 5h window → refund,
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
  /** The free window (hours) locked on this booking at booking time (always 5). */
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
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

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

  // Fixed-window verdict (CLAUDE.md §5 inv 7). Note: admin cancel is NOT gated by
  // the window — the front desk may cancel any booking; `policy.free` only decides
  // the default refund (which an explicit admin boolean can still override).
  const policy = evaluateCancellation(loaded.startsAt, now);
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
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

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
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

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

// ───────────────────────── admin reschedule ─────────────────────────

const adminRescheduleInput = z.object({
  /** The live booking to move (resolves the target customer + old package server-side). */
  bookingId: z.string().uuid(),
  /** The class to move it to. Its type drives the package category + seat validation. */
  newClassInstanceId: z.string().uuid(),
  position: z.enum(["left", "middle", "right"]).optional(),
});
export type AdminRescheduleInput = z.infer<typeof adminRescheduleInput>;

/**
 * Why an admin reschedule could not complete. The action-level gates plus the
 * transactional reschedule codes (minus RESCHEDULE_WINDOW_CLOSED, which the admin
 * path can never hit — it bypasses the 5h window).
 */
export type AdminRescheduleFailureCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "NOT_LIVE"
  | "CLASS_NOT_FOUND"
  | "NO_USABLE_PACKAGE"
  | RescheduleFailureCode;

export type AdminRescheduleResult =
  | { ok: true; newBookingId: string; hoursLeft: number; freeCancelHours: number }
  | { ok: false; code: AdminRescheduleFailureCode };

/**
 * Reschedule ANY customer's booking from the front desk (owner-only).
 *
 * NOT bound by the 5h customer free window (CLAUDE.md §5 inv 7, decided 2026-06-28):
 * the front desk may move a booking regardless of how close to start it is —
 * `rescheduleWithinTransaction` is called with `skipWindowCheck: true`. Everything
 * money- and seat-critical still goes through that SAME atomic, concurrency-safe
 * transaction the customer path uses: refund-old + debit-new together, all-or-nothing,
 * net-zero for same-cost types. The target customer, their old package + cost, and the
 * new package are all resolved server-side from the booking row and the customer's
 * pool — the admin never supplies a balance, price, package id, tier or household (§8).
 *
 * Visibility: like `adminBookForCustomer`, the new booking is made with full ("member")
 * visibility — the tiered gate is a customer browsing restriction, not an admin one.
 *
 * On success emits `booking.confirmed` (new) + `booking.cancelled` (old, refunded) and
 * best-effort offers the OLD class's freed seat to its waitlist head.
 *
 * No-DB dev path: returns ok with synthesized values so the UI works on mock data.
 */
export async function adminReschedule(raw: AdminRescheduleInput): Promise<AdminRescheduleResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = adminRescheduleInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const input = parsed.data;
  const now = new Date();

  if (!process.env.DATABASE_URL) {
    return {
      ok: true,
      newBookingId: "00000000-0000-4000-8000-0000000000b2",
      hoursLeft: 7,
      freeCancelHours: 5,
    };
  }

  // 1) Load the OLD booking → the target customer, old package, old cost, old class.
  const old = await loadBookingForAdminCancel(input.bookingId);
  if (!old) {
    return { ok: false, code: "NOT_FOUND" };
  }
  if (old.status !== "booked") {
    return { ok: false, code: "NOT_LIVE" };
  }

  // 2) Resolve the NEW class server-side (its type drives package category + seat
  //    validation). Reject an illegal position early; the tx re-validates under lock.
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

  // 3) Pick the NEW package for THE CUSTOMER (not the admin) — net-zero aware,
  //    recomputed from their pool; never a client-supplied id (§8).
  const newCost = creditCostForClassType(newCls.type);
  const packageId = await selectPackageForRescheduleForUser(
    old.bookingUserId,
    newCls.type,
    old.packageId,
    old.creditCost,
    newCost,
    now,
  );
  if (!packageId) {
    return { ok: false, code: "NO_USABLE_PACKAGE" };
  }

  // 4) THE ONE atomic transaction, on the CUSTOMER's behalf, with the 5h window
  //    bypassed (admin override) and full member visibility.
  const result = await rescheduleWithinTransaction(
    {
      oldBookingId: input.bookingId,
      newClassInstanceId: input.newClassInstanceId,
      userId: old.bookingUserId,
      viewerTier: "member",
      newPackageId: packageId,
      position: input.position,
      skipWindowCheck: true,
    },
    now,
  );
  if (!result.ok) {
    switch (result.code) {
      case "OLD_NOT_FOUND":
        return { ok: false, code: "NOT_FOUND" };
      case "OLD_NOT_LIVE":
        return { ok: false, code: "NOT_LIVE" };
      default:
        // Every BookFailureCode (CLASS_FULL, POSITION_TAKEN, …) passes through.
        return { ok: false, code: result.code };
    }
  }

  registerNotificationHandlers();
  await emit({
    type: "booking.confirmed",
    bookingId: result.newBookingId,
    userId: old.bookingUserId,
    classInstanceId: input.newClassInstanceId,
  });
  await emit({
    type: "booking.cancelled",
    bookingId: input.bookingId,
    userId: old.bookingUserId,
    refunded: true,
  });

  // The OLD class's seat just freed up → offer it to its waitlist head. Best-effort:
  // a failed offer must NEVER undo the committed reschedule.
  try {
    await offerNextWaitlistSeat(old.classInstanceId, now);
  } catch (err) {
    console.error(`[admin] waitlist offer after reschedule ${input.bookingId} failed:`, err);
  }

  revalidatePath("/admin/bookings");
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

interface BookingForAdminCancel {
  status: "booked" | "cancelled";
  startsAt: Date;
  bookingUserId: string;
  /** The class whose seat is freed on cancel — used to offer the waitlist head. */
  classInstanceId: string;
  /** The free window (hours) locked on this booking at booking time (always 5). */
  freeCancelHours: number;
  /** The exact credit cost this booking debited — the refund amount on a move/cancel. */
  creditCost: number;
  /** The package this booking debited — the refund target on a move/cancel. */
  packageId: string;
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
      creditCost: bookings.creditCost,
      packageId: bookings.packageId,
    })
    .from(bookings)
    .innerJoin(classInstances, eq(bookings.classInstanceId, classInstances.id))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  return row ?? null;
}
