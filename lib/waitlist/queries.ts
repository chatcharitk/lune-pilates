// Waitlist read model + the seat-offer / sweep mechanics (CLAUDE.md §5 invariant 6).
//
// KEY SEMANTICS — "first to confirm wins" (decided 2026-06-19): the 30-minute
// offer is a FIFO *notification head-start*, NOT a seat reservation. So nothing in
// this module touches occupancy/capacity — the freed seat stays openly bookable
// and a confirm simply runs the normal atomic booking (and may lose to a walk-up).
// A waitlist row never books a seat by itself; the booking happens only on confirm.
//
// Two kinds of "expiry" exist and must agree:
//   - PERSISTED expiry: `sweepWaitlist` flips `offered` rows past `holdExpiresAt`
//     to `expired` and cascades the offer to the next head.
//   - LAZY expiry: a read helper (`effectiveWaitlistStatus`) treats an `offered`
//     row already past `holdExpiresAt` as effectively `expired`, so the read model
//     never shows a stale live offer between sweeps. The sweep is the source of
//     truth that actually persists the flip + emits the cascade.

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { classInstances, instructors, waitlist } from "@/lib/db/schema";
import type { ClassType, WaitlistStatus } from "@/lib/domain/types";
import { WAITLIST_HOLD_MINUTES } from "@/lib/domain/types";
import type { SessionUser } from "@/lib/auth/session";
import { emit } from "@/lib/events/bus";
import { registerNotificationHandlers } from "@/lib/events/notifications";
import { mockDataMode } from "@/lib/mock-mode";
import {
  instructorMetaFor,
  metaFor,
  type ClassTypeMeta,
  type InstructorMeta,
} from "@/lib/schedule/queries";

// ───────────────────────── contract (frontend imports these) ─────────────────────────

/** One row in the customer's "My Waitlist" section. */
export interface MyWaitlistEntry {
  waitlistId: string;
  classInstanceId: string;
  type: ClassType;
  typeMeta: ClassTypeMeta;
  startsAt: string; // ISO 8601
  durationMin: number;
  instructor: InstructorMeta | null;
  /** FIFO position in the queue at join time (1-based, max+1 per class). */
  position: number;
  /**
   * Effective status — LAZILY expired: an `offered` row already past its hold is
   * surfaced as `expired` even before the sweep persists the flip, so the UI never
   * shows a live offer the customer can no longer claim.
   */
  status: WaitlistStatus;
  /** Hold deadline for an active offer (ISO), else null. Drives the countdown. */
  holdExpiresAt: string | null;
}

// ───────────────────────── pure shaping helpers (unit tested) ─────────────────────────

/**
 * The status a viewer should SEE for a waitlist row at `now`, applying lazy
 * expiry: an `offered` row whose hold has already elapsed reads as `expired`.
 * Pure — the single place the lazy-expiry rule lives, shared by the read model
 * and (implicitly) by what the sweep persists.
 */
export function effectiveWaitlistStatus(
  status: WaitlistStatus,
  holdExpiresAt: Date | null,
  now: Date,
): WaitlistStatus {
  if (status !== "offered") return status;
  // Fail closed (matches confirmWaitlistOffer): an offered row with no hold, or one
  // whose hold has already elapsed, is no longer a live offer the customer can claim.
  if (holdExpiresAt === null || holdExpiresAt.getTime() <= now.getTime()) {
    return "expired";
  }
  return "offered";
}

/** Fields needed to shape one `MyWaitlistEntry`, independent of the data source. */
export interface WaitlistRow {
  waitlistId: string;
  classInstanceId: string;
  type: ClassType;
  startsAt: Date;
  durationMin: number;
  instructorId: string | null;
  instructorName: string | null;
  instructorNameTh: string | null;
  instructorTag: string | null;
  position: number;
  status: WaitlistStatus;
  holdExpiresAt: Date | null;
}

/**
 * Shape a raw waitlist row into the `MyWaitlistEntry` contract, applying lazy
 * expiry to the status so a stale `offered` row reads as `expired`. Pure (no I/O)
 * so it is unit testable and shared by every read path. The hold deadline is
 * surfaced only while the offer is still effectively live.
 */
