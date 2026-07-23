"use server";

// Server actions for the customer waitlist flow (CLAUDE.md §5 invariant 6). These
// are the typed contracts the frontend imports and calls directly.
//
// KEY SEMANTICS — "first to confirm wins" (decided 2026-06-19): the 30-minute
// offer is a FIFO *notification head-start*, NOT a seat reservation. Joining a
// waitlist NEVER books a seat and NEVER charges. Confirming an offer just runs the
// normal atomic booking path — so it can still lose to a walk-up who booked the
// freed seat first (→ OFFER_LOST). Nothing here changes occupancy/capacity: the
// freed seat stays openly bookable, and the live booked count is the only seat
// truth (computed exactly as the bookable read model does).
//
// Security (CLAUDE.md §8): the client supplies only ids; identity, tier,
// household, the package to debit on confirm, the cost, and every eligibility
// guard are resolved/recomputed server-side. No client balance/price is trusted.

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { bookings, classInstances, waitlist } from "@/lib/db/schema";
import type { ClassType } from "@/lib/domain/types";
import { effectiveCapacity, isCustomerBookable } from "@/lib/domain/types";
import { bookClassWithDebit, type BookFailureCode } from "@/lib/credits/debit";
import { selectUsablePackage } from "@/lib/credits/selectPackage";
import { creditCostForClassType } from "@/lib/credits/cost";
import { isBookableForViewer } from "@/lib/schedule/visibility";
import { emit } from "@/lib/events/bus";
import { registerNotificationHandlers } from "@/lib/events/notifications";

// ───────────────────────── join ─────────────────────────

const joinInput = z.object({
  classInstanceId: z.string().uuid(),
});
export type JoinWaitlistInput = z.infer<typeof joinInput>;

/**
 * Why a join could not be completed. The class must be full (else just book), the
 * viewer must not already hold a live booking in it, and must not already be on its
 * queue as `waiting`/`offered`.
 */
export type JoinWaitlistFailureCode =
  | "INVALID_INPUT"
  | "CLASS_NOT_FOUND"
  // The class is still inside its members-only window for this (guest) viewer —
  // not yet publicly bookable, so it can't be waitlisted either (CLAUDE.md §5 inv 4).
  | "NOT_VISIBLE"
  // Private/Duo/Trio are front-desk-only — a customer must not queue for a class
  // they can't self-book (CUSTOMER_BOOKABLE_TYPES). Mirrors the booking ADMIN_ONLY.
  | "ADMIN_ONLY"
  | "NOT_FULL"
  | "ALREADY_BOOKED"
  | "ALREADY_WAITLISTED";

export type JoinWaitlistResult =
  | { ok: true; waitlistId: string; position: number }
  | { ok: false; code: JoinWaitlistFailureCode };

/**
 * Join the waitlist for a full class. Writes a `waiting` row at the next FIFO
 * position (max+1 for that class) — never a booking, never a charge (CLAUDE.md §5
 * invariant 6). Returns the queue position.
 *
 * The full-check, duplicate-booking check, the next-position read, and the insert
 * all run inside ONE transaction so two simultaneous joins can't collide on the
 * same position and a class that fills/empties mid-flight is judged consistently.
 */
