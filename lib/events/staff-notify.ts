// Staff notifications to LINE group chats (2026-10-12): every NEW booking is posted
// to each group the studio's Official Account has been invited into (recorded by the
// webhook — lib/line/webhook.ts). The post says who booked what, how full the class
// now is, and how many classes the customer has left for that class type.
//
// A thin listener on `booking.confirmed` like every other notification — the
// booking is already committed; this only reports it. Best-effort: a LINE failure
// is logged by the bus and never touches the booking. Independent of
// LINE_NOTIFICATIONS_ENABLED (which gates CUSTOMER pushes): having a group on file
// is the opt-in, and removing the bot from the group is the opt-out.

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { bookings, classInstances, households, instructors, lineNotifyGroups, users } from "@/lib/db/schema";
import { getLineClient } from "@/lib/line";
import { getPoolBalance } from "@/lib/credits/selectPackage";
import { metaFor } from "@/lib/schedule/queries";
import { formatStudioDate, formatStudioTime } from "@/lib/time";
import type { ClassType } from "@/lib/domain/types";
import type { DomainEvent } from "./types";

type BookingConfirmed = Extract<DomainEvent, { type: "booking.confirmed" }>;

export interface StaffBookingFacts {
  customerName: string;
  houseNumber: string | null;
  className: string;
  /** Thai short type label (กลุ่ม / ส่วนตัว / ดูโอ …). */
  typeLabel: string;
  startsAt: Date;
  instructor: string | null;
  /** Seats now taken / the class's capacity, this booking included. */
  booked: number;
  capacity: number;
  /** Head-count of a studio rental; null for every other type. */
  partySize: number | null;
  /** The customer's (household's, for members) classes left for this class type. */
  remaining: number;
  source: BookingConfirmed["source"];
}

/** The group message. Pure, so the wording is pinned by tests. */
export function staffBookingMessage(f: StaffBookingFacts): string {
  const day = formatStudioDate(f.startsAt, "th", { weekday: "short", day: "numeric", month: "short" });
  const who = f.houseNumber ? `${f.customerName} (บ้าน ${f.houseNumber})` : f.customerName;
  const title =
    f.source === "admin" ? "📅 จองคลาสใหม่ (แอดมินจองให้)" : f.source === "waitlist" ? "📅 จองคลาสใหม่ (จากคิวรอ)" : "📅 จองคลาสใหม่";
  return [
    title,
    `👤 ${who}`,
    `🧘 ${f.className} · ${f.typeLabel}`,
    `🕘 ${day} ${formatStudioTime(f.startsAt)} น.${f.instructor ? ` · ${f.instructor}` : ""}`,
    f.partySize !== null
      ? `👥 เช่าสตูดิโอ ${f.partySize} คน`
      : `👥 ผู้เข้าเรียน ${f.booked}/${f.capacity} คน${f.booked >= f.capacity ? " (เต็ม)" : ""}`,
    `🎟️ คลาสคงเหลือของลูกค้า: ${f.remaining} คลาส`,
  ].join("\n");
}

/** Group ids still subscribed (bot not removed). */
async function activeGroupIds(): Promise<string[]> {
  const rows = await getDb()
    .select({ groupId: lineNotifyGroups.groupId })
    .from(lineNotifyGroups)
    .where(isNull(lineNotifyGroups.leftAt));
  return rows.map((r) => r.groupId);
}

/** Read everything the message needs from the committed booking. Null if it's gone. */
async function loadFacts(e: BookingConfirmed): Promise<StaffBookingFacts | null> {
  const db = getDb();
  const [row] = await db
    .select({
      customerName: users.name,
      tier: users.tier,
      householdId: users.householdId,
      houseNumber: households.houseNumber,
      className: classInstances.name,
      type: classInstances.type,
      startsAt: classInstances.startsAt,
      capacity: classInstances.capacity,
      instructor: instructors.nameTh,
      partySize: bookings.partySize,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.userId))
    .innerJoin(classInstances, eq(classInstances.id, bookings.classInstanceId))
    .leftJoin(households, eq(households.id, users.householdId))
    .leftJoin(instructors, eq(instructors.id, classInstances.instructorId))
    .where(eq(bookings.id, e.bookingId))
    .limit(1);
  if (!row) return null;

  const [count] = await db
    .select({ booked: sql<number>`count(*)::int` })
    .from(bookings)
    .where(and(eq(bookings.classInstanceId, e.classInstanceId), eq(bookings.status, "booked")));
  const booked = count?.booked ?? 0;

  const type = row.type as ClassType;
  const meta = metaFor(type);
  const remaining = await getPoolBalance(
    { id: e.userId, tier: row.tier, householdId: row.householdId },
    type,
  );

  return {
    customerName: row.customerName,
    // Only a member shares a house pool; a guest's house number means nothing here.
    houseNumber: row.tier === "member" ? row.houseNumber : null,
    className: row.className?.trim() || meta.label.th,
    typeLabel: meta.short.th,
    startsAt: row.startsAt,
    instructor: row.instructor,
    booked,
    capacity: row.capacity,
    partySize: type === "rental" ? row.partySize ?? null : null,
    remaining,
    source: e.source,
  };
}

/**
 * "#ทดสอบ" in a registered staff group: post the most recent live booking as it
 * would have been announced, marked as a test — proof the whole path works without
 * making a fake booking. Ignored for a group that isn't registered.
 */
export async function sendTestNotification(groupId: string): Promise<void> {
  const db = getDb();
  const [group] = await db
    .select({ groupId: lineNotifyGroups.groupId })
    .from(lineNotifyGroups)
    .where(and(eq(lineNotifyGroups.groupId, groupId), isNull(lineNotifyGroups.leftAt)))
    .limit(1);
  if (!group) return;
  const line = getLineClient();
  const [latest] = await db
    .select({ id: bookings.id, userId: bookings.userId, classInstanceId: bookings.classInstanceId })
    .from(bookings)
    .where(eq(bookings.status, "booked"))
    .orderBy(desc(bookings.createdAt))
    .limit(1);
  const facts = latest
    ? await loadFacts({ type: "booking.confirmed", bookingId: latest.id, ...latest, source: "customer" })
    : null;
  await line.push(
    groupId,
    facts
      ? `🧪 ทดสอบ — การจองล่าสุด\n\n${staffBookingMessage(facts)}`
      : "🧪 ทดสอบ — เชื่อมต่อแล้ว แต่ยังไม่มีการจองให้แสดงค่ะ",
  );
}

/** The `booking.confirmed` listener. A reschedule is a move, not a new booking. */
export async function notifyStaffOfBooking(e: BookingConfirmed): Promise<void> {
  if (e.source === "admin_reschedule" || !process.env.DATABASE_URL) return;
  const groups = await activeGroupIds();
  if (groups.length === 0) return;
  const facts = await loadFacts(e);
  if (!facts) return;
  const text = staffBookingMessage(facts);
  const line = getLineClient();
  await Promise.all(groups.map((g) => line.push(g, text)));
}
