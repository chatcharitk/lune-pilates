// DB-backed integration tests for the money-critical CANCELLATION, RESCHEDULE and
// WAITLIST-CONFIRM paths on the REAL customer actions (audit LOW-2). The no-DB unit
// suite can pin the pure policy/cost helpers, but the all-or-nothing refund/debit
// ledger math and the "first to confirm wins" race only hold because of real
// interactive transactions — provable only against a live Postgres.
//
// Coverage:
//   1. FREE cancel refunds the EXACT booked cost (a 1.5 Private → a +1.5 ledger row,
//      never a hardcoded 1); the cached balance returns to its starting value.
//   2. LATE cancel (inside the window) keeps the cost — NO refund ledger row, balance
//      stays debited.
//   3. RESCHEDULE net-zero on a same-cost type: refund(old) + debit(new) sum to 0,
//      the pool balance is unchanged, and it is ONE atomic move (old cancelled, new
//      live, exactly one +cost and one −cost ledger row for the move).
//   4. WAITLIST confirm-race: two offered heads confirm the same single freed seat →
//      exactly one books, the other gets OFFER_LOST (CLAUDE.md §5 inv 6).
//
// The identity provider is mocked exactly as in booking-debit.integration.test.ts: a
// FIFO session queue hands each action call a distinct seeded user, deterministic
// regardless of interleaving (each action calls getCurrentUser exactly once at start).
//
// Gated on DATABASE_URL (loaded by setup-env.ts); the whole block skips when unset so
// the default no-DB `npm test` stays green. All fixtures share a per-run tag and are
// torn down in afterAll, so it is safe to point at the shared dev DB.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, like, sql } from "drizzle-orm";

import type { SessionUser } from "@/lib/auth/session";

// ── Mock the identity provider only (same pattern as booking-debit) ──────────────
const sessionQueue: SessionUser[] = [];
function enqueueSession(...sessionUsers: SessionUser[]): void {
  sessionQueue.push(...sessionUsers);
}
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async (): Promise<SessionUser> => {
    const u = sessionQueue.shift();
    if (!u) throw new Error("test session queue empty — enqueueSession() before the action");
    return u;
  },
}));

import { getDb, closeDb } from "@/lib/db/client";
import {
  bookings,
  classInstances,
  creditLedger,
  households,
  packages,
  users,
  waitlist,
} from "@/lib/db/schema";
import {
  bookClass,
  cancelBookingAction,
  rescheduleBooking,
} from "@/app/actions/booking";
import { confirmWaitlistOffer, joinWaitlist } from "@/app/actions/waitlist";
import { offerNextWaitlistSeat } from "@/lib/waitlist/queries";
import { creditCostForClassType } from "@/lib/credits/cost";
import type { ClassType, PackageCategory } from "@/lib/domain/types";

const HAS_DB = !!process.env.DATABASE_URL;
const PRIVATE_COST = creditCostForClassType("private"); // 1.5
const GROUP_COST = creditCostForClassType("group"); // 1.0

const future = (h: number) => new Date(Date.now() + h * 3_600_000);

