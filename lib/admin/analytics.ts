// Read model for the admin "Business Dashboard" / Business Overview screen
// (Feature 4; prototypes lune-pilates/project/LUNE Admin Analytics.html +
// admin-mobile-analytics.jsx). ONE call — getDashboardOverview() — assembles the
// three sections the prototype renders: 01 Sales & revenue, 02 Capacity &
// operations, 03 Retention & CRM.
//
// This is the studio's READ-ONLY god-view (CLAUDE.md §5): it exposes studio-wide
// revenue and customer PII with NO tiered visibility, it is NEVER a parallel
// source of truth, and it never mutates anything (capacity alerts merely deep-link
// to /admin/schedule — they do not touch the schedule, preserving invariant 5).
//
// MONEY & AGGREGATION (CLAUDE.md §8): every ฿ figure and every count is computed
// SERVER-SIDE via Drizzle aggregate selects (sum / count / group by /
// date_trunc) over bounded windows — never row-by-row in JS. numeric columns
// (packages.hoursLeft, bookings.creditCost) are read back as JS numbers, never
// summed as strings.
//
// REVENUE PARITY: revenue MTD/today + the revenue mix come from the SAME source
// as the Payments screen — charges.amount where status='paid' (cash basis) — and
// reuse the shared lib/admin/period.ts window math, so the dashboard's revenue
// tile is guaranteed to equal the Payments screen's revenue tile for the same
// window.
//
// No-DB dev fallback: when DATABASE_URL is unset every builder returns the
// prototype's exact illustrative figures, so the screen renders fully without a
// database. The DB path is authoritative.

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  bookings,
  charges,
  classInstances,
  creditLedger,
  households,
  instructors,
  packages,
  users,
} from "@/lib/db/schema";
import type { Bilingual } from "@/lib/i18n";
import type { ClassType, PackageCategory } from "@/lib/domain/types";
import { effectiveCapacity } from "@/lib/domain/types";
import { getCatalogItem } from "@/lib/catalog/packages";
import { instructorMetaFor } from "@/lib/schedule/queries";
import {
  dayBounds,
  pctDelta,
  periodBounds,
  priorDayBounds,
  priorPeriodBounds,
} from "@/lib/admin/period";
import { formatStudioDate, studioParts } from "@/lib/time";

// ═════════════════════════ fixed-window constants ═════════════════════════
// Every window other than the [Month to date | Today] toggle is a FIXED constant
// (the toggle only swaps which prefetched sales figure is primary; nothing
// refetches). Tunable here without a schema change.

/** Daily-revenue sparkline length (prototype: "Daily revenue · last 14 days"). */
export const SPARKLINE_DAYS = 14;
/** Fill-rate averaging window (prototype: "utilisation · last 30 days"). */
export const FILL_RATE_DAYS = 30;
/** Expiring-soon horizon (prototype: "Expiring in the next 7 days"). */
export const EXPIRING_SOON_DAYS = 7;
/** Actionable-alerts horizon (prototype: "next 24–48 h that need a decision"). */
export const ALERTS_HORIZON_HOURS = 48;

// ═════════════════════════ server-side rate constants ═════════════════════════
// These are the EARNED-revenue / liability proxies. They are deliberately
// server-side constants (never client-supplied) and the cards that use them are
// labelled so the basis is unambiguous.

/**
 * Per-INSTRUCTOR revenue is an EARNED proxy: redeemed booking hours
 * (bookings.creditCost) valued at a per-class-type ฿/hour rate. It is NOT a cash
 * figure (cash revenue is the charges-based MTD tile) — the card is labelled
 * "MTD · privates, duos & trios" so the basis is clear. Rates approximate the
 * catalog per-hour pricing for each apparatus mode.
 */
export const INSTRUCTOR_RATE_PER_HOUR: Record<ClassType, number> = {
  group: 550, // ~ group pack per-hour
  private: 1500, // ~ 1:1 pack per-hour
  duo: 1800, // ~ duo pack per-hour
  trio: 2000, // ~ trio pack per-hour
  rental: 600, // ~ rental per-hour
};

/**
 * Package liability values OUTSTANDING (unredeemed, unexpired) hours at one
 * blended ฿/hour rate. A single server-side constant — the "Unredeemed hours on
 * the books" card multiplies outstanding hours by this.
 */
