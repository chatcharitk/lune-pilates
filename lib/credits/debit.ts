// The money-critical core: book a class and debit a shared-household credit in
// ONE atomic, concurrency-safe transaction (CLAUDE.md §5, invariant 1).
//
// Ordering of locks is fixed (class instance → package) to avoid deadlocks.
// Locking the class row serialises concurrent bookings for the same class so the
// capacity count can't oversell seats; locking the package row serialises the
// household pool so two members can't oversell credits.

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { bookings, classInstances, creditLedger, packages } from "@/lib/db/schema";
import type { ReformerPosition } from "@/lib/domain/types";
import { effectiveCapacity, FREE_CANCEL_HOURS } from "@/lib/domain/types";
import { positionsForCapacity } from "@/lib/schedule/queries";
import { isBookableForViewer } from "@/lib/schedule/visibility";
import { creditCostForClassType } from "./cost";
import { packageDebitBlock } from "./guards";

export const bookInput = z.object({
  classInstanceId: z.string().uuid(),
  userId: z.string().uuid(),
  // The viewer's tier, RESOLVED SERVER-SIDE by the caller (session/DB) — never
  // client-supplied. Gates tiered visibility (CLAUDE.md §5 inv 4) under the lock:
  // a guest cannot book a class still inside its members-only window.
  viewerTier: z.enum(["member", "guest"]),
  packageId: z.string().uuid(),
  position: z.enum(["left", "middle", "right"]).optional(),
});
export type BookInput = z.infer<typeof bookInput>;

export type BookFailureCode =
  | "NOT_BOOKABLE"
  | "NOT_VISIBLE"
  | "CLASS_FULL"
  | "ALREADY_BOOKED"
  | "POSITION_TAKEN"
  | "INVALID_POSITION"
  | "PACKAGE_NOT_FOUND"
  | "EXPIRED"
  | "NO_CREDITS";

export type BookResult =
  | { ok: true; bookingId: string; hoursLeft: number; freeCancelHours: number }
  | { ok: false; code: BookFailureCode };

/**
 * Map a Postgres unique-violation (23505) on one of the booking backstop indexes
 * (audit LOW-1) to the friendly business code, or null when the error is unrelated.
 *
 * The `@neondatabase/serverless` driver WRAPS the pg error, so the SQLSTATE and
 * the constraint name can land on `err.cause` rather than the top level — we read
 * both (mirroring `isUniqueViolation` in creditPackage.ts).
 *
 * The in-transaction checks (class FOR UPDATE + dupe/position selects) already
 * prevent these races, so this only ever fires if a logic regression slips past
 * them — defense in depth, so we surface ALREADY_BOOKED / POSITION_TAKEN instead
 * of leaking a raw 23505.
 */
function uniqueViolationCode(err: unknown): "ALREADY_BOOKED" | "POSITION_TAKEN" | null {
  type PgErrorLike = { code?: unknown; constraint?: unknown; cause?: unknown };
  const pick = (e: unknown): PgErrorLike | null =>
    typeof e === "object" && e !== null ? (e as PgErrorLike) : null;
  const top = pick(err);
  const cause = pick(top?.cause);
  const code = top?.code ?? cause?.code;
  if (code !== "23505") return null;
  const constraint =
    (typeof top?.constraint === "string" && top.constraint) ||
    (typeof cause?.constraint === "string" && cause.constraint) ||
    "";
  if (constraint === "bookings_one_live_per_position") return "POSITION_TAKEN";
  // Default the (class,user) index — and any unattributed booking 23505 — to the
  // safe, friendly ALREADY_BOOKED rather than leaking the raw violation.
  return "ALREADY_BOOKED";
}

/**
 * Atomically book `classInstanceId` for `userId`, debiting the class type's
 * credit cost (1 group / 2 private·duo·trio) from `packageId`. Returns a typed
 * result — never throws on a business-rule failure. Enforces tiered visibility
 * under the lock from the server-resolved `viewerTier` (CLAUDE.md §5 inv 4).
 *
 * @param now injectable clock for tests; defaults to wall-clock time.
 */
