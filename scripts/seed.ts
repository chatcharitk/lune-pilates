// Seed reference + demo data so the app is explorable against a live DB.
// Canonical numbers come from the spec / lune-data.jsx. Requires DATABASE_URL.
//
//   npm run db:push   # create tables from the schema
//   npm run db:seed   # populate (idempotent — safe to re-run)
//
// Idempotent: reference rows upsert, and the published week is only generated
// when no future class instances exist yet.

import "./_load-env";
import { eq, gt } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  classInstances,
  households,
  instructorAvailability,
  instructors,
  packages,
  users,
} from "@/lib/db/schema";
import { computePublicVisibleAt } from "@/lib/schedule/visibility";
// The recurring weekly baseline is the single source of truth (lib/schedule/baseline.ts);
// the seed generates its published week from it so the seed and the admin
// "generate from baseline" action can never diverge. baselineSlotsForDate uses
// the ISO weekday (1=Mon … 7=Sun) internally, so it stays correct regardless of
// JS getDay's 0=Sun convention.
import { baselineSlotsForDate, startsAtFor } from "@/lib/schedule/baseline";

async function main() {
  const db = getDb();
  const now = new Date();

  await db
    .insert(instructors)
    .values([
      { id: "mai", name: "Kru Mai", nameTh: "ครูใหม่", tag: "Founder · Rehab" },
      { id: "ploy", name: "Kru Ploy", nameTh: "ครูพลอย", tag: "Flow · Pre/Postnatal" },
      { id: "nina", name: "Kru Nina", nameTh: "ครูนีน่า", tag: "Strength · Athletic" },
    ])
    .onConflictDoNothing();

  // Household A-114 (upsert by house number).
  let house = (await db.select().from(households).where(eq(households.houseNumber, "A-114")))[0];
  if (!house) {
    house = (await db.insert(households).values({ houseNumber: "A-114" }).returning())[0];
  }

  // Member Pim (upsert by phone).
  let pim = (await db.select().from(users).where(eq(users.phone, "0810000001")))[0];
  if (!pim) {
    pim = (
      await db
        .insert(users)
        .values({ phone: "0810000001", name: "Pim", tier: "member", householdId: house!.id })
        .returning()
    )[0];
  }
  await db.update(households).set({ ownerUserId: pim!.id }).where(eq(households.id, house!.id));

  // Shared household group pool of 8h (whole integer credits), valid 2 months.
  const existingPkg = await db
    .select()
    .from(packages)
    .where(eq(packages.ownerHouseholdId, house!.id));
  if (existingPkg.length === 0) {
    const expires = new Date(now);
    expires.setMonth(expires.getMonth() + 2);
    await db.insert(packages).values({
      type: "p10",
      category: "group",
      hoursTotal: 10,
      hoursLeft: 8,
      expiresAt: expires,
      ownerHouseholdId: house!.id,
    });
  }

  // Publish a bookable week of group classes (next 7 days) — only if none exist yet.
  const future = await db
    .select({ id: classInstances.id })
    .from(classInstances)
    .where(gt(classInstances.startsAt, now));

  let created = 0;
  if (future.length === 0) {
    // 7 days starting today (offset 0..6) to match the schedule view's window.
    for (let dayOffset = 0; dayOffset <= 6; dayOffset++) {
      const day = new Date(now);
      day.setDate(day.getDate() + dayOffset);
      // Canonical slots for this calendar day's weekday, straight from the baseline.
      for (const slot of baselineSlotsForDate(day)) {
        const startsAt = startsAtFor(day, slot.time);
        await db.insert(classInstances).values({
          startsAt,
          durationMin: slot.durationMin,
          type: slot.type,
          capacity: slot.capacity,
          status: "published",
          publishedAt: now,
          membersVisibleAt: now,
          publicVisibleAt: computePublicVisibleAt(startsAt, slot.type),
        });
        created++;
      }
    }
  }

  // Weekly availability per instructor (mirrors the prototype AVAIL_WEEK) so the
  // admin Instructors screen has real ranges on a fresh DB. day_of_week = ISO
  // 1=Mon … 7=Sun. Only seed when empty (idempotent; the editor replaces per-save).
  const existingAvail = await db
    .select({ id: instructorAvailability.id })
    .from(instructorAvailability)
    .limit(1);
  let availRows = 0;
  if (existingAvail.length === 0) {
    // [instructorId, day_of_week, start, end]
    const AVAIL: [string, number, string, string][] = [
      ["mai", 1, "07:00", "13:00"], ["mai", 1, "17:00", "19:00"],
      ["mai", 2, "07:00", "13:00"], ["mai", 3, "07:00", "12:00"],
      ["mai", 4, "07:00", "13:00"], ["mai", 4, "17:00", "19:00"],
      ["mai", 5, "07:00", "13:00"], ["mai", 6, "08:00", "12:00"],
      ["ploy", 1, "08:00", "12:00"], ["ploy", 1, "17:00", "20:00"],
      ["ploy", 2, "17:00", "20:00"], ["ploy", 3, "08:00", "12:00"], ["ploy", 3, "17:00", "20:00"],
      ["ploy", 4, "17:00", "20:00"], ["ploy", 5, "08:00", "12:00"], ["ploy", 5, "17:00", "20:00"],
      ["ploy", 6, "09:00", "13:00"], ["ploy", 7, "09:00", "12:00"],
      ["nina", 1, "09:00", "12:00"], ["nina", 1, "16:00", "18:30"],
      ["nina", 2, "09:00", "12:00"], ["nina", 4, "09:00", "12:00"], ["nina", 4, "16:00", "18:30"],
      ["nina", 5, "09:00", "12:00"],
    ];
    await db.insert(instructorAvailability).values(
      AVAIL.map(([instructorId, dayOfWeek, startTime, endTime]) => ({
        instructorId,
        dayOfWeek,
        startTime,
        endTime,
      })),
    );
    availRows = AVAIL.length;
  }

  console.info(
    `Seed complete: 3 instructors, household A-114, member Pim, group pool 8h, ${created} published group classes, ${availRows} availability rows${future.length ? " (week already existed — skipped)" : ""}.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
