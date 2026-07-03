// DB-backed integration test for the admin "book for a customer" path
// (adminBookForCustomer). The action reuses the same atomic bookClassWithDebit as
// the customer flow (covered by booking-debit.integration.test.ts); this pins the
// ADMIN WRAPPER: it resolves the TARGET customer's pool (not the admin's), debits
// exactly the class cost from it, writes one booking + one −cost ledger row, honours
// a requested reformer position, and fails NO_USABLE_PACKAGE when the customer has
// no credit (no booking, no debit).
//
// requireOwner() resolves the default mock owner (ADMIN_ROLE/ADMIN_AUTH unset), so
// no identity mock is needed — the ledger actor is the CUSTOMER (userId) by design.
//
// Gated on DATABASE_URL (loaded by setup-env.ts); skips under the no-DB npm test.

import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";

// adminBookForCustomer calls revalidatePath on success — stub next/cache for the
// test process (no Next request context here).
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { getDb, closeDb } from "@/lib/db/client";
import { bookings, classInstances, creditLedger, households, packages, users } from "@/lib/db/schema";
import { adminBookForCustomer } from "@/app/actions/admin-bookings";
import { creditCostForClassType } from "@/lib/credits/cost";

const HAS_DB = !!process.env.DATABASE_URL;
const GROUP_COST = creditCostForClassType("group");
const future = (h: number) => new Date(Date.now() + h * 3_600_000);

describe.skipIf(!HAS_DB)(
  "admin book for a customer (integration · requires DATABASE_URL)",
  () => {
    const run = `abfc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const classIds: string[] = [];

    async function makeMember(
      label: string,
      hoursLeft: number,
    ): Promise<{ userId: string; packageId: string }> {
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
          hoursTotal: Math.max(hoursLeft, 1),
          hoursLeft,
          expiresAt: future(720),
          ownerHouseholdId: h!.id,
        })
        .returning({ id: packages.id });
      return { userId: u!.id, packageId: p!.id };
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

    const liveBookingsFor = (classInstanceId: string) =>
      getDb()
        .select()
        .from(bookings)
        .where(and(eq(bookings.classInstanceId, classInstanceId), eq(bookings.status, "booked")));

    const bookingLedgerFor = (packageId: string) =>
      getDb()
        .select()
        .from(creditLedger)
        .where(and(eq(creditLedger.packageId, packageId), eq(creditLedger.reason, "booking")));

    async function hoursLeftOf(packageId: string): Promise<number> {
      const [p] = await getDb()
        .select({ hoursLeft: packages.hoursLeft })
        .from(packages)
        .where(eq(packages.id, packageId));
      return p!.hoursLeft;
    }

    afterAll(async () => {
      try {
        const db = getDb();
        const houses = await db
          .select({ id: households.id })
          .from(households)
          .where(like(households.houseNumber, `${run}-%`));
        const houseIds = houses.map((h) => h.id);
        if (classIds.length) await db.delete(bookings).where(inArray(bookings.classInstanceId, classIds));
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

    it("books the customer, debiting THEIR pool once (one booking + one −cost ledger row)", async () => {
      const POOL = 5;
      const { userId, packageId } = await makeMember("ok", POOL);
      const classId = await makeGroupClass(3);

      const res = await adminBookForCustomer({ classInstanceId: classId, userId });
      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error(`book failed: ${res.code}`);
      expect(res.hoursLeft).toBe(POOL - GROUP_COST);

      const live = await liveBookingsFor(classId);
      expect(live).toHaveLength(1);
      expect(live[0]!.userId).toBe(userId);
      expect(live[0]!.creditCost).toBe(GROUP_COST);

      const debits = await bookingLedgerFor(packageId);
      expect(debits).toHaveLength(1);
      expect(debits[0]!.delta).toBe(-GROUP_COST);
      expect(await hoursLeftOf(packageId)).toBe(POOL - GROUP_COST);
    });

    it("honours a requested reformer position", async () => {
      const { userId } = await makeMember("pos", 5);
      const classId = await makeGroupClass(3);

      const res = await adminBookForCustomer({ classInstanceId: classId, userId, position: "left" });
      expect(res.ok).toBe(true);

      const live = await liveBookingsFor(classId);
      expect(live).toHaveLength(1);
      expect(live[0]!.position).toBe("left");
    });

    it("fails NO_USABLE_PACKAGE with no booking + no debit when the customer has no credit", async () => {
      const { userId, packageId } = await makeMember("broke", 0);
      const classId = await makeGroupClass(3);

      const res = await adminBookForCustomer({ classInstanceId: classId, userId });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe("NO_USABLE_PACKAGE");

      expect(await liveBookingsFor(classId)).toHaveLength(0);
      expect(await bookingLedgerFor(packageId)).toHaveLength(0);
      expect(await hoursLeftOf(packageId)).toBe(0);
    });
  },
);