export async function bookClassWithDebit(
  raw: BookInput,
  now: Date = new Date(),
): Promise<BookResult> {
  const input = bookInput.parse(raw);
  const db = getDb();

  try {
    return await db.transaction(async (tx) => {
    // 1) Lock the class instance and re-validate bookability under the lock.
    const [cls] = await tx
      .select()
      .from(classInstances)
      .where(eq(classInstances.id, input.classInstanceId))
      .for("update");

    if (!cls || cls.status !== "published" || cls.startsAt.getTime() <= now.getTime()) {
      return { ok: false, code: "NOT_BOOKABLE" } as const;
    }

    // Tiered visibility under the lock (CLAUDE.md §5 inv 4). The read models gate
    // display, but the WRITE path must enforce it too: a guest who knows the id
    // (it's in the /schedule/[id] URL) must not be able to book a class still in
    // its members-only window. Re-use the single pure predicate so the rule stays
    // single-sourced; viewerTier is resolved server-side by the caller, not the
    // client. (status/startsAt are already re-validated just above.)
    if (
      !isBookableForViewer(
        { status: cls.status, startsAt: cls.startsAt, publicVisibleAt: cls.publicVisibleAt },
        { tier: input.viewerTier },
        now,
      )
    ) {
      return { ok: false, code: "NOT_VISIBLE" } as const;
    }

    // Effective capacity clamps a possibly mis-seeded instance to the hard cap
    // for its type, so a Duo/Private can never be oversold (CLAUDE.md §5 inv 8).
    const cap = effectiveCapacity(cls.capacity, cls.type);

    // Reformer position (if supplied) must be one the class actually offers.
    // Validate server-side against the effective capacity — never trust the
    // client to send a legal seat.
    if (input.position) {
      const allowed = positionsForCapacity(cap);
      if (!allowed.includes(input.position)) {
        return { ok: false, code: "INVALID_POSITION" } as const;
      }
    }

    // 2) Capacity — count live bookings for this class (serialised by the lock above).
    const bookedRows = await tx
      .select({ booked: sql<number>`count(*)::int` })
      .from(bookings)
      .where(and(eq(bookings.classInstanceId, cls.id), eq(bookings.status, "booked")));
    const booked = bookedRows[0]?.booked ?? 0;

    if (booked >= cap) {
      return { ok: false, code: "CLASS_FULL" } as const;
    }

    // 3) One live booking per user per class.
    const [dupe] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.classInstanceId, cls.id),
          eq(bookings.userId, input.userId),
          eq(bookings.status, "booked"),
        ),
      );
    if (dupe) return { ok: false, code: "ALREADY_BOOKED" } as const;

    // 4) Reformer position must be free (when the class uses positions).
    if (input.position) {
      const [taken] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.classInstanceId, cls.id),
            eq(bookings.position, input.position),
            eq(bookings.status, "booked"),
          ),
        );
      if (taken) return { ok: false, code: "POSITION_TAKEN" } as const;
    }

    // 5) Lock the package (the household pool) and re-check the debit guard.
    const [pkg] = await tx
      .select()
      .from(packages)
      .where(eq(packages.id, input.packageId))
      .for("update");

    if (!pkg) return { ok: false, code: "PACKAGE_NOT_FOUND" } as const;

    // Cost for this class type (1 group / 2 private·duo·trio). The guard
    // re-checks the package holds at least `cost` credits and is not expired.
    const cost = creditCostForClassType(cls.type);
    const block = packageDebitBlock(pkg, cost, now);
    if (block) return { ok: false, code: block } as const;

    // The cancellation window is a single FIXED 5h window for every booking
    // (CLAUDE.md §5 invariant 7, decided 2026-06-28). Stamp the constant as an
    // audit record on the booking; it is no longer derived from lead time.
    const freeCancelHours = FREE_CANCEL_HOURS;

    // 6) Write the booking (recording the exact cost debited + the locked window),
    //    the −cost ledger row (stamped with the actor), and decrement the cached
    //    balance by cost — all within this transaction.
    const [bk] = await tx
      .insert(bookings)
      .values({
        classInstanceId: cls.id,
        userId: input.userId,
        packageId: pkg.id,
        position: input.position as ReformerPosition | undefined,
        creditCost: cost,
        freeCancelHours,
        status: "booked",
      })
      .returning({ id: bookings.id });

    await tx.insert(creditLedger).values({
      packageId: pkg.id,
      delta: -cost,
      actorUserId: input.userId,
      bookingId: bk!.id,
      reason: "booking",
    });

    const hoursLeft = pkg.hoursLeft - cost;
    await tx.update(packages).set({ hoursLeft }).where(eq(packages.id, pkg.id));

    return { ok: true, bookingId: bk!.id, hoursLeft, freeCancelHours } as const;
    });
  } catch (err) {
    // Backstop: a 23505 on a booking unique index → the friendly seat-taken code
    // (audit LOW-1) instead of a raw violation. Anything else is a real fault.
    const code = uniqueViolationCode(err);
    if (code) return { ok: false, code };
    throw err;
  }
}

