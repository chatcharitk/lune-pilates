// DB-backed integration tests for the money-critical ATOMIC CREDIT DEBIT
// (CLAUDE.md §5 invariant 1) on the REAL customer booking path — the public
// `bookClass` server action, not just the inner transaction.
//
// Why this exists: the no-DB unit suite can only pin the cost mapping and the
// guard logic; the actual "exactly-once, all-or-nothing, concurrency-safe" debit
// only holds because of a real interactive transaction (SELECT … FOR UPDATE on
// the class row and the package row, then INSERT booking + INSERT −cost ledger +
// UPDATE hours_left, committed together). That can only be proven against a real
// Postgres under genuine concurrency. This suite fires two `bookClass` calls at
// the SAME last seat / shared pool and asserts:
//
//   1. NO DOUBLE-DEBIT UNDER RACE — exactly one of two concurrent bookings for
//      the last seat succeeds; the other fails CLASS_FULL. Exactly one −cost
//      booking-ledger row, hours_left dropped by exactly one cost, exactly one
//      live booking. No booking-without-debit, no debit-without-booking.
//   2. LEDGER RECONCILES WITH THE CACHE — hours_left == initial + Σ(ledger deltas)
//      (the cache equals the append-only ledger truth) after the race.
//   3. INSUFFICIENT BALANCE IS ATOMIC — balance < cost → fails, and NO ledger row
//      and NO booking are written (clean rollback / fail-closed).
//   4. EXPIRED PACKAGE — expires_at <= now → booking rejected, no debit, no booking.
//
// The action resolves identity via getCurrentUser(); we mock @/lib/auth/session
// so each concurrent call draws a distinct (seeded) household member from a FIFO
// queue — deterministic regardless of interleaving (getCurrentUser is invoked
// exactly once per bookClass, at its start). Everything money-critical
// (package selection, the price, the debit) is still resolved server-side by the
// real action code under test; only the identity provider is mocked, exactly as
// LINE LIFF is mocked in v1 (CLAUDE.md §2).
//
// Pool isolation: each scenario gets its OWN throwaway household so its package(s)
// are the only thing in that pool — otherwise a leftover usable package from an
// earlier test would be (correctly) selected by the soonest-expiring, cost-aware
// `selectUsablePackage`, masking the short/expired-pool cases. All fixtures share
// a per-run tag prefix and are torn down in afterAll, so it is safe to point at
// the shared dev DB.
//
// Gated: requires DATABASE_URL (loaded from .env by setup-env.ts). When unset the
// whole block skips (describe.skipIf), so the default no-DB `npm test` stays green.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, like, sql } from "drizzle-orm";

import type { SessionUser } from "@/lib/auth/session";

