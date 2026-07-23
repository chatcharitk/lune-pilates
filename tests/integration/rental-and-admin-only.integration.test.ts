// DB-backed integration tests for the 2026-07-23 booking-rule changes:
//
//   CHANGE 1 — Private/Duo/Trio are FRONT-DESK-ONLY. A customer bookClass / joinWaitlist
//   for those types fails ADMIN_ONLY before any debit; adminBookForCustomer still books
//   them (bookedByAdmin bypass).
//
//   CHANGE 2 — Studio rental: a monthly RELEASE WINDOW gates customer booking
//   (RENTAL_WINDOW_CLOSED before the window opens; the admin path bypasses it), plus
//   ROOM EXCLUSIVITY (a rental may not share its time with any active class) enforced at
//   creation (createClass → ROOM_CONFLICT) and re-checked under the booking transaction.
//
// Identity is mocked with the same FIFO session queue as booking-policy.integration.
// Gated on DATABASE_URL; fixtures share a per-run tag and are torn down in afterAll.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";

const sessionQueue: SessionUser[] = [];
function enqueueSession(...s: SessionUser[]): void {
  sessionQueue.push(...s);
}
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async (): Promise<SessionUser> => {
    const u = sessionQueue.shift();
    if (!u) throw new Error("test session queue empty — enqueueSession() first");
    return u;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

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
import { adminBookForCustomer } from "@/app/actions/admin-bookings";
import { joinWaitlist } from "@/app/actions/waitlist";
import { createClass, updateClass } from "@/app/actions/schedule";
import type { ClassType, PackageCategory } from "@/lib/domain/types";
import { studioInstant, studioParts } from "@/lib/time";

const HAS_DB = !!process.env.DATABASE_URL;
const future = (h: number) => new Date(Date.now() + h * 3_600_000);

describe.skipIf(!HAS_DB)("rental window + admin-only booking (integration · requires DATABASE_URL)", () => {
  const run = `ra_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const classIds: string[] = [];
  const houseIds: string[] = [];

  beforeAll(() => {
    delete process.env.ADMIN_AUTH; // mock owner is signed in for admin actions
    delete process.env.ADMIN_ROLE;
  });

  async function makeMember(
    label: string,
    category: PackageCategory,
    hoursLeft: number,
  ): Promise<{ user: SessionUser; packageId: string }> {
    const db = getDb();
    const houseNumber = `${run}-${label}`;
    const [h] = await db.insert(households).values({ houseNumber }).returning({ id: households.id });
    houseIds.push(h!.id);
    const [u] = await db
      .insert(users)
      .values({ phone: houseNumber, name: houseNumber, tier: "member", householdId: h!.id })
      .returning({ id: users.id });
    const [p] = await db
      .insert(packages)
      .values({
        type: "pkg",
        category,
        hoursTotal: hoursLeft,
        hoursLeft,
        expiresAt: future(720),
        ownerHouseholdId: h!.id,
      })
      .returning({ id: packages.id });
    return {
      user: { id: u!.id, name: houseNumber, tier: "member", householdId: h!.id, houseNumber },
      packageId: p!.id,
    };
  }

  /** Direct insert of a published class instance at an exact instant (bypasses createClass). */
  async function insertClass(type: ClassType, startsAt: Date, dur: number, cap: number): Promise<string> {
    const db = getDb();
    const [c] = await db
      .insert(classInstances)
      .values({
        startsAt,
        durationMin: dur,
        type,
        capacity: cap,
        status: "published",
        publishedAt: new Date(),
        membersVisibleAt: new Date(),
        publicVisibleAt: new Date(Date.now() - 3_600_000),
      })
      .returning({ id: classInstances.id });
    classIds.push(c!.id);
    return c!.id;
  }

  afterAll(async () => {
    try {
      const db = getDb();
      // Collect this run's packages (scoped to our households) to clear their FKs first.
      const pkgRows = houseIds.length
        ? await db
            .select({ id: packages.id })
            .from(packages)
            .where(inArray(packages.ownerHouseholdId, houseIds))
        : [];
      const pkgIds = pkgRows.map((r) => r.id);

      if (classIds.length) {
        await db.delete(bookings).where(inArray(bookings.classInstanceId, classIds));
        await db.delete(waitlist).where(inArray(waitlist.classInstanceId, classIds));
      }
      if (pkgIds.length) {
        await db.delete(creditLedger).where(inArray(creditLedger.packageId, pkgIds));
        await db.delete(packages).where(inArray(packages.id, pkgIds));
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

  // ───────────── CHANGE 1: admin-only types ─────────────

  it("customer bookClass on a PRIVATE class fails ADMIN_ONLY (no debit)", async () => {
    const { user, packageId } = await makeMember("adminonly-book", "private", 5);
    const classId = await insertClass("private", future(48), 60, 1);

    enqueueSession(user);
    const res = await bookClass({ classInstanceId: classId });
    expect(res).toEqual({ ok: false, code: "ADMIN_ONLY" });

    // Untouched pool — the guard fires before package selection / debit.
    const [p] = await getDb().select({ hoursLeft: packages.hoursLeft }).from(packages).where(eq(packages.id, packageId));
    expect(p!.hoursLeft).toBe(5);
  });

  it("adminBookForCustomer CAN book a private class (bookedByAdmin bypass)", async () => {
    const { user } = await makeMember("adminonly-admin", "private", 5);
    const classId = await insertClass("private", future(48), 60, 1);
    const res = await adminBookForCustomer({ classInstanceId: classId, userId: user.id });
    expect(res.ok).toBe(true);
  });

  it("customer joinWaitlist on a FULL private class fails ADMIN_ONLY", async () => {
    const { user: booker } = await makeMember("wl-priv-booker", "private", 5);
    const { user: waiter } = await makeMember("wl-priv-waiter", "private", 5);
    const classId = await insertClass("private", future(48), 60, 1);
    // Fill it via the admin path (capacity 1).
    const booked = await adminBookForCustomer({ classInstanceId: classId, userId: booker.id });
    expect(booked.ok).toBe(true);

    enqueueSession(waiter);
    const res = await joinWaitlist({ classInstanceId: classId });
    expect(res).toEqual({ ok: false, code: "ADMIN_ONLY" });
  });

  // ───────────── CHANGE 2b: rental release window ─────────────

  it("customer bookClass on a rental BEFORE its window opens → RENTAL_WINDOW_CLOSED", async () => {
    const { user, packageId } = await makeMember("rent-closed", "rental", 5);
    // A rental on the 15th of the month TWO months ahead: its window opens on the 1st
    // of the month one-ahead, which is still in the future → closed now.
    const now = studioParts(new Date());
    const startsAt = studioInstant(now.year, now.month0 + 2, 15, 9, 0);
    const classId = await insertClass("rental", startsAt, 60, 3);

    enqueueSession(user);
    const res = await bookClass({ classInstanceId: classId });
    expect(res).toEqual({ ok: false, code: "RENTAL_WINDOW_CLOSED" });
    const [p] = await getDb().select({ hoursLeft: packages.hoursLeft }).from(packages).where(eq(packages.id, packageId));
    expect(p!.hoursLeft).toBe(5); // no debit

    // The front desk bypasses the window.
    const admin = await adminBookForCustomer({ classInstanceId: classId, userId: user.id });
    expect(admin.ok).toBe(true);
  });

  it("customer books a rental whose window is OPEN (48h out) and it debits the rental pool", async () => {
    const { user, packageId } = await makeMember("rent-open", "rental", 5);
    const classId = await insertClass("rental", future(300), 60, 3);

    enqueueSession(user);
    const res = await bookClass({ classInstanceId: classId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [p] = await getDb().select({ hoursLeft: packages.hoursLeft }).from(packages).where(eq(packages.id, packageId));
    expect(p!.hoursLeft).toBe(4); // rental cost = 1
  });

  // ───────────── CHANGE 2c: room exclusivity ─────────────

  it("createClass REJECTS a rental that overlaps an active class (ROOM_CONFLICT)", async () => {
    // Existing group 09:00–10:00 on a fixed future day.
    const now = studioParts(new Date());
    const day = studioInstant(now.year, now.month0 + 1, 10, 9, 0);
    await insertClass("group", day, 60, 3);
    const p = studioParts(day);
    const ymd = `${p.year}-${String(p.month0 + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;

    // Rental 09:30–10:30 overlaps → rejected.
    const conflict = await createClass({
      date: ymd,
      time: "09:30",
      type: "rental",
      durationMin: 60,
      capacity: 3,
    });
    expect(conflict).toEqual({ ok: false, code: "ROOM_CONFLICT" });

    // Rental 11:00–12:00 does NOT overlap → created fine.
    const ok = await createClass({ date: ymd, time: "11:00", type: "rental", durationMin: 60, capacity: 3 });
    expect(ok.ok).toBe(true);
    if (ok.ok) classIds.push(ok.id);
  });

  it("createClass REJECTS a non-rental placed over an active RENTAL (ROOM_CONFLICT)", async () => {
    const now = studioParts(new Date());
    const day = studioInstant(now.year, now.month0 + 1, 12, 14, 0);
    await insertClass("rental", day, 60, 3);
    const p = studioParts(day);
    const ymd = `${p.year}-${String(p.month0 + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;

    const res = await createClass({ date: ymd, time: "14:30", type: "group", durationMin: 60, capacity: 3 });
    expect(res).toEqual({ ok: false, code: "ROOM_CONFLICT" });
  });

  it("updateClass REJECTS editing a class onto an active RENTAL's slot (ROOM_CONFLICT)", async () => {
    // Rental 09:00–10:00 and a group elsewhere on the SAME day (updateClass keeps the day).
    const now = studioParts(new Date());
    const day = studioInstant(now.year, now.month0 + 1, 14, 9, 0);
    await insertClass("rental", day, 60, 3);
    const groupDay = studioInstant(now.year, now.month0 + 1, 14, 13, 0); // 13:00, no overlap
    const groupId = await insertClass("group", groupDay, 60, 3);

    // Move the group to 09:30 → overlaps the rental → rejected, row unchanged.
    const conflict = await updateClass({
      id: groupId,
      time: "09:30",
      type: "group",
      durationMin: 60,
      capacity: 3,
    });
    expect(conflict).toEqual({ ok: false, code: "ROOM_CONFLICT" });

    // A non-overlapping edit (11:00) still succeeds.
    const ok = await updateClass({
      id: groupId,
      time: "11:00",
      type: "group",
      durationMin: 60,
      capacity: 3,
    });
    expect(ok).toEqual({ ok: true });
  });

  it("updateClass ALLOWS moving a class onto another NON-rental class's slot (two non-rentals coexist)", async () => {
    // Two groups on the same day; moving one on top of the other must NOT be blocked —
    // room exclusivity is rental-scoped only (do not over-block).
    const now = studioParts(new Date());
    const day = studioInstant(now.year, now.month0 + 1, 15, 9, 0);
    await insertClass("group", day, 60, 3); // group A 09:00–10:00
    const bDay = studioInstant(now.year, now.month0 + 1, 15, 13, 0);
    const bId = await insertClass("group", bDay, 60, 3); // group B 13:00

    // Move B onto A's slot (09:00) — overlaps another non-rental → still allowed.
    const res = await updateClass({
      id: bId,
      time: "09:00",
      type: "group",
      durationMin: 60,
      capacity: 3,
    });
    expect(res).toEqual({ ok: true });
  });

  it("booking-time safety net: a rental with a conflicting class scheduled over it fails ROOM_CONFLICT", async () => {
    const { user } = await makeMember("rent-conflict", "rental", 5);
    // Rental window open (48h out), no conflict yet.
    const rentalId = await insertClass("rental", future(500), 60, 3);
    // A group class is then placed over it directly (bypassing createClass's guard) —
    // the atomic debit must re-detect the overlap under the lock.
    await insertClass("group", future(500.25), 60, 3); // 15 min into the rental

    enqueueSession(user);
    const res = await bookClass({ classInstanceId: rentalId });
    expect(res).toEqual({ ok: false, code: "ROOM_CONFLICT" });
  });
});