// ───────────────────────── atomic reschedule (single transaction) ─────────────────────────

export const rescheduleInput = z.object({
  oldBookingId: z.string().uuid(),
  newClassInstanceId: z.string().uuid(),
  userId: z.string().uuid(),
  viewerTier: z.enum(["member", "guest"]),
  // The package the NEW booking debits, resolved server-side (cost-aware) by the
  // caller — never client-supplied. The OLD package (refund target) is read from
  // the old booking row, not trusted from the caller.
  newPackageId: z.string().uuid(),
  position: z.enum(["left", "middle", "right"]).optional(),
  // Bypass the 5h free-window gate on the OLD booking. Set ONLY by the owner-only
  // admin reschedule path (CLAUDE.md §5 inv 7, decided 2026-06-28): the front desk
  // can move a client's booking regardless of how close to start it is. The
  // customer flow never sets this, so it is still bound by the window.
  skipWindowCheck: z.boolean().optional(),
});
export type RescheduleInput = z.infer<typeof rescheduleInput>;

/**
 * Why an atomic reschedule could not complete. The OLD-leg gates
 * (OLD_NOT_FOUND / OLD_NOT_LIVE / RESCHEDULE_WINDOW_CLOSED) plus every NEW-booking
 * failure (`BookFailureCode`). Ownership/identity are gated by the caller before
 * this runs.
 */
export type RescheduleFailureCode =
  | "OLD_NOT_FOUND"
  | "OLD_NOT_LIVE"
  | "RESCHEDULE_WINDOW_CLOSED"
  | BookFailureCode;

export type RescheduleResult =
  | { ok: true; newBookingId: string; hoursLeft: number; freeCancelHours: number }
  | { ok: false; code: RescheduleFailureCode };

/**
 * Move a live booking to a different class instance in ONE atomic, concurrency-safe
 * transaction (CLAUDE.md §5 invariant 7): refund the old booking's exact cost and
 * debit the new class's cost together — all-or-nothing. There is no crash window in
 * which the member can hold both bookings or lose the old refund (the prior
 * two-transaction implementation's only residual risk).
 *
 * Reschedule is allowed ONLY within the OLD booking's free window (re-judged under
 * the lock against the window stamped on that booking, never a recomputation). The
 * net credit effect is refund(old) + debit(new): net-zero for same-cost types.
 *
 * Lock ordering is FIXED to avoid deadlocks: old booking → new class instance →
 * package(s) in ascending id order (the new debit and the old refund may settle on
 * the SAME package or two different ones; locking by sorted id makes the order
 * deterministic across concurrent reschedules, matching the class→package
 * discipline of `bookClassWithDebit`).
 *
 * @param now injectable clock for tests; defaults to wall-clock time.
 */