export function toMyWaitlistEntry(row: WaitlistRow, now: Date): MyWaitlistEntry {
  const status = effectiveWaitlistStatus(row.status, row.holdExpiresAt, now);
  return {
    waitlistId: row.waitlistId,
    classInstanceId: row.classInstanceId,
    type: row.type,
    typeMeta: metaFor(row.type),
    startsAt: row.startsAt.toISOString(),
    durationMin: row.durationMin,
    instructor: instructorMetaFor(
      row.instructorId,
      row.instructorName ?? undefined,
      row.instructorNameTh ?? undefined,
      row.instructorTag,
    ),
    position: row.position,
    // A live offer carries its hold deadline (countdown); once effectively expired
    // it is dropped so the UI never counts down a dead offer.
    holdExpiresAt: status === "offered" && row.holdExpiresAt ? row.holdExpiresAt.toISOString() : null,
    status,
  };
}

// ───────────────────────── offer the next head of a class's queue ─────────────────────────

/** The waitlist row an offer landed on (for the caller + tests). */
export interface OfferedSeat {
  waitlistId: string;
  userId: string;
  classInstanceId: string;
  position: number;
  holdExpiresAt: Date;
}

/**
 * Offer a freed seat in `classInstanceId` to the FIFO head of that class's queue.
 *
 * Finds the earliest `waiting` row (lowest position, then earliest created), flips
 * it to `offered` with `offeredAt = now` and `holdExpiresAt = now + 30min`, and
 * emits `waitlist.offered`. Returns the offered row, or null when the queue is
 * empty.
 *
 * IDEMPOTENT PER FREED SEAT: it offers only to a `waiting` head and skips anyone
 * already `offered`, so a freed seat that has already been offered will not double-
 * offer. It does NOT reserve the seat (first-to-confirm-wins) — occupancy is
 * untouched; this only grants the notification head-start.
 *
 * The flip is done under a transaction with `FOR UPDATE` so two concurrent
 * seat-frees can't both pick the same head.
 */
export async function offerNextWaitlistSeat(
  classInstanceId: string,
  now: Date = new Date(),
): Promise<OfferedSeat | null> {
  const db = getDb();
  const holdExpiresAt = new Date(now.getTime() + WAITLIST_HOLD_MINUTES * 60_000);

  const offered = await db.transaction(async (tx) => {
    // Lock the FIFO head among rows still `waiting` for this class. Ordering by
    // position then created_at then id gives a deterministic, stable head.
    const [head] = await tx
      .select({ id: waitlist.id, userId: waitlist.userId, position: waitlist.position })
      .from(waitlist)
      .where(and(eq(waitlist.classInstanceId, classInstanceId), eq(waitlist.status, "waiting")))
      .orderBy(asc(waitlist.position), asc(waitlist.createdAt), asc(waitlist.id))
      .limit(1)
      .for("update");

    if (!head) return null;

    await tx
      .update(waitlist)
      .set({ status: "offered", offeredAt: now, holdExpiresAt })
      // Re-assert `waiting` in the predicate so a concurrent flip can't be clobbered.
      .where(and(eq(waitlist.id, head.id), eq(waitlist.status, "waiting")));

    return {
      waitlistId: head.id,
      userId: head.userId,
      classInstanceId,
      position: head.position,
      holdExpiresAt,
    } satisfies OfferedSeat;
  });

  if (!offered) return null;

  // CRM is a thin listener on the domain event — attach handlers, then emit. A
  // failing handler never breaks the offer (best-effort bus).
  registerNotificationHandlers();
  await emit({
    type: "waitlist.offered",
    waitlistId: offered.waitlistId,
    userId: offered.userId,
    holdExpiresAt: offered.holdExpiresAt.toISOString(),
  });

  return offered;
}

// ───────────────────────── sweep expired holds → cascade ─────────────────────────