describe.skipIf(!HAS_DB)(
  "cancel / reschedule / waitlist-confirm money paths (integration · requires DATABASE_URL)",
  () => {
    const run = `bp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const classIds: string[] = [];

    /**
     * Isolated household with `memberCount` members and one package of the given
     * category. Returns the members (session users) and the package id.
     */
    async function makeHousehold(
      label: string,
      memberCount: number,
      category: PackageCategory,
      hoursLeft: number,
      expiresAt = future(720),
    ): Promise<{ members: SessionUser[]; packageId: string }> {
      const db = getDb();
      const houseNumber = `${run}-${label}`;
      const [h] = await db.insert(households).values({ houseNumber }).returning({ id: households.id });

      const members: SessionUser[] = [];
      for (let i = 0; i < memberCount; i++) {
        const [u] = await db
          .insert(users)
          .values({ phone: `${houseNumber}-${i}`, name: `${houseNumber}-${i}`, tier: "member", householdId: h!.id })
          .returning({ id: users.id });
        members.push({ id: u!.id, name: `${houseNumber}-${i}`, tier: "member", householdId: h!.id, houseNumber });
      }

      const [p] = await db
        .insert(packages)
        .values({ type: "pkg", category, hoursTotal: hoursLeft, hoursLeft, expiresAt, ownerHouseholdId: h!.id })
        .returning({ id: packages.id });

      return { members, packageId: p!.id };
    }

    /** Seed a published class of `type` with `capacity` seats starting `hoursAhead` from now. */
    async function makeClass(type: ClassType, capacity: number, hoursAhead: number): Promise<string> {
      const db = getDb();
      const [c] = await db
        .insert(classInstances)
        .values({
          startsAt: future(hoursAhead),
          durationMin: 60,
          type,
          capacity,
          status: "published",
          publishedAt: new Date(),
          membersVisibleAt: new Date(),
          publicVisibleAt: new Date(Date.now() - 3_600_000), // open to all (irrelevant to members)
        })
        .returning({ id: classInstances.id });
      classIds.push(c!.id);
      return c!.id;
    }

    async function hoursLeftOf(packageId: string): Promise<number> {
      const [p] = await getDb()
        .select({ hoursLeft: packages.hoursLeft })
        .from(packages)
        .where(eq(packages.id, packageId));
      return p!.hoursLeft;
    }

    async function ledgerSum(packageId: string): Promise<number> {
      const [row] = await getDb()
        .select({ total: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::float8` })
        .from(creditLedger)
        .where(eq(creditLedger.packageId, packageId));
      return row?.total ?? 0;
    }

    const ledgerByReason = (packageId: string, reason: string) =>
      getDb()
        .select()
        .from(creditLedger)
        .where(and(eq(creditLedger.packageId, packageId), eq(creditLedger.reason, reason)));

    const liveBookingsFor = (classInstanceId: string) =>
      getDb()
        .select()
        .from(bookings)
        .where(and(eq(bookings.classInstanceId, classInstanceId), eq(bookings.status, "booked")));

    beforeAll(() => {
      sessionQueue.length = 0;
    });

    afterAll(async () => {
      try {
        const db = getDb();
        const houses = await db
          .select({ id: households.id })
          .from(households)
          .where(like(households.houseNumber, `${run}-%`));
        const houseIds = houses.map((h) => h.id);

        if (classIds.length) {
          await db.delete(waitlist).where(inArray(waitlist.classInstanceId, classIds));
          await db.delete(bookings).where(inArray(bookings.classInstanceId, classIds));
        }
        if (houseIds.length) {
          const pkgs = await db
            .select({ id: packages.id })
            .from(packages)
            .where(inArray(packages.ownerHouseholdId, houseIds));
          const pkgIds = pkgs.map((p) => p.id);
          if (pkgIds.length) {
            await db.delete(creditLedger).where(inArray(creditLedger.packageId, pkgIds));
            await db.delete(packages).where(inArray(packages.id, pkgIds));
          }
        }
        if (classIds.length) {
          await db.delete(classInstances).where(inArray(classInstances.id, classIds));
        }
        if (houseIds.length) {
          await db.delete(users).where(inArray(users.householdId, houseIds));
          await db.delete(households).where(inArray(households.id, houseIds));
        }
      } finally {
        await closeDb();
      }
    });

    // ───────────── 1. FREE cancel refunds the EXACT cost (a 1.5 Private) ─────────────

    it("FREE cancel of a 1.5 Private refunds EXACTLY 1.5 (a +1.5 ledger row, not 1)", async () => {
      const POOL = 5;
      const { members, packageId } = await makeHousehold("free-cancel", 1, "private", POOL);
      // 48h ahead ⇒ booked ≥5h ⇒ free window = 5h; cancelling now (≈48h out) is free.
      const classId = await makeClass("private", 1, 48);

      enqueueSession(members[0]!);
      const booked = await bookClass({ classInstanceId: classId });
      expect(booked.ok).toBe(true);
      if (!booked.ok) return;
      expect(await hoursLeftOf(packageId)).toBe(POOL - PRIVATE_COST);

      enqueueSession(members[0]!);
      const cancelled = await cancelBookingAction({ bookingId: booked.bookingId });
      expect(cancelled.ok).toBe(true);
      if (!cancelled.ok) return;
      expect(cancelled.outcome.free).toBe(true);
      expect(cancelled.outcome.refunded).toBe(true);

      // The refund ledger row is EXACTLY +1.5 (the booked cost), never a hardcoded 1.
      const refunds = await ledgerByReason(packageId, "cancel_refund");
      expect(refunds).toHaveLength(1);
      expect(refunds[0]!.delta).toBe(PRIVATE_COST);

      // Balance restored to the start; ledger nets to 0 (−1.5 then +1.5).
      expect(await hoursLeftOf(packageId)).toBe(POOL);
      expect(await ledgerSum(packageId)).toBe(0);
      expect(await liveBookingsFor(classId)).toHaveLength(0);
    });

    // ───────────── 2. LATE cancel keeps the cost (no refund row) ─────────────

    it("LATE cancel (inside the window) keeps the cost — no refund row, balance stays debited", async () => {
      const POOL = 5;
      const { members, packageId } = await makeHousehold("late-cancel", 1, "private", POOL);
      // 0.5h ahead ⇒ booked <5h ⇒ last-minute window = 1h, and 0.5h < 1h ⇒ we are
      // INSIDE the window now ⇒ a late cancel that KEEPS the cost (no refund).
      const classId = await makeClass("private", 1, 0.5);

      enqueueSession(members[0]!);
      const booked = await bookClass({ classInstanceId: classId });
      expect(booked.ok).toBe(true);
      if (!booked.ok) return;
      expect(booked.freeCancelHours).toBe(1); // last-minute window
      expect(await hoursLeftOf(packageId)).toBe(POOL - PRIVATE_COST);

      enqueueSession(members[0]!);
      const cancelled = await cancelBookingAction({ bookingId: booked.bookingId });
      expect(cancelled.ok).toBe(true);
      if (!cancelled.ok) return;
      expect(cancelled.outcome.free).toBe(false);
      expect(cancelled.outcome.refunded).toBe(false);

      // No refund row; balance stays debited; ledger nets to −1.5.
      expect(await ledgerByReason(packageId, "cancel_refund")).toHaveLength(0);
      expect(await hoursLeftOf(packageId)).toBe(POOL - PRIVATE_COST);
      expect(await ledgerSum(packageId)).toBe(-PRIVATE_COST);
      expect(await liveBookingsFor(classId)).toHaveLength(0);
    });

    // ───────────── 3. RESCHEDULE net-zero on a same-cost type ─────────────

    it("RESCHEDULE Private→Private is net-zero: balance unchanged, old cancelled, new live", async () => {
      const POOL = 5;
      const { members, packageId } = await makeHousehold("resched", 1, "private", POOL);
      const oldClass = await makeClass("private", 1, 48); // free window open
      const newClass = await makeClass("private", 1, 72);

      enqueueSession(members[0]!);
      const booked = await bookClass({ classInstanceId: oldClass });
      expect(booked.ok).toBe(true);
      if (!booked.ok) return;
      const afterBook = await hoursLeftOf(packageId);
      expect(afterBook).toBe(POOL - PRIVATE_COST);

      enqueueSession(members[0]!);
      const res = await rescheduleBooking({
        bookingId: booked.bookingId,
        newClassInstanceId: newClass,
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      // Net-zero: the pool balance equals the post-original-booking balance (refund
      // of 1.5 then debit of 1.5 cancel out).
      expect(await hoursLeftOf(packageId)).toBe(afterBook);
      // Ledger over the whole life: −1.5 (book) +1.5 (refund) −1.5 (new) = −1.5.
      expect(await ledgerSum(packageId)).toBe(-PRIVATE_COST);
      // Exactly one move refund (+1.5) and two booking debits (−1.5 each) total.
      expect(await ledgerByReason(packageId, "cancel_refund")).toHaveLength(1);
      expect(await ledgerByReason(packageId, "booking")).toHaveLength(2);

      // Old seat freed, new seat held — the move is one atomic swap.
      expect(await liveBookingsFor(oldClass)).toHaveLength(0);
      const newLive = await liveBookingsFor(newClass);
      expect(newLive).toHaveLength(1);
      expect(newLive[0]!.id).toBe(res.newBookingId);
    });

    // ───────────── 4. WAITLIST confirm-race: first to confirm wins ─────────────

    it("WAITLIST race: two offered heads confirm one freed seat → exactly one books, other OFFER_LOST", async () => {
      // Capacity 1. A holder books the only seat; two other members waitlist it.
      const { members: holderM, packageId: holderPkg } = await makeHousehold("wl-holder", 1, "group", 5);
      const classId = await makeClass("group", 1, 48);
      void holderPkg;

      enqueueSession(holderM[0]!);
      const held = await bookClass({ classInstanceId: classId });
      expect(held.ok).toBe(true);
      if (!held.ok) return;

      // Two waitlisters, each with their own pool + plenty of credit.
      const { members: m1, packageId: pkg1 } = await makeHousehold("wl-a", 1, "group", 5);
      const { members: m2, packageId: pkg2 } = await makeHousehold("wl-b", 1, "group", 5);
      const waiterA = m1[0]!;
      const waiterB = m2[0]!;

      enqueueSession(waiterA);
      const joinA = await joinWaitlist({ classInstanceId: classId });
      expect(joinA.ok).toBe(true);
      enqueueSession(waiterB);
      const joinB = await joinWaitlist({ classInstanceId: classId });
      expect(joinB.ok).toBe(true);
      if (!joinA.ok || !joinB.ok) return;

      // The holder cancels → frees the one seat. (Cancel offers the head, but we
      // then force BOTH rows to `offered` so they genuinely race the same seat.)
      enqueueSession(holderM[0]!);
      const cancelled = await cancelBookingAction({ bookingId: held.bookingId });
      expect(cancelled.ok).toBe(true);

      // Make sure BOTH waitlist rows are `offered` with a live hold so both can
      // attempt confirm. offerNextWaitlistSeat only offers the head; force the rest.
      const db = getDb();
      await db
        .update(waitlist)
        .set({ status: "offered", offeredAt: new Date(), holdExpiresAt: future(0.5) })
        .where(and(eq(waitlist.classInstanceId, classId), inArray(waitlist.status, ["waiting", "offered"])));

      // Both confirm the SAME single freed seat concurrently.
      enqueueSession(waiterA, waiterB);
      const [rA, rB] = await Promise.allSettled([
        confirmWaitlistOffer({ waitlistId: joinA.waitlistId }),
        confirmWaitlistOffer({ waitlistId: joinB.waitlistId }),
      ]);
      expect(rA.status).toBe("fulfilled");
      expect(rB.status).toBe("fulfilled");
      if (rA.status !== "fulfilled" || rB.status !== "fulfilled") return;
      const results = [rA.value, rB.value];

      // Exactly ONE confirm wins the single seat; the other gets OFFER_LOST.
      const wins = results.filter((r) => r.ok);
      const losses = results.filter((r) => !r.ok);
      expect(wins).toHaveLength(1);
      expect(losses).toHaveLength(1);
      expect(losses[0]!.ok).toBe(false);
      if (!losses[0]!.ok) {
        expect(losses[0]!.code).toBe("OFFER_LOST");
      }

      // Exactly one live booking holds the seat; exactly one waitlister was debited.
      expect(await liveBookingsFor(classId)).toHaveLength(1);
      const debitedA = (await ledgerByReason(pkg1, "booking")).length;
      const debitedB = (await ledgerByReason(pkg2, "booking")).length;
      expect(debitedA + debitedB).toBe(1); // the winner debited once, the loser not at all.
    });
  },
);