export async function rescheduleWithinTransaction(
  raw: RescheduleInput,
  now: Date = new Date(),
): Promise<RescheduleResult> {
  const input = rescheduleInput.parse(raw);
  const db = getDb();

  try {
    return await db.transaction(async (tx) => {
    // 1) Lock the OLD booking and gate it: must exist and still be live.
    const [oldBk] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, input.oldBookingId))
      .for("update");
    if (!oldBk) return { ok: false, code: "OLD_NOT_FOUND" } as const;
    if (oldBk.status !== "booked") return { ok: false, code: "OLD_NOT_LIVE" } as const;

    // The OLD class's start drives the free-window re-check (we judge against the
    // window LOCKED on the old booking, not a recomputation).
    const [oldCls] = await tx
      .select({ startsAt: classInstances.startsAt })
      .from(classInstances)
      .where(eq(classInstances.id, oldBk.classInstanceId));
    if (!oldCls) return { ok: false, code: "OLD_NOT_FOUND" } as const;

    // Reschedule is a FREE move allowed only inside the old booking's free window
    // (CLAUDE.md §5 inv 7) — UNLESS the caller is the owner-only admin path, which
    // bypasses the 5h gate entirely (skipWindowCheck). The customer flow never sets
    // the flag, so it stays bound by the window.
    if (!input.skipWindowCheck) {
      const hoursUntilOldStart = (oldCls.startsAt.getTime() - now.getTime()) / 3_600_000;
      if (hoursUntilOldStart < oldBk.freeCancelHours) {
        return { ok: false, code: "RESCHEDULE_WINDOW_CLOSED" } as const;
      }
    }

    // 2) Lock the NEW class instance and re-validate bookability under the lock —
    //    the SAME checks bookClassWithDebit performs (status/startsAt, tiered
    //    visibility, capacity, dupe, position).
    const [newCls] = await tx
      .select()
      .from(classInstances)
      .where(eq(classInstances.id, input.newClassInstanceId))
      .for("update");
    if (!newCls || newCls.status !== "published" || newCls.startsAt.getTime() <= now.getTime()) {
      return { ok: false, code: "NOT_BOOKABLE" } as const;
    }
    if (
      !isBookableForViewer(
        { status: newCls.status, startsAt: newCls.startsAt, publicVisibleAt: newCls.publicVisibleAt },
        { tier: input.viewerTier },
        now,
      )
    ) {
      return { ok: false, code: "NOT_VISIBLE" } as const;
    }

    const cap = effectiveCapacity(newCls.capacity, newCls.type);
    if (input.position) {
      const allowed = positionsForCapacity(cap);
      if (!allowed.includes(input.position)) {
        return { ok: false, code: "INVALID_POSITION" } as const;
      }
    }

    // Capacity on the new class — count live bookings (serialised by the lock).
    const newBookedRows = await tx
      .select({ booked: sql<number>`count(*)::int` })
      .from(bookings)
      .where(and(eq(bookings.classInstanceId, newCls.id), eq(bookings.status, "booked")));
    if ((newBookedRows[0]?.booked ?? 0) >= cap) {
      return { ok: false, code: "CLASS_FULL" } as const;
    }

    // One live booking per user per class. (The OLD booking is in a DIFFERENT
    // class — reschedule targets a new instance — so it never trips this; a
    // self-reschedule to the same class is a no-op the caller should not send,
    // but if it does, ALREADY_BOOKED is the correct fail-closed answer.)
    const [dupe] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.classInstanceId, newCls.id),
          eq(bookings.userId, input.userId),
          eq(bookings.status, "booked"),
        ),
      );
    if (dupe) return { ok: false, code: "ALREADY_BOOKED" } as const;

    if (input.position) {
      const [taken] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.classInstanceId, newCls.id),
            eq(bookings.position, input.position),
            eq(bookings.status, "booked"),
          ),
        );
      if (taken) return { ok: false, code: "POSITION_TAKEN" } as const;
    }

    // 3) Lock the package(s) in a FIXED order (ascending id) to avoid deadlocks.
    //    The refund target is the OLD booking's package; the debit target is the
    //    NEW package. They may be the same row.
    const samePackage = oldBk.packageId === input.newPackageId;
    const lockIds = samePackage
      ? [input.newPackageId]
      : [oldBk.packageId, input.newPackageId].sort();
    const lockedRows = await tx
      .select()
      .from(packages)
      .where(inArray(packages.id, lockIds))
      .for("update");
    const byId = new Map(lockedRows.map((p) => [p.id, p]));
    const newPkg = byId.get(input.newPackageId);
    const oldPkg = byId.get(oldBk.packageId);
    if (!newPkg) return { ok: false, code: "PACKAGE_NOT_FOUND" } as const;

    // 4) Guard the NEW debit on the post-refund balance. If the refund settles to
    //    the SAME package, the old cost is credited back first, so a same-cost move
    //    is always affordable (net-zero) even at a zero starting balance.
    const newCost = creditCostForClassType(newCls.type);
    const refundCost = oldBk.creditCost;
    const newPkgBalanceForGuard =
      samePackage && oldPkg ? newPkg.hoursLeft + refundCost : newPkg.hoursLeft;
    const block = packageDebitBlock(
      { hoursLeft: newPkgBalanceForGuard, expiresAt: newPkg.expiresAt },
      newCost,
      now,
    );
    if (block) return { ok: false, code: block } as const;

    // Fixed 5h window stamped on the new booking (audit constant, CLAUDE.md §5 inv 7).
    const freeCancelHours = FREE_CANCEL_HOURS;

    // 5a) Release the OLD booking with a +refundCost ledger row (within the free
    //     window → refund the exact cost it debited, never a hardcoded 1).
    await tx
      .update(bookings)
      .set({ status: "cancelled", cancelledAt: now })
      .where(and(eq(bookings.id, oldBk.id), ne(bookings.status, "cancelled")));
    await tx.insert(creditLedger).values({
      packageId: oldBk.packageId,
      delta: refundCost,
      actorUserId: input.userId,
      bookingId: oldBk.id,
      reason: "cancel_refund",
    });

    // 5b) Insert the NEW booking + its −newCost ledger row.
    const [newBk] = await tx
      .insert(bookings)
      .values({
        classInstanceId: newCls.id,
        userId: input.userId,
        packageId: newPkg.id,
        position: input.position as ReformerPosition | undefined,
        creditCost: newCost,
        freeCancelHours,
        status: "booked",
      })
      .returning({ id: bookings.id });
    await tx.insert(creditLedger).values({
      packageId: newPkg.id,
      delta: -newCost,
      actorUserId: input.userId,
      bookingId: newBk!.id,
      reason: "booking",
    });

    // 6) Reconcile the cached balances from the ledger deltas just written. When
    //    both legs hit the SAME package the net is (refund − newCost) on one row;
    //    otherwise each package moves independently. Either way hours_left ends
    //    equal to its prior value + Σ(its deltas), so the cache never drifts.
    if (samePackage) {
      await tx
        .update(packages)
        .set({ hoursLeft: newPkg.hoursLeft + refundCost - newCost })
        .where(eq(packages.id, newPkg.id));
    } else {
      if (oldPkg) {
        await tx
          .update(packages)
          .set({ hoursLeft: oldPkg.hoursLeft + refundCost })
          .where(eq(packages.id, oldPkg.id));
      }
      await tx
        .update(packages)
        .set({ hoursLeft: newPkg.hoursLeft - newCost })
        .where(eq(packages.id, newPkg.id));
    }

    // Report the NEW package's resulting balance (what the booking debited from).
    const reportedHoursLeft = samePackage
      ? newPkg.hoursLeft + refundCost - newCost
      : newPkg.hoursLeft - newCost;

    return {
      ok: true,
      newBookingId: newBk!.id,
      hoursLeft: reportedHoursLeft,
      freeCancelHours,
    } as const;
    });
  } catch (err) {
    // Same backstop as the booking path: a 23505 on the NEW booking's unique index
    // → the friendly seat-taken code, never a raw violation (audit LOW-1).
    const code = uniqueViolationCode(err);
    if (code) return { ok: false, code };
    throw err;
  }
}