export const LIABILITY_RATE_PER_HOUR = 465;

/**
 * Fill-rate trend (+pts vs the prior comparable window). We have no historical
 * fill snapshot to diff against in v1, so this is a DOCUMENTED constant proxy
 * surfaced exactly as the prototype's "+5 pts". The typed shape is stable, so a
 * later real period-over-period computation is invisible to the frontend.
 */
export const FILL_RATE_DELTA_PTS = 5;

// ═════════════════════════ contract (frontend imports these) ═════════════════════════

/** Section 01 — Sales & revenue (the hero). */
export interface SalesSection {
  /** Σ paid charge amounts this month (parity with the Payments revenue tile). */
  revenueMtd: number;
  /** Σ paid charge amounts today. */
  revenueToday: number;
  /** MTD vs last month, % (one decimal). */
  deltaMtdPct: number;
  /** Today vs yesterday, % (one decimal). */
  deltaTodayPct: number;
  /** Paid revenue per day, oldest→newest, exactly SPARKLINE_DAYS points (zero-filled). */
  dailyRevenue: { dateIso: string; amount: number }[];
  /** Paid revenue split by package category (group | private | rental), this month. */
  revenueMix: { category: PackageCategory; amount: number; pct: number }[];
  /** Σ of the mix amounts (the donut centre total). */
  revenueTotalMix: number;
  /** Trial → paying-member conversion this month (heuristic — see TRIAL note). */
  trialConversion: { converted: number; total: number; pct: number };
  /** Outstanding (unredeemed) package liability, valued server-side. */
  packageLiability: { thb: number; hoursOutstanding: number; pctOfSold: number };
  /** Earned-revenue proxy per instructor, this month (redeemed hours × rate). */
  perInstructor: {
    instructorId: string;
    name: Bilingual;
    initials: string;
    tag: Bilingual | null;
    revenue: number;
    hours: number;
  }[];
}

/** Section 02 — Capacity & daily operations. */
export interface CapacitySection {
  /** Overall group-class fill rate over the last FILL_RATE_DAYS, % (rounded). */
  fillRateOverall: number;
  /** Trend vs prior window, in percentage points. */
  fillRateDeltaPts: number;
  /** Fill rate by class type, % (rounded). */
  fillRateByType: { type: "group" | "private" | "duo" | "trio"; pct: number }[];
  /** Classes in the next ALERTS_HORIZON_HOURS needing a decision. */
  alerts: {
    classInstanceId: string;
    whenLabel: Bilingual;
    type: ClassType;
    booked: number;
    capacity: number;
    waitlistCount: number;
    tone: "warn" | "low";
    severity: "overbooked" | "low" | "empty";
  }[];
}

/** Section 03 — Retention & CRM. */
export interface RetentionSection {
  /** Packages expiring within EXPIRING_SOON_DAYS (members AND guests), soonest first. */
  expiringSoon: {
    packageId: string;
    ownerLabel: string;
    ownerSubtitle: Bilingual;
    tier: "member" | "guest";
    hoursLeft: number;
    expiresAt: string;
    expiresDisplay: string;
    userId: string;
  }[];
  /** Shared HOUSEHOLD pool usage (guest packages excluded — §5 inv 2/3). */
  houseUsage: {
    householdId: string;
    houseNumber: string;
    memberIds: string[];
    usedHours: number;
    totalHours: number;
    pct: number;
    tone: "steady" | "warn";
    burnNote: Bilingual;
  }[];
}

/** The whole Business Dashboard in one fetch. */
export interface DashboardOverview {
  period: { asOf: string; monthLabel: Bilingual };
  sales: SalesSection;
  capacity: CapacitySection;
  retention: RetentionSection;
}

// ═════════════════════════ pure helpers ═════════════════════════

const TH_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
] as const;

/** Bilingual "Month Year" label (e.g. { en: "June 2026", th: "มิ.ย. 2569" }), in
 * Bangkok time so it never shifts a month across the UTC/ICT boundary. */
export function monthLabelFor(now: Date): Bilingual {
  const { month0, year } = studioParts(now);
  const en = `${formatStudioDate(now, "en", { month: "long" })} ${year}`;
  const th = `${TH_MONTHS[month0]} ${year + 543}`;
  return { en, th };
}