export interface SweepSummary {
  /** Number of `offered` rows whose hold elapsed and were flipped to `expired`. */
  expired: number;
  /** Distinct classes that had a hold expire (and so were re-offered). */
  classesAffected: number;
  /** Number of those re-offers that found a next head to notify. */
  cascaded: number;
}

/**
 * Expire every `offered` hold past its deadline and cascade the freed offer to the
 * next head of each affected class's queue.
 *
 * 1) Flip all `offered` rows with `holdExpiresAt <= now` to `expired` in one
 *    statement (idempotent: a row already not-`offered` is untouched).
 * 2) For each DISTINCT affected class, call `offerNextWaitlistSeat` so the next
 *    `waiting` head is offered + notified.
 *
 * Returns a small summary for the cron route to log. Occupancy is never touched.
 */
export async function sweepWaitlist(now: Date = new Date()): Promise<SweepSummary> {
  const db = getDb();

  // 1) Persist the expiry flip and learn which classes were affected.
  const expiredRows = await db
    .update(waitlist)
    .set({ status: "expired" })
    .where(and(eq(waitlist.status, "offered"), sql`${waitlist.holdExpiresAt} <= ${now}`))
    .returning({ classInstanceId: waitlist.classInstanceId });

  const affectedClassIds = [...new Set(expiredRows.map((r) => r.classInstanceId))];

  // 2) Cascade: offer each affected class's next head (best-effort per class — one
  //    failure must not abort the rest of the sweep).
  let cascaded = 0;
  for (const classInstanceId of affectedClassIds) {
    try {
      const next = await offerNextWaitlistSeat(classInstanceId, now);
      if (next) cascaded += 1;
    } catch (err) {
      console.error(`[waitlist] cascade offer failed for class ${classInstanceId}:`, err);
    }
  }

  return {
    expired: expiredRows.length,
    classesAffected: affectedClassIds.length,
    cascaded,
  };
}

// ───────────────────────── read model: the viewer's waitlist ─────────────────────────

/**
 * The viewer's OWN waitlist entries that are still relevant: `waiting` and
 * `offered` rows (offers are lazily expired in the shaping). `claimed`/`expired`
 * rows are dropped — a claimed entry has become a booking (surfaced by the
 * bookings read model) and an expired one is dead. Sorted soonest class first.
 *
 * Lazy expiry: an `offered` row past its hold is returned with status `expired`
 * (and no `holdExpiresAt`) rather than hidden, so the UI can briefly show "offer
 * expired" without trusting any client clock. Only `bookings.userId`-equivalent
 * rows (the viewer's own) are returned.
 */
export async function listMyWaitlist(
  viewer: SessionUser,
  now: Date = new Date(),
): Promise<MyWaitlistEntry[]> {
  // No-DB dev fallback (mirrors getNextBooking / getCreditOverview): the mock
  // session user holds no waitlist entries, so render the screen without a
  // database. The DB path below is the real one, gated behind the env.
  if (mockDataMode()) {
    return [];
  }

  const db = getDb();

  const rows = await db
    .select({
      waitlistId: waitlist.id,
      classInstanceId: waitlist.classInstanceId,
      type: classInstances.type,
      startsAt: classInstances.startsAt,
      durationMin: classInstances.durationMin,
      instructorId: classInstances.instructorId,
      instructorName: instructors.name,
      instructorNameTh: instructors.nameTh,
      instructorTag: instructors.tag,
      position: waitlist.position,
      status: waitlist.status,
      holdExpiresAt: waitlist.holdExpiresAt,
    })
    .from(waitlist)
    .innerJoin(classInstances, eq(waitlist.classInstanceId, classInstances.id))
    .leftJoin(instructors, eq(classInstances.instructorId, instructors.id))
    .where(
      and(
        eq(waitlist.userId, viewer.id),
        // Persisted live states only; lazy expiry then downgrades stale offers.
        inArray(waitlist.status, ["waiting", "offered"]),
      ),
    )
    .orderBy(asc(classInstances.startsAt), asc(waitlist.position), asc(waitlist.id));

  return rows.map((r) => toMyWaitlistEntry(r, now));
}
