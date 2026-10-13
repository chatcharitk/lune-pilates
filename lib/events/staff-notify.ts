// Staff notifications to LINE group chats: every NEW booking (2026-10-12) and every
// CANCELLATION (2026-10-13) is posted to each group the studio's Official Account has
// been invited into (recorded by the webhook — lib/line/webhook.ts). A booking post
// says who booked what, how full the class now is, and the customer's classes left;
// a cancel post says the same after the refund; a whole-class cancel is one post for
// the class. Front-desk MOVES (reschedules) post nothing — they are neither.
//
// Thin listeners on the domain events like every other notification — the change
// is already committed; this only reports it. Best-effort: a LINE failure is logged
// by the bus and never touches the booking. Independent of
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
type BookingCancelled = Extract<DomainEvent, { type: "booking.cancelled" }>;
type ClassCancelled = Extract<DomainEvent, { type: "class.cancelled" }>;

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

/** "ส. 17 ต.ค. 09:00 น. · ครูจ๋า" — the class line every staff message shares. */
function whenLine(startsAt: Date, instructor: string | null): string {
  const day = formatStudioDate(startsAt, "th", { weekday: "short", day: "numeric", month: "short" });
  return `🕘 ${day} ${formatStudioTime(startsAt)} น.${instructor ? ` · ${instructor}` : ""}`;
}

function whoLine(f: Pick<StaffBookingFacts, "customerName" | "houseNumber">): string {
  return `👤 ${f.houseNumber ? `${f.customerName} (บ้าน ${f.houseNumber})` : f.customerName}`;
}

/** The new-booking group message. Pure, so the wording is pinned by tests. */
export function staffBookingMessage(f: StaffBookingFacts): string {
  const title =
    f.source === "admin" ? "📅 จองคลาสใหม่ (แอดมินจองให้)" : f.source === "waitlist" ? "📅 จองคลาสใหม่ (จากคิวรอ)" : "📅 จองคลาสใหม่";
  return [
    title,
    whoLine(f),
    `🧘 ${f.className} · ${f.typeLabel}`,
    whenLine(f.startsAt, f.instructor),
    f.partySize !== null
      ? `👥 เช่าสตูดิโอ ${f.partySize} คน`
      : `👥 ผู้เข้าเรียน ${f.booked}/${f.capacity} คน${f.booked >= f.capacity ? " (เต็ม)" : ""}`,
    `🎟️ คลาสคงเหลือของลูกค้า: ${f.remaining} คลาส`,
  ].join("\n");
}

/** A cancelled booking: who, which class, how full it is now, and the refund. Pure. */
export function staffCancelMessage(
  f: Omit<StaffBookingFacts, "source">,
  cancel: { refunded: boolean; byAdmin: boolean },
): string {
  return [
    cancel.byAdmin ? "❌ ยกเลิกการจอง (แอดมินยกเลิก)" : "❌ ยกเลิกการจอง",
    whoLine(f),
    `🧘 ${f.className} · ${f.typeLabel}`,
    whenLine(f.startsAt, f.instructor),
    f.partySize !== null ? `👥 เช่าสตูดิโอ ${f.partySize} คน — ว่างแล้ว` : `👥 ผู้เข้าเรียนตอนนี้ ${f.booked}/${f.capacity} คน`,
    cancel.refunded
      ? `🎟️ คืนคลาสแล้ว — คงเหลือ ${f.remaining} คลาส`
      : `🎟️ ไม่คืนคลาส — คงเหลือ ${f.remaining} คลาส`,
  ].join("\n");
}

/** The studio cancelled a whole class. Pure. */
export function staffClassCancelledMessage(c: {
  className: string;
  typeLabel: string;
  startsAt: Date;
  instructor: string | null;
  cancelledBookings: number;
}): string {
  return [
    "🚫 ยกเลิกคลาส",
    `🧘 ${c.className} · ${c.typeLabel}`,
    whenLine(c.startsAt, c.instructor),
    c.cancelledBookings > 0 ? `🎟️ คืนคลาสให้ ${c.cancelledBookings} การจองแล้ว` : "ไม่มีผู้จองในคลาสนี้",
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

/** Read everything a message needs from the booking (live or just cancelled). */
async function loadFacts(e: {
  bookingId: string;
  userId: string;
}): Promise<Omit<StaffBookingFacts, "source"> | null> {
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
      classInstanceId: bookings.classInstanceId,
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
    .where(and(eq(bookings.classInstanceId, row.classInstanceId), eq(bookings.status, "booked")));
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
    ? await loadFacts({ bookingId: latest.id, userId: latest.userId })
    : null;
  await line.push(
    groupId,
    facts
      ? `🧪 ทดสอบ — การจองล่าสุด\n\n${staffBookingMessage({ ...facts, source: "customer" })}`
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
  await pushToGroups(groups, staffBookingMessage({ ...facts, source: e.source }));
}

/** The `booking.cancelled` listener. The cancel half of a reschedule is a move. */
export async function notifyStaffOfCancellation(e: BookingCancelled): Promise<void> {
  if (e.source === "admin_reschedule" || !process.env.DATABASE_URL) return;
  const groups = await activeGroupIds();
  if (groups.length === 0) return;
  const facts = await loadFacts(e);
  if (!facts) return;
  await pushToGroups(groups, staffCancelMessage(facts, { refunded: e.refunded, byAdmin: e.source === "admin" }));
}

/** The `class.cancelled` listener — one message for the class, not one per person. */
export async function notifyStaffOfClassCancelled(e: ClassCancelled): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const groups = await activeGroupIds();
  if (groups.length === 0) return;
  const [row] = await getDb()
    .select({
      className: classInstances.name,
      type: classInstances.type,
      startsAt: classInstances.startsAt,
      instructor: instructors.nameTh,
    })
    .from(classInstances)
    .leftJoin(instructors, eq(instructors.id, classInstances.instructorId))
    .where(eq(classInstances.id, e.classInstanceId))
    .limit(1);
  if (!row) return;
  const meta = metaFor(row.type as ClassType);
  await pushToGroups(
    groups,
    staffClassCancelledMessage({
      className: row.className?.trim() || meta.label.th,
      typeLabel: meta.short.th,
      startsAt: row.startsAt,
      instructor: row.instructor,
      cancelledBookings: e.cancelledBookings,
    }),
  );
}

async function pushToGroups(groups: string[], text: string): Promise<void> {
  const line = getLineClient();
  await Promise.all(groups.map((g) => line.push(g, text)));
}
