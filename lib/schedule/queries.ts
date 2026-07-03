// Read models the customer booking UI consumes: the bookable week and a single
// class detail. Both enforce tiered visibility server-side (CLAUDE.md §5,
// invariant 4) by reusing `isBookableForViewer` — the visibility rule is NOT
// reinvented here.
//
// Booked counts are computed live from the bookings table (the source of truth
// for seats), so `seatsLeft`/`full` can never drift from reality.
//
// No-DB dev fallback: when DATABASE_URL is unset, both functions return mock
// data mirroring lune-data.jsx SESSIONS so the UI renders without a database.
// The DB path is the real one; the mock path is gated cleanly behind the env.

import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { bookings, classInstances, instructors } from "@/lib/db/schema";
import type { Bilingual } from "@/lib/i18n";
import type { ClassType, ReformerPosition } from "@/lib/domain/types";
import { CAPACITY, effectiveCapacity } from "@/lib/domain/types";
import type { SessionUser } from "@/lib/auth/session";
import { selectUsablePackageRow } from "@/lib/credits/selectPackage";
import { getMockSession } from "@/lib/mock/session";
import { addDays, studioInstant, studioParts, studioStartOfWeekMonday } from "@/lib/time";
import { isBookableForViewer } from "./visibility";

// ───────────────────────── shared shapes ─────────────────────────

export interface ClassViewer {
  tier: "member" | "guest";
}

/** Class-type display metadata, mirroring lune-data.jsx TYPES. */
export interface ClassTypeMeta {
  type: ClassType;
  label: Bilingual;
  short: Bilingual;
  blurb: Bilingual;
}

export interface InstructorMeta {
  id: string;
  name: Bilingual;
  tag: Bilingual | null;
}

/** One row in the bookable week list. */
export interface BookableClass {
  id: string;
  startsAt: string; // ISO 8601
  durationMin: number;
  type: ClassType;
  typeMeta: ClassTypeMeta;
  instructor: InstructorMeta | null;
  capacity: number;
  booked: number;
  seatsLeft: number;
  full: boolean;
}

/** Per-reformer-position availability for the detail screen. */
export interface PositionAvailability {
  position: ReformerPosition;
  taken: boolean;
}

/** A single class with full booking-detail context. */
export interface ClassDetail extends BookableClass {
  positions: PositionAvailability[];
}

// ───────────────────────── display catalog (bilingual) ─────────────────────────
// Single source for type/instructor labels so both DB and mock paths agree.
// Mirrors lune-data.jsx TYPES / INSTRUCTORS.

const TYPE_META: Record<ClassType, ClassTypeMeta> = {
  group: {
    type: "group",
    label: { en: "Reformer Group", th: "รีฟอร์มเมอร์กลุ่ม" },
    short: { en: "Group", th: "กลุ่ม" },
    blurb: {
      en: "A flowing full-body reformer class for up to three. Springs, straps and breath — instructor assigned.",
      th: "คลาสรีฟอร์มเมอร์เต็มตัวสำหรับสูงสุดสามคน เน้นการไหลลื่นและลมหายใจ จัดผู้สอนให้",
    },
  },
  private: {
    type: "private",
    label: { en: "Private 1:1", th: "ส่วนตัว 1:1" },
    short: { en: "Private", th: "ส่วนตัว" },
    blurb: {
      en: "One-to-one session tailored to your body and goals, with the instructor of your choice.",
      th: "คลาสตัวต่อตัวออกแบบเฉพาะคุณ พร้อมเลือกผู้สอนที่ต้องการ",
    },
  },
  duo: {
    type: "duo",
    label: { en: "Duo", th: "ดูโอ (คู่)" },
    short: { en: "Duo", th: "คู่" },
    blurb: {
      en: "Train side by side with a partner — shared focus, personal attention.",
      th: "ฝึกเคียงข้างคู่ของคุณ ใส่ใจเป็นรายบุคคล",
    },
  },
  trio: {
    type: "trio",
    label: { en: "Trio", th: "ทรีโอ (สาม)" },
    short: { en: "Trio", th: "สาม" },
    blurb: {
      en: "A small group of three — the energy of a class with hands-on guidance.",
      th: "กลุ่มเล็กสามคน ได้พลังของคลาสพร้อมการดูแลใกล้ชิด",
    },
  },
  rental: {
    type: "rental",
    label: { en: "Studio Rental", th: "เช่าสตูดิโอ" },
    short: { en: "Rental", th: "เช่า" },
    blurb: {
      en: "Rent the reformer space for your own practice — 1:1, Duo or Trio.",
      th: "เช่าพื้นที่รีฟอร์มเมอร์เพื่อฝึกเอง รองรับ 1:1 ดูโอ หรือทรีโอ",
    },
  },
};

