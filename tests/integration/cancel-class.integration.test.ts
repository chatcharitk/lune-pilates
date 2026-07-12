// DB-backed integration test for the class-level cancel (cancelClass): the studio
// cancels a whole class → the instance flips to 'cancelled', every live booking is
// cancelled WITH a full refund (+cost ledger rows carrying the audit note), the
// waitlist expires WITHOUT new offers, re-cancelling reports ALREADY_CANCELLED,
// and booking into the cancelled class is rejected by the atomic debit.
//
// requireOwner() resolves the default mock owner; bookClass resolves identity via
// getCurrentUser(), so the session module is mocked with a FIFO queue exactly like
// booking-debit.integration.test.ts. Gated on DATABASE_URL; skips on no-DB runs.

import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";

import type { SessionUser } from "@/lib/auth/session";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const sessionQueue: SessionUser[] = [];
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async (): Promise<SessionUser> => {
    const u = sessionQueue.shift();
    if (!u) throw new Error("test session queue empty");
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
import { cancelClass } from "@/app/actions/schedule";
import { bookClass } from "@/app/actions/booking";
import { creditCostForClassType } from "@/lib/credits/cost";

const HAS_DB = !!process.env.DATABASE_URL;
const GROUP_COST = creditCostForClassType("group");
const future = (h: number) => new Date(Date.now() + h * 3_600_000);

describe.skipIf(!HAS_DB)("class-level cancel (integration · requires DATABASE_URL)", () => {
  const run = `cc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const classIds: string[] = [];

  async function makeMember(label: string, hoursLeft: number) {
    const db = getDb();
    const houseNumber = `${run}-${label}`;
    const [h] = await db.insert(households).values({ houseNumber }).returning({ id: households.id });
    const [u] = await db
      .insert(users)
      .values({ phone: `${houseNumber}-0`, name: houseNumber, tier: "member", householdId: h!.id })
      .returning({ id: users.id });
    const [p] = await db
      .insert(packages)
      .values({
        type: "p10",
        category: "group",
        hoursTotal: hoursLeft,
        hoursLeft,
        expiresAt: future(720),
        ownerHouseholdId: h!.id,
      })
      .returning({ id: packages.id });
    const session: SessionUser = {
      id: u!.id,
      name: houseNumber,
      tier: "member",
      householdId: h!.id,
      houseNumber,
    };
    return { session, userId: u!.id, packageId: p!.id };
  }

  async function makeGroupClass(capacity: number): Promise<string> {
    const db = getDb();
    const [c] = await db
      .insert(classInstances)
      .values({
        startsAt: future(48),
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
      if (classIds.length) await db.delete(classInstances).where(inArray(classInstances.id, classIds));
      if (houseIds.length) {
        await db.delete(users).where(inArray(users.householdId, houseIds));
        await db.delete(households).where(inArray(households.id, houseIds));
      }
    } finally {
      await closeDb();
    }
  });

  it("cancels the class: refunds every live booking (noted ledger rows), expires the waitlist with NO offer, blocks re-cancel and new bookings", async () => {
    const db = getDb();
    const POOL = 5;
    const a = await makeMember("a", POOL);
    const b = await makeMember("b", POOL);
    const w = await makeMember("w", POOL);
    const classId = await makeGroupClass(2);

    // Two live bookings through the REAL debit path.
    sessionQueue.push(a.session);
    expect((await bookClass({ classInstanceId: classId })).ok).toBe(true);
    sessionQueue.push(b.session);
    expect((await bookClass({ classInstanceId: classId })).ok).toBe(true);

    // One waiting queue entry (insert directly — join requires fullness, which holds).
    await db.insert(waitlist).values({
      classInstanceId: classId,
      userId: w.userId,
      position: 1,
      status: "waiting",
    });

    // Cancel the whole class.
    const res = await cancelClass({ id: classId });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("cancel failed");
    expect(res.cancelledBookings).toBe(2);
    expect(res.refunded).toBe(2);

    // Class is cancelled.
    const [cls] = await db
      .select({ status: classInstances.status })
      .from(classInstances)
      .where(eq(classInstances.id, classId));
    expect(cls!.status).toBe("cancelled");

    // Both bookings cancelled; no live bookings remain.
    const live = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.classInstanceId, classId), eq(bookings.status, "booked")));
    expect(live).toHaveLength(0);

    // Each pool got its exact +cost refund with the audit note; balances restored.
    for (const m of [a, b]) {
      const refunds = await db
        .select()
        .from(creditLedger)
        .where(and(eq(creditLedger.packageId, m.packageId), eq(creditLedger.reason, "cancel_refund")));
      expect(refunds).toHaveLength(1);
      expect(refunds[0]!.delta).toBe(GROUP_COST);
      expect(refunds[0]!.note).toBe("class cancelled by studio");
      expect(refunds[0]!.actorUserId).toBe(m.userId); // the customer's own credit moved back
      const [pkg] = await db
        .select({ hoursLeft: packages.hoursLeft })
        .from(packages)
        .where(eq(packages.id, m.packageId));
      expect(pkg!.hoursLeft).toBe(POOL);
    }

    // Waitlist expired, and NO entry was offered (never invite onto a dead class).
    const wl = await db.select().from(waitlist).where(eq(waitlist.classInstanceId, classId));
    expect(wl).toHaveLength(1);
    expect(wl[0]!.status).toBe("expired");

    // Re-cancel reports ALREADY_CANCELLED.
    const again = await cancelClass({ id: classId });
    expect(again).toEqual({ ok: false, code: "ALREADY_CANCELLED" });

    // Booking into the cancelled class is rejected by the atomic debit.
    sessionQueue.push(w.session);
    const late = await bookClass({ classInstanceId: classId });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(["NOT_BOOKABLE", "NOT_VISIBLE"]).toContain(late.code);
  });

  it("cancelClass on an unknown id → NOT_FOUND", async () => {
    const res = await cancelClass({ id: "00000000-0000-4000-8000-00000000dead" });
    expect(res).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});