/** Map a stored catalog packageId → its revenue-mix category, failing safe to group. */
export function categoryForPackageId(packageId: string): PackageCategory {
  return getCatalogItem(packageId)?.category ?? "group";
}

/** Avatar initial from a bilingual name (first letter of the last EN token). */
function initialsFor(name: Bilingual): string {
  const tokens = name.en.trim().split(/\s+/).filter(Boolean);
  const last = tokens[tokens.length - 1] ?? name.en.trim();
  return (last.charAt(0) || "?").toUpperCase();
}

/** Short "D MMM" display of an instant (e.g. "8 Jun") in Bangkok time; year added
 * if not the current Bangkok year. */
function expiresDisplay(when: Date, now: Date): string {
  const w = studioParts(when);
  const month = formatStudioDate(when, "en", { month: "short" });
  return w.year === studioParts(now).year
    ? `${w.day} ${month}`
    : `${w.day} ${month} ${w.year}`;
}

/** Bilingual relative weekday + time label for an alert class (e.g. "Wed 17:00"),
 * in Bangkok (studio) time. */
function whenLabelFor(startsAt: Date): Bilingual {
  const parts = studioParts(startsAt);
  const dayEn = formatStudioDate(startsAt, "en", { weekday: "short" });
  // ISO Mon=1 … Sun=7 → Thai short labels indexed Mon..Sun.
  const DAY_TH = ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."] as const;
  const dayTh = DAY_TH[parts.isoDow - 1]!;
  const hhmm = `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
  return { en: `${dayEn} ${hhmm}`, th: `${dayTh} ${hhmm}` };
}

/**
 * Turn a sparse map of "YYYY-MM-DD" → amount into a dense, oldest→newest series
 * of exactly `days` points ending on the day containing `now` (zero-filled).
 * Pure so it is shared by the DB and mock paths.
 */
export function denseDailyRevenue(
  byDay: ReadonlyMap<string, number>,
  now: Date,
  days = SPARKLINE_DAYS,
): { dateIso: string; amount: number }[] {
  const out: { dateIso: string; amount: number }[] = [];
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base.getTime() - i * 24 * 3_600_000);
    const key = isoDateKey(d);
    out.push({ dateIso: d.toISOString(), amount: byDay.get(key) ?? 0 });
  }
  return out;
}

/** "YYYY-MM-DD" local date key. */
function isoDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Add percentages to a category→amount mix, rounded so the visible pcts sum to
 * ~100. Pure; the donut legend reads these.
 */
export function withMixPct(
  amounts: { category: PackageCategory; amount: number }[],
): { mix: { category: PackageCategory; amount: number; pct: number }[]; total: number } {
  const total = amounts.reduce((s, a) => s + a.amount, 0);
  const mix = amounts.map((a) => ({
    ...a,
    pct: total === 0 ? 0 : Math.round((a.amount / total) * 100),
  }));
  return { mix, total };
}

// ═════════════════════════ public entry point ═════════════════════════

/**
 * The whole Business Dashboard in ONE await: the three section builders run in
 * parallel (Promise.all). The page is `dynamic = 'force-dynamic'` and awaits
 * exactly this.
 */
export async function getDashboardOverview(now: Date = new Date()): Promise<DashboardOverview> {
  const [sales, capacity, retention] = await Promise.all([
    buildSalesSection(now),
    buildCapacitySection(now),
    buildRetentionSection(now),
  ]);
  return {
    period: { asOf: now.toISOString(), monthLabel: monthLabelFor(now) },
    sales,
    capacity,
    retention,
  };
}

// ═════════════════════════ 01 · SALES ═════════════════════════

async function buildSalesSection(now: Date): Promise<SalesSection> {
  if (!process.env.DATABASE_URL) return mockSales(now);

  const db = getDb();
  const { start: mStart, end: mEnd } = periodBounds(now);
  const { start: pmStart, end: pmEnd } = priorPeriodBounds(now);
  const { start: dStart, end: dEnd } = dayBounds(now);
  const { start: pdStart, end: pdEnd } = priorDayBounds(now);

  // Cash-basis revenue (paid charges) — same source as the Payments tile.
  const paidSum = (s: Date, e: Date) =>
    db
      .select({ total: sql<number>`coalesce(sum(${charges.amount}), 0)::int` })
      .from(charges)
      .where(and(eq(charges.status, "paid"), gte(charges.createdAt, s), lt(charges.createdAt, e)));

  // 14-day sparkline: paid revenue per day via date_trunc, zero-filled in JS.
  const sparkStart = new Date(dStart.getTime() - (SPARKLINE_DAYS - 1) * 24 * 3_600_000);

  // Revenue mix: paid charges this month grouped by packageId (→ category in JS).
  // Per-instructor: redeemed bookings this month, hours (Σ creditCost) + instructor type.
  // Liability: outstanding (unexpired) hours = Σ hoursLeft; sold = Σ hoursTotal.
  const [
    [mtdRow],
    [pmRow],
    [todayRow],
    [yRow],
    sparkRows,
    mixRows,
    instrRows,
    [liabRow],
    convRows,
    instrMeta,
  ] = await Promise.all([
    paidSum(mStart, mEnd),
    paidSum(pmStart, pmEnd),
    paidSum(dStart, dEnd),
    paidSum(pdStart, pdEnd),
    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${charges.createdAt}), 'YYYY-MM-DD')`,
        total: sql<number>`coalesce(sum(${charges.amount}), 0)::int`,
      })
      .from(charges)
      .where(and(eq(charges.status, "paid"), gte(charges.createdAt, sparkStart), lt(charges.createdAt, dEnd)))
      .groupBy(sql`date_trunc('day', ${charges.createdAt})`),
    db
      .select({
        packageId: charges.packageId,
        total: sql<number>`coalesce(sum(${charges.amount}), 0)::int`,
      })
      .from(charges)
      .where(and(eq(charges.status, "paid"), gte(charges.createdAt, mStart), lt(charges.createdAt, mEnd)))
      .groupBy(charges.packageId),
    db
      .select({
        instructorId: classInstances.instructorId,
        type: classInstances.type,
        hours: sql<number>`coalesce(sum(${bookings.creditCost}), 0)::float8`,
      })
      .from(bookings)
      .innerJoin(classInstances, eq(bookings.classInstanceId, classInstances.id))
      .where(and(eq(bookings.status, "booked"), gte(bookings.createdAt, mStart), lt(bookings.createdAt, mEnd)))
      .groupBy(classInstances.instructorId, classInstances.type),
    db
      .select({
        outstanding: sql<number>`coalesce(sum(${packages.hoursLeft}), 0)::float8`,
        sold: sql<number>`coalesce(sum(${packages.hoursTotal}), 0)::float8`,
      })
      .from(packages)
      .where(gte(packages.expiresAt, now)),
    // Trial-conversion heuristic (see TRIAL note): of customers created this month,
    // how many are already members (converted) vs total customers created.
    db
      .select({
        converted: sql<number>`coalesce(sum(case when ${users.tier} = 'member' then 1 else 0 end), 0)::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(users)
      .where(and(gte(users.createdAt, mStart), lt(users.createdAt, mEnd))),
    db
      .select({ id: instructors.id, name: instructors.name, nameTh: instructors.nameTh, tag: instructors.tag })
      .from(instructors),
  ]);

  // Revenue + deltas.
  const revenueMtd = mtdRow?.total ?? 0;
  const revenueToday = todayRow?.total ?? 0;
  const deltaMtdPct = pctDelta(revenueMtd, pmRow?.total ?? 0);
  const deltaTodayPct = pctDelta(revenueToday, yRow?.total ?? 0);

  // Sparkline (zero-filled, oldest→newest).
  const byDay = new Map<string, number>(sparkRows.map((r) => [r.day, r.total]));
  const dailyRevenue = denseDailyRevenue(byDay, now);

  // Mix by category (group | private | rental).
  const catTotals = new Map<PackageCategory, number>([
    ["group", 0],
    ["private", 0],
    ["rental", 0],
  ]);
  for (const r of mixRows) {
    const cat = categoryForPackageId(r.packageId);
    catTotals.set(cat, (catTotals.get(cat) ?? 0) + r.total);
  }
  const { mix: revenueMix, total: revenueTotalMix } = withMixPct(
    [...catTotals.entries()].map(([category, amount]) => ({ category, amount })),
  );

  // Trial conversion.
  const conv = convRows[0] ?? { converted: 0, total: 0 };
  const trialConversion = {
    converted: conv.converted,
    total: conv.total,
    pct: conv.total === 0 ? 0 : Math.round((conv.converted / conv.total) * 100),
  };

  // Liability.
  const hoursOutstanding = Math.round(liabRow?.outstanding ?? 0);
  const sold = liabRow?.sold ?? 0;
  const packageLiability = {
    thb: Math.round(hoursOutstanding * LIABILITY_RATE_PER_HOUR),
    hoursOutstanding,
    pctOfSold: sold === 0 ? 0 : Math.round((hoursOutstanding / sold) * 100),
  };

  // Per-instructor earned proxy: Σ over (instructor,type) of hours × rate[type].
  const metaById = new Map(instrMeta.map((m) => [m.id, m]));
  const perInstrAcc = new Map<string, { revenue: number; hours: number }>();
  for (const r of instrRows) {
    if (!r.instructorId) continue;
    const acc = perInstrAcc.get(r.instructorId) ?? { revenue: 0, hours: 0 };
    acc.hours += r.hours;
    acc.revenue += r.hours * INSTRUCTOR_RATE_PER_HOUR[r.type];
    perInstrAcc.set(r.instructorId, acc);
  }
  const perInstructor = [...perInstrAcc.entries()]
    .map(([instructorId, acc]) => {
      const row = metaById.get(instructorId);
      const meta = instructorMetaFor(
        instructorId,
        row?.name,
        row?.nameTh ?? undefined,
        row?.tag ?? null,
      );
      const name: Bilingual = meta?.name ?? { en: instructorId, th: instructorId };
      return {
        instructorId,
        name,
        initials: initialsFor(name),
        tag: meta?.tag ?? null,
        revenue: Math.round(acc.revenue),
        hours: Math.round(acc.hours),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  return {
    revenueMtd,
    revenueToday,
    deltaMtdPct,
    deltaTodayPct,
    dailyRevenue,
    revenueMix,
    revenueTotalMix,
    trialConversion,
    packageLiability,
    perInstructor,
  };
}

// ═════════════════════════ 02 · CAPACITY ═════════════════════════

async function buildCapacitySection(now: Date): Promise<CapacitySection> {
  if (!process.env.DATABASE_URL) return mockCapacity(now);

  const db = getDb();
  const fillStart = new Date(now.getTime() - FILL_RATE_DAYS * 24 * 3_600_000);
  const alertsEnd = new Date(now.getTime() + ALERTS_HORIZON_HOURS * 3_600_000);

  const bookedCount = sql<number>`(
    select count(*)::int from ${bookings}
    where ${bookings.classInstanceId} = ${classInstances.id} and ${bookings.status} = 'booked'
  )`;
  const waitlistCount = sql<number>`(
    select count(*)::int from waitlist
    where waitlist.class_instance_id = ${classInstances.id} and waitlist.status in ('waiting','offered')
  )`;

  // Fill rate: published classes that have already started in the window.
  const fillRows = await db
    .select({
      type: classInstances.type,
      capacity: classInstances.capacity,
      booked: bookedCount,
    })
    .from(classInstances)
    .where(
      and(
        eq(classInstances.status, "published"),
        gte(classInstances.startsAt, fillStart),
        lt(classInstances.startsAt, now),
      ),
    );

  const { overall, byType } = computeFillRates(fillRows);

  // Alerts: published, upcoming within the horizon, that need a decision.
  const alertRows = await db
    .select({
      id: classInstances.id,
      startsAt: classInstances.startsAt,
      type: classInstances.type,
      capacity: classInstances.capacity,
      booked: bookedCount,
      waitlistCount,
    })
    .from(classInstances)
    .where(
      and(
        eq(classInstances.status, "published"),
        gte(classInstances.startsAt, now),
        lt(classInstances.startsAt, alertsEnd),
      ),
    )
    .orderBy(classInstances.startsAt);

  const alerts = alertRows
    .map((r) => buildAlert(r.id, r.startsAt, r.type, r.booked ?? 0, r.capacity, r.waitlistCount ?? 0))
    .filter((a): a is NonNullable<typeof a> => a !== null);

  return { fillRateOverall: overall, fillRateDeltaPts: FILL_RATE_DELTA_PTS, fillRateByType: byType, alerts };
}

/**
 * Roll instance rows into an overall (group-only) fill rate + a per-type
 * breakdown. Pure (no I/O) so it is unit-testable and shared with the mock.
 */
export function computeFillRates(
  rows: readonly { type: ClassType; capacity: number; booked: number }[],
): {
  overall: number;
  byType: { type: "group" | "private" | "duo" | "trio"; pct: number }[];
} {
  const acc = new Map<ClassType, { booked: number; cap: number }>();
  for (const r of rows) {
    const cap = effectiveCapacity(r.capacity, r.type);
    const a = acc.get(r.type) ?? { booked: 0, cap: 0 };
    a.booked += Math.min(r.booked, cap);
    a.cap += cap;
    acc.set(r.type, a);
  }
  const rate = (t: ClassType): number => {
    const a = acc.get(t);
    return a && a.cap > 0 ? Math.round((a.booked / a.cap) * 100) : 0;
  };
  const group = acc.get("group");
  const overall = group && group.cap > 0 ? Math.round((group.booked / group.cap) * 100) : 0;
  return {
    overall,
    byType: (["group", "private", "duo", "trio"] as const).map((type) => ({ type, pct: rate(type) })),
  };
}

/**
 * Classify one upcoming class into an alert, or null when it needs no decision
 * (healthy: some bookings, no excess waitlist). Pure & unit-testable.
 *   - overbooked → full AND waitlist demand (warn): "add a class"
 *   - empty      → 0 booked (low): "promote / cancel"
 *   - low        → < half capacity booked (low): "promote / cancel"
 */
export function buildAlert(
  classInstanceId: string,
  startsAt: Date,
  type: ClassType,
  booked: number,
  rawCapacity: number,
  waitlistCount: number,
): CapacitySection["alerts"][number] | null {
  const capacity = effectiveCapacity(rawCapacity, type);
  if (booked >= capacity && waitlistCount > 0) {
    return { classInstanceId, whenLabel: whenLabelFor(startsAt), type, booked, capacity, waitlistCount, tone: "warn", severity: "overbooked" };
  }
  if (booked === 0) {
    return { classInstanceId, whenLabel: whenLabelFor(startsAt), type, booked, capacity, waitlistCount, tone: "low", severity: "empty" };
  }
  if (booked * 2 < capacity) {
    return { classInstanceId, whenLabel: whenLabelFor(startsAt), type, booked, capacity, waitlistCount, tone: "low", severity: "low" };
  }
  return null;
}

// ═════════════════════════ 03 · RETENTION ═════════════════════════

async function buildRetentionSection(now: Date): Promise<RetentionSection> {
  if (!process.env.DATABASE_URL) return mockRetention(now);

  const db = getDb();
  const horizon = new Date(now.getTime() + EXPIRING_SOON_DAYS * 24 * 3_600_000);

  // Expiring soon: any package (member or guest) expiring within the horizon.
  const expRows = await db
    .select({
      packageId: packages.id,
      hoursLeft: packages.hoursLeft,
      expiresAt: packages.expiresAt,
      ownerHouseholdId: packages.ownerHouseholdId,
      ownerUserId: packages.ownerUserId,
      houseNumber: households.houseNumber,
      userName: users.name,
      userId: users.id,
      tier: users.tier,
    })
    .from(packages)
    .leftJoin(households, eq(packages.ownerHouseholdId, households.id))
    .leftJoin(users, eq(packages.ownerUserId, users.id))
    .where(and(gte(packages.expiresAt, now), lt(packages.expiresAt, horizon), sql`${packages.hoursLeft} > 0`))
    .orderBy(packages.expiresAt);

  const expiringSoon = expRows.map((r) => {
    const isGuest = r.ownerUserId !== null;
    const exp = r.expiresAt;
    return {
      packageId: r.packageId,
      ownerLabel: r.userName ?? (r.houseNumber ? `House ${r.houseNumber}` : "—"),
      ownerSubtitle: isGuest
        ? { en: "Guest", th: "ทั่วไป" }
        : { en: r.houseNumber ? `Member · House ${r.houseNumber}` : "Member", th: r.houseNumber ? `สมาชิก · บ้าน ${r.houseNumber}` : "สมาชิก" },
      tier: isGuest ? ("guest" as const) : ("member" as const),
      hoursLeft: Math.round(r.hoursLeft),
      expiresAt: exp.toISOString(),
      expiresDisplay: expiresDisplay(exp, now),
      userId: r.userId ?? "",
    };
  });

  // House usage: HOUSEHOLD-owned packages only (guest/ownerUserId packages
  // excluded — §5 inv 2/3). Used hours derived from the ledger (the truth):
  // used = Σ(−delta) for booking-type debits, reconciled against (total − left).
  const houseRows = await db
    .select({
      householdId: households.id,
      houseNumber: households.houseNumber,
      totalHours: sql<number>`coalesce(sum(${packages.hoursTotal}), 0)::float8`,
      leftHours: sql<number>`coalesce(sum(${packages.hoursLeft}), 0)::float8`,
    })
    .from(households)
    .innerJoin(packages, eq(packages.ownerHouseholdId, households.id))
    .where(gte(packages.expiresAt, now))
    .groupBy(households.id, households.houseNumber);

  // Members per household (for avatars / count).
  const memberRows = await db
    .select({ householdId: users.householdId, userId: users.id })
    .from(users)
    .where(sql`${users.householdId} is not null`);
  const membersByHouse = new Map<string, string[]>();
  for (const m of memberRows) {
    if (!m.householdId) continue;
    const list = membersByHouse.get(m.householdId) ?? [];
    list.push(m.userId);
    membersByHouse.set(m.householdId, list);
  }

  const houseUsage = houseRows
    .map((h) => {
      const totalHours = Math.round(h.totalHours);
      const usedHours = Math.round(h.totalHours - h.leftHours);
      const memberIds = membersByHouse.get(h.householdId) ?? [];
      return buildHouseUsage(h.householdId, h.houseNumber, memberIds, usedHours, totalHours);
    })
    .sort((a, b) => b.pct - a.pct);

  return { expiringSoon, houseUsage };
}

/**
 * Shape one household's usage card + classify its burn tone. Pure &
 * unit-testable. `warn` when ≥ 80% of the shared pool is consumed (renewal
 * nudge), else `steady`.
 */
export function buildHouseUsage(
  householdId: string,
  houseNumber: string,
  memberIds: string[],
  usedHours: number,
  totalHours: number,
): RetentionSection["houseUsage"][number] {
  const pct = totalHours === 0 ? 0 : Math.round((usedHours / totalHours) * 100);
  const tone: "steady" | "warn" = pct >= 80 ? "warn" : "steady";
  const burnNote: Bilingual =
    tone === "warn"
      ? { en: "Nearly spent · prompt a renewal soon", th: "ใกล้หมด · ควรเตือนต่ออายุเร็ว ๆ นี้" }
      : { en: `Steady · ${memberIds.length} members · healthy runway`, th: `สม่ำเสมอ · ${memberIds.length} สมาชิก · เหลือใช้ได้อีกพอ` };
  return { householdId, houseNumber, memberIds, usedHours, totalHours, pct, tone, burnNote };
}

// suppress unused import warning for creditLedger (referenced in the derivation
// note above; kept imported so a future ledger-based reconciliation is one edit).
void creditLedger;

// ═════════════════════════ no-DB mock fallback ═════════════════════════
// Mirrors lune-pilates/project/LUNE Admin Analytics.html (desktop canonical) +
// admin-mobile-analytics.jsx so the dashboard renders fully without a database.
// Figures are the prototype's exact illustrative numbers. The DB path is the
// authoritative one.

function mockSales(now: Date): SalesSection {
  // 14-day bars (prototype: thousands of ฿) → exact ฿ amounts, oldest→newest.
  const bars = [12.1, 9.4, 14.8, 11.2, 16.0, 18.9, 22.4, 13.1, 15.6, 12.8, 17.2, 19.5, 14.9, 18.4];
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const dailyRevenue = bars.map((v, i) => ({
    dateIso: new Date(base.getTime() - (bars.length - 1 - i) * 24 * 3_600_000).toISOString(),
    amount: Math.round(v * 1000),
  }));

  const revenueMix: SalesSection["revenueMix"] = [
    { category: "group", amount: 198_000, pct: 58 },
    { category: "private", amount: 112_800, pct: 33 },
    { category: "rental", amount: 31_000, pct: 9 },
  ];
  const revenueTotalMix = revenueMix.reduce((s, m) => s + m.amount, 0);

  const perInstructor: SalesSection["perInstructor"] = [
    { instructorId: "mai", revenue: 128_400, hours: 96 },
    { instructorId: "ploy", revenue: 96_200, hours: 78 },
    { instructorId: "nina", revenue: 71_600, hours: 61 },
  ].map((r) => {
    const meta = instructorMetaFor(r.instructorId)!;
    return { instructorId: r.instructorId, name: meta.name, initials: initialsFor(meta.name), tag: meta.tag, revenue: r.revenue, hours: r.hours };
  });

  return {
    revenueMtd: 341_800,
    revenueToday: 18_400,
    deltaMtdPct: 10.4,
    deltaTodayPct: 23,
    dailyRevenue,
    revenueMix,
    revenueTotalMix,
    trialConversion: { converted: 32, total: 50, pct: 64 },
    packageLiability: { thb: 284_500, hoursOutstanding: 612, pctOfSold: 38 },
    perInstructor,
  };
}

function mockCapacity(now: Date): CapacitySection {
  const at = (deltaHours: number): Date => new Date(now.getTime() + deltaHours * 3_600_000);
  return {
    fillRateOverall: 78,
    fillRateDeltaPts: FILL_RATE_DELTA_PTS,
    fillRateByType: [
      { type: "group", pct: 82 },
      { type: "private", pct: 71 },
      { type: "duo", pct: 68 },
      { type: "trio", pct: 60 },
    ],
    alerts: [
      { classInstanceId: "mock-a1", whenLabel: whenLabelFor(at(20)), type: "group", booked: 3, capacity: 3, waitlistCount: 5, tone: "warn", severity: "overbooked" },
      { classInstanceId: "mock-a2", whenLabel: whenLabelFor(at(34)), type: "group", booked: 1, capacity: 3, waitlistCount: 0, tone: "low", severity: "low" },
      { classInstanceId: "mock-a3", whenLabel: whenLabelFor(at(46)), type: "group", booked: 0, capacity: 3, waitlistCount: 0, tone: "low", severity: "empty" },
    ],
  };
}

function mockRetention(now: Date): RetentionSection {
  const exp = (daysAhead: number): Date => new Date(now.getTime() + daysAhead * 24 * 3_600_000);
  const expRow = (
    packageId: string,
    ownerLabel: string,
    subtitleEn: string,
    subtitleTh: string,
    tier: "member" | "guest",
    hoursLeft: number,
    daysAhead: number,
    userId: string,
  ): RetentionSection["expiringSoon"][number] => {
    const e = exp(daysAhead);
    return {
      packageId,
      ownerLabel,
      ownerSubtitle: { en: subtitleEn, th: subtitleTh },
      tier,
      hoursLeft,
      expiresAt: e.toISOString(),
      expiresDisplay: expiresDisplay(e, now),
      userId,
    };
  };

  const expiringSoon: RetentionSection["expiringSoon"] = [
    expRow("mock-x1", "Mind Arunee", "Guest · 5-hr pack", "ทั่วไป · แพ็ก 5 ชม.", "guest", 1, 1, "m6"),
    expRow("mock-x2", "Title Nattha", "Guest · drop-in credit", "ทั่วไป · เครดิตดรอปอิน", "guest", 1, 2, "m9"),
    expRow("mock-x3", "Nok Charoen", "Member · House B-203", "สมาชิก · บ้าน B-203", "member", 2, 4, "m2"),
    expRow("mock-x4", "June Wattana", "Guest · House A-114", "ทั่วไป · บ้าน A-114", "guest", 2, 5, "m3"),
  ];

  const houseUsage: RetentionSection["houseUsage"] = [
    buildHouseUsage("mock-h1", "B-203", ["m2"], 14, 16), // 88% → warn
    buildHouseUsage("mock-h2", "A-114", ["m1", "m7", "m3"], 12, 20), // 60% → steady
    buildHouseUsage("mock-h3", "C-007", ["m4", "m5"], 8, 24), // 33% → steady
  ];

  return { expiringSoon, houseUsage };
}