const INSTRUCTOR_META: Record<string, InstructorMeta> = {
  mai: { id: "mai", name: { en: "Kru Mai", th: "ครูใหม่" }, tag: { en: "Founder · Rehab", th: "ผู้ก่อตั้ง · ฟื้นฟู" } },
  ploy: { id: "ploy", name: { en: "Kru Ploy", th: "ครูพลอย" }, tag: { en: "Flow · Pre/Postnatal", th: "โฟลว์ · ก่อน/หลังคลอด" } },
  nina: { id: "nina", name: { en: "Kru Nina", th: "ครูนีน่า" }, tag: { en: "Strength · Athletic", th: "สร้างความแข็งแรง" } },
};

/**
 * The reformer positions used by a class of the given capacity, in physical
 * order. Mirrors lune-detail.jsx POS_KEYS: cap 1 → middle; cap 2 → left,right;
 * cap 3 → left,middle,right.
 */
export function positionsForCapacity(capacity: number): ReformerPosition[] {
  if (capacity <= 1) return ["middle"];
  if (capacity === 2) return ["left", "right"];
  return ["left", "middle", "right"];
}

/**
 * The current usable balance (in hours) `viewer` would draw on to book a
 * `classType` at `now` — the `hours_left` of the SINGLE package
 * `selectUsablePackage` would actually debit — or `null` when no usable package
 * can cover `minHours` (the booking's cost). This is the figure the booking CTA
 * must display: the debit draws from ONE package (no cross-package splitting in
 * v1), so showing the whole-pool sum would let the UI promise a booking the debit
 * then rejects with NO_USABLE_PACKAGE (audit MEDIUM-2). Cost-aware: pass the
 * class's credit cost as `minHours` so the package shown is the same one the debit
 * picks. Recomputed server-side; never trusts any client number.
 *
 * No-DB fallback: returns the mock household pool balance so the UI renders
 * without a database (mirrors getMockSession().credits).
 */
export async function getUsableBalance(
  viewer: SessionUser,
  classType: ClassType,
  now: Date = new Date(),
  minHours = 0,
): Promise<number | null> {
  if (!process.env.DATABASE_URL) {
    return getMockSession().credits;
  }
  const pkg = await selectUsablePackageRow(viewer, classType, now, minHours);
  return pkg?.hoursLeft ?? null;
}

/** Bilingual display metadata for a class type (mirrors lune-data.jsx TYPES). */
export function metaFor(type: ClassType): ClassTypeMeta {
  return TYPE_META[type];
}

/**
 * Bilingual instructor metadata for a known catalog id (mirrors lune-data.jsx
 * INSTRUCTORS), or a row-derived meta when the id is a DB instructor outside the
 * static catalog. Returns null for an unassigned (null) instructor.
 */
export function instructorMetaFor(
  id: string | null,
  name?: string,
  nameTh?: string,
  tag?: string | null,
): InstructorMeta | null {
  if (!id) return null;
  const known = INSTRUCTOR_META[id];
  if (known) return known;
  // DB instructor not in the static catalog — build from the row.
  if (name) {
    return { id, name: { en: name, th: nameTh ?? name }, tag: tag ? { en: tag, th: tag } : null };
  }
  return null;
}

// ───────────────────────── DB path helpers ─────────────────────────

/**
 * Assemble a position-availability list from the live taken positions. Unknown
 * (null) positions on bookings are ignored for position mapping — they still
 * count toward capacity in `booked`.
 */
function buildPositions(
  capacity: number,
  takenPositions: ReformerPosition[],
): PositionAvailability[] {
  const taken = new Set(takenPositions);
  return positionsForCapacity(capacity).map((position) => ({
    position,
    taken: taken.has(position),
  }));
}