export async function joinWaitlist(raw: JoinWaitlistInput): Promise<JoinWaitlistResult> {
  const parsed = joinInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const { classInstanceId } = parsed.data;
  const now = new Date();

  const viewer = await getCurrentUser();
  const db = getDb();

  return db.transaction(async (tx) => {
    // Resolve + LOCK the class row (FOR UPDATE) for the rest of the tx. This
    // serialises concurrent joins for the SAME class so the max(position)+1 read
    // and insert below can't race two joiners onto the same FIFO position (the
    // table has no unique (class,position) constraint and Postgres runs READ
    // COMMITTED by default). Mirrors the lock discipline in bookClassWithDebit.
    const [cls] = await tx
      .select({
        id: classInstances.id,
        type: classInstances.type,
        capacity: classInstances.capacity,
        status: classInstances.status,
        startsAt: classInstances.startsAt,
        publicVisibleAt: classInstances.publicVisibleAt,
      })
      .from(classInstances)
      .where(eq(classInstances.id, classInstanceId))
      .for("update")
      .limit(1);
    if (!cls) {
      return { ok: false, code: "CLASS_NOT_FOUND" } as const;
    }

    // Front-desk-only types are never self-bookable, so they are never waitlistable
    // by a customer either — bail before the full/dupe checks (single source:
    // CUSTOMER_BOOKABLE_TYPES). Rentals stay waitlistable when full.
    if (!isCustomerBookable(cls.type as ClassType)) {
      return { ok: false, code: "ADMIN_ONLY" } as const;
    }

    // Tiered visibility under the lock (CLAUDE.md §5 inv 4). Like the booking
    // write path, a guest who knows the id must not be able to waitlist a class
    // still in its members-only window. Re-use the single pure predicate (which
    // also re-checks status='published' AND startsAt > now); tier is resolved
    // server-side from the session, never the client.
    if (
      !isBookableForViewer(
        { status: cls.status, startsAt: cls.startsAt, publicVisibleAt: cls.publicVisibleAt },
        { tier: viewer.tier },
        now,
      )
    ) {
      return { ok: false, code: "NOT_VISIBLE" } as const;
    }

    // FULL? Live booked count vs effective capacity — the SAME computation the
    // bookable read model uses (clamp to the hard cap for the type). We do NOT
    // change occupancy; we only read it. Only a full class is waitlist-eligible.
    const cap = effectiveCapacity(cls.capacity, cls.type as ClassType);
    const bookedRows = await tx
      .select({ booked: sql<number>`count(*)::int` })
      .from(bookings)
      .where(and(eq(bookings.classInstanceId, cls.id), eq(bookings.status, "booked")));
    const booked = bookedRows[0]?.booked ?? 0;
    if (booked < cap) {
      return { ok: false, code: "NOT_FULL" } as const;
    }

    // The viewer must not already hold a live booking in this class.
    const [existingBooking] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.classInstanceId, cls.id),
          eq(bookings.userId, viewer.id),
          eq(bookings.status, "booked"),
        ),
      )
      .limit(1);
    if (existingBooking) {
      return { ok: false, code: "ALREADY_BOOKED" } as const;
    }

    // …and must not already be on this class's queue as waiting/offered.
    const [existingEntry] = await tx
      .select({ id: waitlist.id })
      .from(waitlist)
      .where(
        and(
          eq(waitlist.classInstanceId, cls.id),
          eq(waitlist.userId, viewer.id),
          sql`${waitlist.status} in ('waiting','offered')`,
        ),
      )
      .limit(1);
    if (existingEntry) {
      return { ok: false, code: "ALREADY_WAITLISTED" } as const;
    }

    // Next FIFO position = max(position)+1 for this class (1-based; counts every
    // historical row so positions remain monotone even after expiries/claims).
    const maxPosRows = await tx
      .select({ maxPos: sql<number>`coalesce(max(${waitlist.position}), 0)::int` })
      .from(waitlist)
      .where(eq(waitlist.classInstanceId, cls.id));
    const position = (maxPosRows[0]?.maxPos ?? 0) + 1;

    const [row] = await tx
      .insert(waitlist)
      .values({ classInstanceId: cls.id, userId: viewer.id, position, status: "waiting" })
      .returning({ id: waitlist.id });

    return { ok: true, waitlistId: row!.id, position } as const;
  });
}

// ───────────────────────── confirm an offer ─────────────────────────

const confirmInput = z.object({
  waitlistId: z.string().uuid(),
});
export type ConfirmWaitlistOfferInput = z.infer<typeof confirmInput>;

/**
 * Why a confirm could not be completed. Adds the offer-gate codes to the
 * underlying booking failures. `OFFER_LOST` is `CLASS_FULL` re-mapped — a walk-up
 * took the freed seat first (first-to-confirm-wins); the row is left `offered` so
 * the sweep can later expire/cascade it.
 */
export type ConfirmWaitlistFailureCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "NOT_OFFERED"
  | "OFFER_EXPIRED"
  | "OFFER_LOST"
  | "CLASS_NOT_FOUND"
  | "NO_USABLE_PACKAGE"
  // Every booking-path failure except CLASS_FULL (which is mapped to OFFER_LOST).
  | Exclude<BookFailureCode, "CLASS_FULL">;

export type ConfirmWaitlistResult =
  | { ok: true; bookingId: string; hoursLeft: number; freeCancelHours: number }
  | { ok: false; code: ConfirmWaitlistFailureCode };

/**
 * Claim an offered waitlist seat by running the NORMAL atomic booking path. No
 * auto-charge ever happened on offer; the debit happens only now, on confirm.
 *
 * Gate: the offer must belong to the viewer, be `offered`, and have
 * `holdExpiresAt > now` (else OFFER_EXPIRED). Then pick a usable package
 * (cost-aware) and book+debit atomically. On success the row is marked `claimed`.
 * If the booking returns CLASS_FULL the seat was taken by a walk-up → OFFER_LOST,
 * and the row is LEFT `offered` so the sweep can expire/cascade it normally.
 *
 * The gate and the booking are separate transactions, so the offer-row lock does
 * NOT span the booking — a rare double-confirm can pass the gate twice. That is
 * harmless: `bookClassWithDebit` is independently atomic, so the second confirm
 * gets ALREADY_BOOKED / CLASS_FULL and never double-books or double-debits. The
 * booking path is the sole seat/credit authority.
 */