/**
 * Cancel a live booking. Within the free window (handled by the caller/policy),
 * `refund` returns the *exact credits debited for this booking* (`creditCost`)
 * as a +creditCost ledger row and restores the cached balance by the same amount
 * — never a hardcoded 1 (CLAUDE.md §5 inv 7). Both the status flip and the
 * optional refund happen atomically.
 */
export async function cancelBooking(
  params: {
    bookingId: string;
    actorUserId: string;
    refund: boolean;
    /** Optional audit note stored on the refund ledger row (e.g. "class cancelled by studio"). */
    note?: string;
  },
): Promise<{ ok: true; refunded: boolean } | { ok: false; code: "NOT_FOUND" | "NOT_LIVE" }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [bk] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, params.bookingId))
      .for("update");

    if (!bk) return { ok: false, code: "NOT_FOUND" } as const;
    if (bk.status !== "booked") return { ok: false, code: "NOT_LIVE" } as const;

    await tx
      .update(bookings)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(and(eq(bookings.id, bk.id), ne(bookings.status, "cancelled")));

    if (params.refund) {
      const [pkg] = await tx
        .select()
        .from(packages)
        .where(eq(packages.id, bk.packageId))
        .for("update");
      if (pkg) {
        // Refund the exact amount this booking debited — not a hardcoded 1.
        const refundCost = bk.creditCost;
        await tx.insert(creditLedger).values({
          packageId: pkg.id,
          delta: refundCost,
          actorUserId: params.actorUserId,
          bookingId: bk.id,
          reason: "cancel_refund",
          note: params.note ?? null,
        });
        await tx
          .update(packages)
          .set({ hoursLeft: pkg.hoursLeft + refundCost })
          .where(eq(packages.id, pkg.id));
      }
    }

    return { ok: true, refunded: params.refund } as const;
  });
}