// ───────────────────────── public queries ─────────────────────────

export interface ListBookableArgs {
  viewer: ClassViewer;
  /** Start of the week to list (inclusive). Classes within [weekStart, +7d) are returned. */
  weekStart: Date;
  /** Injectable clock for tests / SSR determinism. */
  now?: Date;
}

/**
 * Published, future class instances in the given week, filtered by tiered
 * visibility for `viewer`, each enriched with display metadata, instructor,
 * capacity, live booked count, seatsLeft and a full flag. Sorted by start time.
 */
export async function listBookableClasses(args: ListBookableArgs): Promise<BookableClass[]> {
  const now = args.now ?? new Date();
  if (!process.env.DATABASE_URL) {
    return mockListBookableClasses(args.viewer, args.weekStart, now);
  }

  const db = getDb();
  const weekEnd = new Date(args.weekStart.getTime() + 7 * 24 * 3_600_000);

  // Live booked count per class via a correlated aggregate.
  const bookedCount = sql<number>`(
    select count(*)::int from ${bookings}
    where ${bookings.classInstanceId} = ${classInstances.id}
      and ${bookings.status} = 'booked'
  )`;

  const rows = await db
    .select({
      id: classInstances.id,
      startsAt: classInstances.startsAt,
      durationMin: classInstances.durationMin,
      type: classInstances.type,
      capacity: classInstances.capacity,
      status: classInstances.status,
      publicVisibleAt: classInstances.publicVisibleAt,
      instructorId: classInstances.instructorId,
      instructorName: instructors.name,
      instructorNameTh: instructors.nameTh,
      instructorTag: instructors.tag,
      booked: bookedCount,
    })
    .from(classInstances)
    .leftJoin(instructors, eq(classInstances.instructorId, instructors.id))
    .where(
      and(
        eq(classInstances.status, "published"),
        sql`${classInstances.startsAt} >= ${args.weekStart}`,
        sql`${classInstances.startsAt} < ${weekEnd}`,
      ),
    )
    .orderBy(asc(classInstances.startsAt));

  return rows
    .filter((r) =>
      isBookableForViewer(
        { status: r.status, startsAt: r.startsAt, publicVisibleAt: r.publicVisibleAt },
        args.viewer,
        now,
      ),
    )
    .map((r) => {
      const booked = r.booked ?? 0;
      // Clamp to the type's hard cap so a mis-seeded instance can't read as having
      // more seats than the reformer limit — the SAME effective capacity the
      // booking debit and waitlist full-check use.
      const capacity = effectiveCapacity(r.capacity, r.type);
      const seatsLeft = Math.max(0, capacity - booked);
      return {
        id: r.id,
        startsAt: r.startsAt.toISOString(),
        durationMin: r.durationMin,
        type: r.type,
        typeMeta: metaFor(r.type),
        instructor: instructorMetaFor(
          r.instructorId,
          r.instructorName ?? undefined,
          r.instructorNameTh ?? undefined,
          r.instructorTag,
        ),
        capacity,
        booked,
        seatsLeft,
        full: seatsLeft <= 0,
      };
    });
}

/**
 * One class with full detail: instructor, duration, capacity, seatsLeft and
 * per-reformer-position availability. Returns null when the class does not exist
 * or is not bookable for the viewer (visibility enforced server-side).
 */