export async function confirmWaitlistOffer(
  raw: ConfirmWaitlistOfferInput,
): Promise<ConfirmWaitlistResult> {
  const parsed = confirmInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const { waitlistId } = parsed.data;
  const now = new Date();

  const viewer = await getCurrentUser();
  const db = getDb();

  // 1) Lock + gate the offer in its own short transaction. We resolve the class
  //    type here too so the package selection below uses the right category. We do
  //    NOT mark `claimed` yet — only after the booking actually commits.
  const gate = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: waitlist.id,
        userId: waitlist.userId,
        classInstanceId: waitlist.classInstanceId,
        status: waitlist.status,
        holdExpiresAt: waitlist.holdExpiresAt,
      })
      .from(waitlist)
      .where(eq(waitlist.id, waitlistId))
      .for("update");

    if (!row) return { ok: false, code: "NOT_FOUND" } as const;
    // Ownership before state so a non-owner can never probe an offer they don't own.
    if (row.userId !== viewer.id) return { ok: false, code: "FORBIDDEN" } as const;
    if (row.status !== "offered") return { ok: false, code: "NOT_OFFERED" } as const;
    if (!row.holdExpiresAt || row.holdExpiresAt.getTime() <= now.getTime()) {
      return { ok: false, code: "OFFER_EXPIRED" } as const;
    }

    const [cls] = await tx
      .select({ type: classInstances.type })
      .from(classInstances)
      .where(eq(classInstances.id, row.classInstanceId))
      .limit(1);
    if (!cls) return { ok: false, code: "CLASS_NOT_FOUND" } as const;

    return { ok: true, classInstanceId: row.classInstanceId, type: cls.type } as const;
  });

  if (!gate.ok) return { ok: false, code: gate.code };

  // 2) Pick the package to debit — cost-aware, never client-supplied. (CLAUDE.md §8)
  const packageId = await selectUsablePackage(
    viewer,
    gate.type as ClassType,
    now,
    creditCostForClassType(gate.type as ClassType),
  );
  if (!packageId) {
    return { ok: false, code: "NO_USABLE_PACKAGE" };
  }

  // 3) The ONE atomic, concurrency-safe booking transaction (re-validates seats &
  //    credits). First-to-confirm-wins: this can return CLASS_FULL if a walk-up
  //    booked the freed seat first.
  const booked = await bookClassWithDebit(
    { classInstanceId: gate.classInstanceId, userId: viewer.id, viewerTier: viewer.tier, packageId },
    now,
  );

  if (!booked.ok) {
    // A lost race for the seat → OFFER_LOST; leave the row `offered` so the sweep
    // can expire/cascade it. Every other failure passes straight through.
    if (booked.code === "CLASS_FULL") {
      return { ok: false, code: "OFFER_LOST" };
    }
    return { ok: false, code: booked.code };
  }

  // 4) Booking committed — mark the offer `claimed` (best-effort; re-assert
  //    `offered` so a concurrent sweep can't clobber a just-claimed row). The
  //    booking is the source of truth; a failed status flip never undoes the seat.
  try {
    await db
      .update(waitlist)
      .set({ status: "claimed" })
      .where(and(eq(waitlist.id, waitlistId), eq(waitlist.status, "offered")));
  } catch (err) {
    console.error(`[waitlist] failed to mark ${waitlistId} claimed after booking:`, err);
  }

  // CRM is a thin listener on the domain event — this confirm is its own booking
  // entry point, so it emits `booking.confirmed` just like the standard booking
  // action does, so notifications fire identically (best-effort bus).
  registerNotificationHandlers();
  await emit({
    type: "booking.confirmed",
    bookingId: booked.bookingId,
    userId: viewer.id,
    classInstanceId: gate.classInstanceId,
  });

  return {
    ok: true,
    bookingId: booked.bookingId,
    hoursLeft: booked.hoursLeft,
    freeCancelHours: booked.freeCancelHours,
  };
}

// The read model (`listMyWaitlist` + `MyWaitlistEntry`) lives in
// `@/lib/waitlist/queries` — import it directly from a server component. It is NOT
// re-exported here because this is a `"use server"` action module, every export of
// which must be an async client-invocable action.