// ── Mock the identity provider only ──────────────────────────────────────────
// The booking action calls getCurrentUser() (no args) once at its start. We hand
// it identities from a test-controlled FIFO queue so two concurrently-launched
// bookClass calls each get a DISTINCT seeded household member, deterministically,
// no matter how their promises interleave. The real package selection, price, and
// atomic debit all still run against the real DB — that is what is under test.
const sessionQueue: SessionUser[] = [];
function enqueueSession(...sessionUsers: SessionUser[]): void {
  sessionQueue.push(...sessionUsers);
}
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async (): Promise<SessionUser> => {
    const u = sessionQueue.shift();
    if (!u) throw new Error("test session queue empty — enqueueSession() before bookClass()");
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
import { bookClass } from "@/app/actions/booking";
import { joinWaitlist } from "@/app/actions/waitlist";
import { creditCostForClassType } from "@/lib/credits/cost";

const HAS_DB = !!process.env.DATABASE_URL;
const GROUP_COST = creditCostForClassType("group"); // 1 — the cost the code uses

const future = (h: number) => new Date(Date.now() + h * 3_600_000);
const past = (h: number) => new Date(Date.now() - h * 3_600_000);

describe.skipIf(!HAS_DB)(
  "atomic credit debit on the bookClass path (integration · requires DATABASE_URL)",
  () => {
    // A per-run prefix scopes every fixture this file creates so teardown is a
    // clean cascade and parallel runs / seed data never collide.
    const run = `bd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    // Class instances created across all tests (not pool-scoped) — tracked for teardown.
    const classIds: string[] = [];
    // Guests own their packages by user_id (no household), so they aren't caught by
    // the household-scoped teardown — track them explicitly for an extra cleanup pass.
    const guestUserIds: string[] = [];
    const guestPackageIds: string[] = [];

    /**
     * Create an ISOLATED household with `memberCount` members and one seeded
     * group package. Returns the members (as session users) and the package id.
     * Each scenario calls this so its pool holds exactly the package under test.
     */
    async function makeHousehold(
      label: string,
      memberCount: number,
      hoursLeft: number,
      expiresAt = future(720),
    ): Promise<{ members: SessionUser[]; packageId: string }> {
      const db = getDb();
      const houseNumber = `${run}-${label}`;
      const [h] = await db
        .insert(households)
        .values({ houseNumber })
        .returning({ id: households.id });

      const members: SessionUser[] = [];
      for (let i = 0; i < memberCount; i++) {
        const [u] = await db
          .insert(users)
          .values({
            phone: `${houseNumber}-${i}`,
            name: `${houseNumber}-${i}`,
            tier: "member",
            householdId: h!.id,
          })
          .returning({ id: users.id });
        members.push({
          id: u!.id,
          name: `${houseNumber}-${i}`,
          tier: "member",
          householdId: h!.id,
          houseNumber,
        });
      }

      const [p] = await db
        .insert(packages)
        .values({
          type: "p10",
          category: "group",
          hoursTotal: hoursLeft,
          hoursLeft,
          expiresAt,
          ownerHouseholdId: h!.id,
        })
        .returning({ id: packages.id });

      return { members, packageId: p!.id };
    }

    /** Seed a published group class with `capacity` seats starting `hoursAhead` from now. */
    async function makeGroupClass(capacity: number, hoursAhead = 48): Promise<string> {
      const db = getDb();
      const [c] = await db
        .insert(classInstances)
        .values({
          startsAt: future(hoursAhead),
          durationMin: 60,
          type: "group",
          capacity,
          status: "published",
          publishedAt: new Date(),
        })
        .returning({ id: classInstances.id });
      classIds.push(c!.id);
      return c!.id;
    }

    /**
     * Seed a published group class whose `publicVisibleAt` is in the FUTURE — i.e.
     * still inside its members-only window: a member may book/waitlist it, a guest
     * may not (CLAUDE.md §5 invariant 4). `publishedAt`/`membersVisibleAt` are now.
     */
    async function makeMembersOnlyGroupClass(capacity: number, hoursAhead = 48): Promise<string> {
      const db = getDb();
      const [c] = await db
        .insert(classInstances)
        .values({
          startsAt: future(hoursAhead),
          durationMin: 60,
          type: "group",
          capacity,
          status: "published",
          publishedAt: new Date(),
          membersVisibleAt: new Date(),
          // public window opens only 1h before start (far in the future for a 48h
          // class) → guests can't see it yet, members can.
          publicVisibleAt: future(hoursAhead - 1),
        })
        .returning({ id: classInstances.id });
      classIds.push(c!.id);
      return c!.id;
    }

    /**
     * Create an ISOLATED guest with one own (user_id-owned) group package. Guests
     * never join a household, so the package owner is the user (CLAUDE.md §5 inv 3).
     */
    async function makeGuest(
      label: string,
      hoursLeft: number,
      expiresAt = future(720),
    ): Promise<SessionUser> {
      const db = getDb();
      const phone = `${run}-guest-${label}`;
      const [u] = await db
        .insert(users)
        .values({ phone, name: phone, tier: "guest" })
        .returning({ id: users.id });
      guestUserIds.push(u!.id);
      const [p] = await db
        .insert(packages)
        .values({
          type: "p10",
          category: "group",
          hoursTotal: hoursLeft,
          hoursLeft,
          expiresAt,
          ownerUserId: u!.id,
        })
        .returning({ id: packages.id });
      guestPackageIds.push(p!.id);
      return { id: u!.id, name: phone, tier: "guest", householdId: null, houseNumber: null };
    }

    /** Booking-debit (−cost) ledger rows for a package. Expected: one per real booking. */
    const bookingLedgerFor = (packageId: string) =>
      getDb()
        .select()
        .from(creditLedger)
        .where(and(eq(creditLedger.packageId, packageId), eq(creditLedger.reason, "booking")));

    /** Sum of ALL ledger deltas for a package — the append-only source of truth. */
    async function ledgerSum(packageId: string): Promise<number> {
      const db = getDb();
      const [row] = await db
        .select({ total: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::float8` })
        .from(creditLedger)
        .where(eq(creditLedger.packageId, packageId));
      return row?.total ?? 0;
    }

    const liveBookingsFor = (classInstanceId: string) =>
      getDb()
        .select()
        .from(bookings)
        .where(and(eq(bookings.classInstanceId, classInstanceId), eq(bookings.status, "booked")));

    async function hoursLeftOf(packageId: string): Promise<number> {
      const db = getDb();
      const [p] = await db
        .select({ hoursLeft: packages.hoursLeft })
        .from(packages)
        .where(eq(packages.id, packageId));
      return p!.hoursLeft;
    }

    beforeAll(() => {
      sessionQueue.length = 0;
    });

    afterAll(async () => {
      try {
        const db = getDb();
        // Resolve every household this run created (house_number prefixed with the
        // run tag), then cascade-delete children → parents in FK-safe order.
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
        // Guest fixtures (user_id-owned packages, no household) — explicit pass.
        if (guestPackageIds.length) {
          await db.delete(creditLedger).where(inArray(creditLedger.packageId, guestPackageIds));
          await db.delete(packages).where(inArray(packages.id, guestPackageIds));
        }
        if (classIds.length) {
          await db.delete(classInstances).where(inArray(classInstances.id, classIds));
        }
        if (houseIds.length) {
          await db.delete(users).where(inArray(users.householdId, houseIds));
          await db.delete(households).where(inArray(households.id, houseIds));
        }
        if (guestUserIds.length) {
          await db.delete(users).where(inArray(users.id, guestUserIds));
        }
      } finally {
        await closeDb();
      }
    });

    // ───────────── 1 + 2. No double-debit under race; ledger reconciles ─────────────

    it("CONCURRENT last seat: exactly one books, the other gets CLASS_FULL — one debit only", async () => {
      // capacity 1 ⇒ exactly one seat. Pool has plenty of credit, so the SEAT,
      // not the balance, is the contended resource: this isolates the capacity
      // half of the atomic debit (no oversell of seats, no debit without a seat).
      const POOL = 5;
      const { members, packageId } = await makeHousehold("race", 2, POOL);
      const [memberA, memberB] = members;
      const classId = await makeGroupClass(1);

      // Two distinct members of the same household race the single seat. Both
      // draw from the same shared pool/package by server-side selection.
      enqueueSession(memberA!, memberB!);
      const [r1, r2] = await Promise.allSettled([
        bookClass({ classInstanceId: classId }),
        bookClass({ classInstanceId: classId }),
      ]);

      // Neither call should THROW — business-rule failures are typed results.
      expect(r1.status).toBe("fulfilled");
      expect(r2.status).toBe("fulfilled");
      if (r1.status !== "fulfilled" || r2.status !== "fulfilled") {
        throw new Error("bookClass rejected instead of returning a typed result");
      }
      const results = [r1.value, r2.value];

      const wins = results.filter((r) => r.ok);
      const losses = results.filter((r) => !r.ok);
      // CRITICAL invariant: NOT both succeed. If wins.length === 2 the seat was
      // oversold — a Critical double-book/double-debit bug, surfaced here, never hidden.
      expect(wins).toHaveLength(1);
      expect(losses).toHaveLength(1);
      // The loser must fail on capacity, not on some incidental error.
      expect(losses[0]!.ok).toBe(false);
      if (!losses[0]!.ok) {
        expect(losses[0]!.code).toBe("CLASS_FULL");
      }

      // Exactly ONE live booking holds the single seat.
      const live = await liveBookingsFor(classId);
      expect(live).toHaveLength(1);
      // …and it carries the exact cost the code charges (debit ↔ booking are paired).
      expect(live[0]!.creditCost).toBe(GROUP_COST);
      expect(live[0]!.packageId).toBe(packageId);

      // Exactly ONE −cost booking-ledger row (no debit without booking, no double-debit).
      const debits = await bookingLedgerFor(packageId);
      expect(debits).toHaveLength(1);
      expect(debits[0]!.delta).toBe(-GROUP_COST);
      expect(debits[0]!.bookingId).toBe(live[0]!.id);
      // …stamped with the actor who actually won the seat (booking ↔ ledger actor agree).
      expect(debits[0]!.actorUserId).toBe(live[0]!.userId);

      // hours_left dropped by EXACTLY one cost — the winner debited once, the loser not at all.
      const hoursLeft = await hoursLeftOf(packageId);
      expect(hoursLeft).toBe(POOL - GROUP_COST);

      // Invariant 2: the cached balance reconciles to the ledger truth.
      //   hours_left == initial total + Σ(deltas)   (deltas are negative debits)
      const sum = await ledgerSum(packageId);
      expect(hoursLeft).toBe(POOL + sum);
    });

    // ───────────── 3. Insufficient balance is atomic (all-or-nothing rollback) ─────────────

    it("INSUFFICIENT balance: booking fails with no ledger row and no booking written", async () => {
      // Pool holds less than one group cost ⇒ the debit guard must reject and the
      // whole transaction roll back: no booking row, no ledger row, balance unchanged.
      const SHORT = GROUP_COST - 1; // 0 < 1 — below cost, an integer balance
      const { members, packageId } = await makeHousehold("short", 1, SHORT);
      const classId = await makeGroupClass(3);

      enqueueSession(members[0]!);
      const res = await bookClass({ classInstanceId: classId });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        // The action resolves NO package that can cover the cost (cost-aware
        // selection), so it fails NO_USABLE_PACKAGE before the transaction; either
        // that or the in-transaction NO_CREDITS guard is an acceptable fail-closed.
        expect(["NO_USABLE_PACKAGE", "NO_CREDITS"]).toContain(res.code);
      }

      // All-or-nothing: NO booking, NO ledger row, balance untouched.
      expect(await liveBookingsFor(classId)).toHaveLength(0);
      expect(await bookingLedgerFor(packageId)).toHaveLength(0);
      expect(await hoursLeftOf(packageId)).toBe(SHORT);
      expect(await ledgerSum(packageId)).toBe(0);
    });

    // ───────────── 4. Expired package is rejected with no debit ─────────────

    it("EXPIRED package: booking rejected, no debit, no booking", async () => {
      // Plenty of credit, but the package already expired ⇒ must be rejected with
      // no debit. Expiry is checked both in selection and again under the lock.
      const POOL = 5;
      const { members, packageId } = await makeHousehold("expired", 1, POOL, past(1));
      const classId = await makeGroupClass(3);

      enqueueSession(members[0]!);
      const res = await bookClass({ classInstanceId: classId });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(["NO_USABLE_PACKAGE", "EXPIRED"]).toContain(res.code);
      }

      expect(await liveBookingsFor(classId)).toHaveLength(0);
      expect(await bookingLedgerFor(packageId)).toHaveLength(0);
      expect(await hoursLeftOf(packageId)).toBe(POOL); // untouched
      expect(await ledgerSum(packageId)).toBe(0);
    });

    // ───────────── 5. Tiered visibility on the WRITE path (audit CRITICAL-1) ─────────────
    // A guest who knows the classInstanceId (it's in the /schedule/[id] URL) must
    // NOT be able to book or waitlist a class still inside its members-only window
    // — the rule (CLAUDE.md §5 inv 4) must be enforced in the transaction, not only
    // in the read models. A member sees the same class and succeeds.

    it("MEMBERS-ONLY window: a GUEST is rejected by bookClass (NOT_VISIBLE), a MEMBER books", async () => {
      const classId = await makeMembersOnlyGroupClass(3);

      // Guest with plenty of own credit: only the visibility gate can stop them.
      const guest = await makeGuest("vis-book", 5);
      enqueueSession(guest);
      const guestRes = await bookClass({ classInstanceId: classId });
      expect(guestRes.ok).toBe(false);
      if (!guestRes.ok) {
        expect(guestRes.code).toBe("NOT_VISIBLE");
      }
      // No booking, no debit — the guest never got in.
      expect(await liveBookingsFor(classId)).toHaveLength(0);

      // A member of a household with credit books the SAME class fine.
      const { members, packageId } = await makeHousehold("vis-book-mem", 1, 5);
      enqueueSession(members[0]!);
      const memberRes = await bookClass({ classInstanceId: classId });
      expect(memberRes.ok).toBe(true);
      expect(await liveBookingsFor(classId)).toHaveLength(1);
      // The member's debit happened exactly once.
      expect(await bookingLedgerFor(packageId)).toHaveLength(1);
    });

    it("MEMBERS-ONLY window: a GUEST is rejected by joinWaitlist (NOT_VISIBLE) even when full", async () => {
      // Capacity 1, filled by a member, so fullness alone would otherwise allow a
      // waitlist join — but the guest is still pre-public, so NOT_VISIBLE wins.
      const classId = await makeMembersOnlyGroupClass(1);

      // Fill the single seat with a member (members can see/book it).
      const { members } = await makeHousehold("vis-wl-fill", 1, 5);
      enqueueSession(members[0]!);
      const fill = await bookClass({ classInstanceId: classId });
      expect(fill.ok).toBe(true);

      // Guest tries to waitlist the now-full members-only class → NOT_VISIBLE,
      // and crucially NO waitlist row is written.
      const guest = await makeGuest("vis-wl", 5);
      enqueueSession(guest);
      const guestRes = await joinWaitlist({ classInstanceId: classId });
      expect(guestRes.ok).toBe(false);
      if (!guestRes.ok) {
        expect(guestRes.code).toBe("NOT_VISIBLE");
      }
      const wlRows = await getDb()
        .select()
        .from(waitlist)
        .where(eq(waitlist.classInstanceId, classId));
      expect(wlRows).toHaveLength(0);

      // A second member CAN join the waitlist of the same full class (visible to them).
      const { members: members2 } = await makeHousehold("vis-wl-mem", 1, 5);
      enqueueSession(members2[0]!);
      const memberRes = await joinWaitlist({ classInstanceId: classId });
      expect(memberRes.ok).toBe(true);
      if (memberRes.ok) {
        expect(memberRes.position).toBe(1);
      }
    });

    // ───────────── 6. DB backstop: one live booking per (class,user) (audit LOW-1) ─────────────
    // The partial unique index is defense-in-depth behind the in-tx dupe check. Prove
    // the index is actually live in Neon by attempting a RAW second live booking for
    // the same (class,user) — Postgres must reject it with 23505. (The action path
    // never reaches here; the in-tx check catches it first, and the debit also maps a
    // stray 23505 to the friendly ALREADY_BOOKED code — covered by uniqueViolationCode.)

    it("DB BACKSTOP: a raw second live booking for the same (class,user) is rejected by the unique index", async () => {
      const db = getDb();
      const { members, packageId } = await makeHousehold("backstop", 1, 5);
      const classId = await makeGroupClass(3);
      const userId = members[0]!.id;

      // First live booking inserted directly (bypassing the action).
      await db.insert(bookings).values({
        classInstanceId: classId,
        userId,
        packageId,
        creditCost: GROUP_COST,
        freeCancelHours: 5,
        status: "booked",
      });

      // A SECOND live booking for the same (class,user) must violate the partial
      // unique index `bookings_one_live_per_user`.
      let rejected = false;
      let code: unknown;
      try {
        await db.insert(bookings).values({
          classInstanceId: classId,
          userId,
          packageId,
          creditCost: GROUP_COST,
          freeCancelHours: 5,
          status: "booked",
        });
      } catch (err) {
        rejected = true;
        // The neon-serverless driver may wrap the SQLSTATE on err.cause.code.
        const top = err as { code?: unknown; cause?: { code?: unknown } };
        code = top.code ?? top.cause?.code;
      }
      expect(rejected).toBe(true);
      expect(code).toBe("23505");

      // Still exactly one live booking — the index held the line.
      expect(await liveBookingsFor(classId)).toHaveLength(1);

      // A CANCELLED row for the same (class,user) is allowed (the index is partial
      // on status='booked'), so re-booking after a cancel is never blocked.
      await db.insert(bookings).values({
        classInstanceId: classId,
        userId,
        packageId,
        creditCost: GROUP_COST,
        freeCancelHours: 5,
        status: "cancelled",
        cancelledAt: new Date(),
      });
      // (no throw expected)
    });
  },
);