export async function getClassDetail(
  classInstanceId: string,
  viewer: ClassViewer,
  now: Date = new Date(),
): Promise<ClassDetail | null> {
  if (!process.env.DATABASE_URL) {
    return mockGetClassDetail(classInstanceId, viewer, now);
  }

  const db = getDb();
  // The class row and its live bookings both key off `classInstanceId` alone, so
  // they run in ONE parallel round trip (the bookings read is wasted only in the
  // rare not-found / not-visible case — a fine trade for the saved round trip).
  const [[cls], liveBookings] = await Promise.all([
    db
      .select({
        id: classInstances.id,
        startsAt: classInstances.startsAt,
        durationMin: classInstances.durationMin,
        type: classInstances.type,
        capacity: classInstances.capacity,
        status: classInstances.status,
        publicVisibleAt: classInstances.publicVisibleAt,
        instructorId: classInstances.instructorId,
        instructorName: instructors.name,
        instructorNameTh: instructors.nameTh,
        instructorTag: instructors.tag,
      })
      .from(classInstances)
      .leftJoin(instructors, eq(classInstances.instructorId, instructors.id))
      .where(eq(classInstances.id, classInstanceId))
      .limit(1),
    db
      .select({ position: bookings.position })
      .from(bookings)
      .where(and(eq(bookings.classInstanceId, classInstanceId), eq(bookings.status, "booked"))),
  ]);

  if (!cls) return null;
  if (
    !isBookableForViewer(
      { status: cls.status, startsAt: cls.startsAt, publicVisibleAt: cls.publicVisibleAt },
      viewer,
      now,
    )
  ) {
    return null;
  }

  const booked = liveBookings.length;
  const takenPositions = liveBookings
    .map((b) => b.position)
    .filter((p): p is ReformerPosition => p !== null);
  const capacity = effectiveCapacity(cls.capacity, cls.type);
  const seatsLeft = Math.max(0, capacity - booked);

  return {
    id: cls.id,
    startsAt: cls.startsAt.toISOString(),
    durationMin: cls.durationMin,
    type: cls.type,
    typeMeta: metaFor(cls.type),
    instructor: instructorMetaFor(
      cls.instructorId,
      cls.instructorName ?? undefined,
      cls.instructorNameTh ?? undefined,
      cls.instructorTag,
    ),
    capacity,
    booked,
    seatsLeft,
    full: seatsLeft <= 0,
    positions: buildPositions(capacity, takenPositions),
  };
}

// ───────────────────────── no-DB mock fallback ─────────────────────────
// Mirrors lune-data.jsx SESSIONS so the UI renders without a database. Sessions
// are anchored to the passed weekStart (day 1 = weekStart, … day 7 = +6d).

interface MockSessionSeed {
  id: string;
  day: number; // 1=Mon … 7=Sun
  time: string; // "HH:MM"
  dur: number;
  type: ClassType;
  instr: string | null;
  booked: number;
}

const MOCK_SESSIONS: MockSessionSeed[] = [
  { id: "s1", day: 1, time: "08:00", dur: 60, type: "group", instr: null, booked: 1 },
  { id: "s2", day: 1, time: "09:00", dur: 60, type: "group", instr: null, booked: 0 },
  { id: "s3", day: 1, time: "11:00", dur: 50, type: "private", instr: "mai", booked: 0 },
  { id: "s4", day: 1, time: "16:00", dur: 60, type: "group", instr: null, booked: 3 },
  { id: "s5", day: 1, time: "17:00", dur: 60, type: "group", instr: null, booked: 2 },
  { id: "s6", day: 1, time: "18:30", dur: 50, type: "duo", instr: "ploy", booked: 1 },
  { id: "s7", day: 2, time: "09:00", dur: 60, type: "group", instr: null, booked: 2 },
  { id: "s8", day: 2, time: "10:00", dur: 60, type: "group", instr: null, booked: 0 },
  { id: "s9", day: 2, time: "13:00", dur: 50, type: "private", instr: "nina", booked: 0 },
  { id: "s10", day: 2, time: "17:00", dur: 60, type: "group", instr: null, booked: 1 },
  { id: "s11", day: 2, time: "18:00", dur: 60, type: "group", instr: null, booked: 3 },
  { id: "s12", day: 3, time: "08:00", dur: 60, type: "group", instr: null, booked: 0 },
  { id: "s13", day: 3, time: "09:00", dur: 60, type: "group", instr: null, booked: 1 },
  { id: "s14", day: 3, time: "12:00", dur: 50, type: "trio", instr: "ploy", booked: 1 },
  { id: "s15", day: 3, time: "16:00", dur: 60, type: "group", instr: null, booked: 2 },
  { id: "s16", day: 3, time: "17:00", dur: 60, type: "group", instr: null, booked: 3 },
  { id: "s17", day: 4, time: "09:00", dur: 60, type: "group", instr: null, booked: 1 },
  { id: "s18", day: 4, time: "10:00", dur: 60, type: "group", instr: null, booked: 2 },
  { id: "s19", day: 4, time: "11:00", dur: 90, type: "rental", instr: null, booked: 0 },
  { id: "s20", day: 4, time: "17:00", dur: 60, type: "group", instr: null, booked: 0 },
  { id: "s21", day: 4, time: "18:00", dur: 60, type: "group", instr: null, booked: 1 },
  { id: "s22", day: 5, time: "08:00", dur: 60, type: "group", instr: null, booked: 2 },
  { id: "s23", day: 5, time: "09:00", dur: 60, type: "group", instr: null, booked: 1 },
  { id: "s24", day: 5, time: "14:00", dur: 50, type: "duo", instr: "nina", booked: 0 },
  { id: "s25", day: 5, time: "16:00", dur: 60, type: "group", instr: null, booked: 3 },
  { id: "s26", day: 5, time: "17:00", dur: 60, type: "group", instr: null, booked: 2 },
  { id: "s27", day: 6, time: "09:00", dur: 60, type: "group", instr: null, booked: 1 },
  { id: "s28", day: 6, time: "10:00", dur: 60, type: "group", instr: null, booked: 2 },
  { id: "s29", day: 6, time: "11:00", dur: 60, type: "group", instr: null, booked: 0 },
  { id: "s30", day: 6, time: "14:30", dur: 50, type: "private", instr: "ploy", booked: 0 },
  { id: "s31", day: 6, time: "17:00", dur: 60, type: "group", instr: null, booked: 1 },
  { id: "s32", day: 7, time: "09:00", dur: 60, type: "group", instr: null, booked: 0 },
  { id: "s33", day: 7, time: "10:00", dur: 60, type: "group", instr: null, booked: 2 },
  { id: "s34", day: 7, time: "11:00", dur: 60, type: "group", instr: null, booked: 1 },
  { id: "s35", day: 7, time: "15:00", dur: 50, type: "trio", instr: "mai", booked: 2 },
  { id: "s36", day: 7, time: "17:00", dur: 60, type: "group", instr: null, booked: 3 },
];

/** Build the concrete start instant for a mock session, anchored to weekStart in
 * Bangkok time (so it is correct under any runtime timezone). */
function mockStartsAt(weekStart: Date, seed: MockSessionSeed): Date {
  const [h, m] = seed.time.split(":").map((n) => Number.parseInt(n, 10));
  const dayStart = addDays(weekStart, seed.day - 1);
  const { year, month0, day } = studioParts(dayStart);
  return studioInstant(year, month0, day, h ?? 0, m ?? 0);
}

function mockToBookable(weekStart: Date, seed: MockSessionSeed): BookableClass {
  const capacity = CAPACITY[seed.type];
  const booked = Math.min(seed.booked, capacity);
  const seatsLeft = Math.max(0, capacity - booked);
  return {
    id: seed.id,
    startsAt: mockStartsAt(weekStart, seed).toISOString(),
    durationMin: seed.dur,
    type: seed.type,
    typeMeta: metaFor(seed.type),
    instructor: instructorMetaFor(seed.instr),
    capacity,
    booked,
    seatsLeft,
    full: seatsLeft <= 0,
  };
}

function mockListBookableClasses(
  _viewer: ClassViewer,
  weekStart: Date,
  _now: Date,
): BookableClass[] {
  // The mock catalogue is treated as already-published & visible to all tiers so
  // the UI always has data; the real visibility filter lives on the DB path.
  return MOCK_SESSIONS.map((s) => mockToBookable(weekStart, s)).sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  );
}

function mockGetClassDetail(
  classInstanceId: string,
  _viewer: ClassViewer,
  _now: Date,
): ClassDetail | null {
  const seed = MOCK_SESSIONS.find((s) => s.id === classInstanceId) ?? MOCK_SESSIONS[0];
  if (!seed) return null;
  // Anchor the mock detail to "this" week (Monday of the current week).
  const base = mockToBookable(startOfMockWeek(), seed);
  // First `booked` positions are taken, mirroring the prototype.
  const positionList = positionsForCapacity(base.capacity);
  const positions: PositionAvailability[] = positionList.map((position, i) => ({
    position,
    taken: i < base.booked,
  }));
  return { ...base, positions };
}

/** Bangkok Monday 00:00 of the current week, used to anchor mock detail dates. */
function startOfMockWeek(now: Date = new Date()): Date {
  return studioStartOfWeekMonday(now);
}
