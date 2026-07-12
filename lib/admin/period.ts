// Shared accounting-period math for the admin read models.
//
// The Payments screen (lib/admin/payments.ts) and the Business Dashboard
// (lib/admin/analytics.ts) BOTH roll revenue up over the same windows. To
// guarantee they can never drift — the dashboard's "Revenue · MTD" tile MUST
// equal the Payments screen's revenue tile for the same month — the
// current-month bounds, the prior-period bounds (for vs-last-month deltas), and
// the percentage-delta formula live HERE, in one place, and both modules import
// them. There is no second copy to fall out of sync.
//
// ALL bounds are Bangkok (Asia/Bangkok, UTC+7) wall-clock instants, built on the
// lib/time.ts studio helpers — NEVER the runtime timezone (Vercel runs UTC, so
// host-local `new Date(y, m, d)` math would make "today" miss 00:00–07:00
// Bangkok sales and roll months at 07:00). Returned as [start, end) half-open
// intervals — correct UTC instants of the Bangkok day/week/month/year edges —
// matching how Postgres `timestamptz` columns are compared in the read models.
// Pure date math (no I/O, no DB) so the module stays client-importable.

import {
  addDays,
  studioInstant,
  studioParts,
  studioStartOfDay,
  studioStartOfWeekMonday,
} from "@/lib/time";

/**
 * The named accounting window the stat tiles roll up. The prototype labels it
 * "Revenue · June"; we scope to the CURRENT CALENDAR MONTH so the figures match
 * a front desk reading "this month so far". Change here to retune the window
 * without touching callers.
 */
export const PERIOD = "current_month" as const;

/** A half-open [start, end) instant range. */
export interface PeriodBounds {
  start: Date;
  end: Date;
}

/**
 * The [start, end) bounds of the current-month period containing `now`:
 * [first-of-month 00:00, first-of-next-month 00:00), Bangkok wall clock.
 */
export function periodBounds(now: Date = new Date()): PeriodBounds {
  const { year, month0 } = studioParts(now);
  // studioInstant delegates to Date.UTC, which normalises a month0 of 12 into
  // January of the next year — no manual rollover needed.
  const start = studioInstant(year, month0, 1, 0, 0);
  const end = studioInstant(year, month0 + 1, 1, 0, 0);
  return { start, end };
}

/**
 * The [start, end) bounds of the PRIOR calendar month (the month before the one
 * containing `now`, Bangkok time) — the comparison window for an MTD "vs last
 * month" delta. Its `end` equals the current period's `start` (contiguous).
 */
export function priorPeriodBounds(now: Date = new Date()): PeriodBounds {
  const { year, month0 } = studioParts(now);
  const start = studioInstant(year, month0 - 1, 1, 0, 0);
  const end = studioInstant(year, month0, 1, 0, 0);
  return { start, end };
}

/** Bangkok midnight (00:00 ICT) of the Bangkok calendar day containing `d`. */
export function startOfDay(d: Date): Date {
  return studioStartOfDay(d);
}

/**
 * Parse a `yyyy-mm-dd` calendar day into BANGKOK midnight (00:00 ICT) of that
 * day, or null when the string is absent/malformed. Strict: requires exactly
 * four-digit year, two-digit month, two-digit day, and the resulting instant
 * must round-trip in Bangkok time (so "2026-02-31" — which JS would roll
 * forward — is rejected). The single place the sales-export date inputs are
 * turned into instants, so a bad client value fails closed to the default
 * window rather than silently shifting the range.
 */
export function parseDay(day: string | undefined | null): Date | null {
  if (!day) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const dom = Number(m[3]);
  if (month < 1 || month > 12 || dom < 1 || dom > 31) return null;
  const instant = studioInstant(year, month - 1, dom, 0, 0);
  // Reject overflow (e.g. 02-31 → Mar 03) by requiring the Bangkok parts to
  // round-trip.
  const p = studioParts(instant);
  if (p.year !== year || p.month0 !== month - 1 || p.day !== dom) return null;
  return instant;
}

/**
 * The [start, end) half-open instant range for a sales report bounded by two
 * INCLUSIVE calendar days (`yyyy-mm-dd`), in Bangkok (studio) time:
 *   - `start` = Bangkok midnight of `startDay`, defaulting to the FIRST of the
 *     current Bangkok month (matching the Payments period) when absent/malformed;
 *   - `end`   = Bangkok midnight of the day AFTER `endDay` (so `endDay` itself is
 *     INCLUDED — the half-open upper bound is start-of-(endDay + 1)), defaulting
 *     to start-of-TOMORROW (so "today" is included) when absent/malformed.
 * Period math stays single-sourced HERE so the export and any future report can
 * never drift from the Payments/Dashboard windows.
 */
export function rangeBounds(
  startDay?: string | null,
  endDay?: string | null,
  now: Date = new Date(),
): PeriodBounds {
  const start = parseDay(startDay) ?? periodBounds(now).start;

  const parsedEnd = parseDay(endDay);
  // INCLUSIVE end day → exclusive upper bound is the start of the NEXT Bangkok
  // day. (Exact +24h is safe: ICT has no DST.)
  const end = parsedEnd ? addDays(parsedEnd, 1) : addDays(studioStartOfDay(now), 1);

  return { start, end };
}

/** The [start, end) bounds of the Bangkok calendar day containing `now`. */
export function dayBounds(now: Date = new Date()): PeriodBounds {
  const start = studioStartOfDay(now);
  return { start, end: addDays(start, 1) };
}

/** The [start, end) bounds of the Bangkok calendar day BEFORE the one containing `now`. */
export function priorDayBounds(now: Date = new Date()): PeriodBounds {
  const today = studioStartOfDay(now);
  return { start: addDays(today, -1), end: today };
}

// ───────────────────────── sales preset ranges ─────────────────────────
// The Sales history page offers quick-pick range buttons (Today / This week / This
// month / This year). Each preset maps to the SAME half-open [start, end) shape as
// rangeBounds (end exclusive), so the page can feed a preset straight into the same
// query window. These are PURE Bangkok-wall-clock date math — client-importable
// (no I/O, no DB), so the frontend buttons can compute the from/to instantly.

/**
 * The [start, end) bounds of the Bangkok calendar day containing `now`:
 * [00:00 today, 00:00 tomorrow) ICT. Alias of dayBounds, named for the sales presets.
 */
export function todayBounds(now: Date = new Date()): PeriodBounds {
  return dayBounds(now);
}

/**
 * The [start, end) bounds of the Mon–Sun Bangkok week containing `now`:
 * [Monday 00:00, next Monday 00:00) ICT. Monday-first to match the studio week
 * (classTemplates day_of_week 1=Mon … 7=Sun), via studioStartOfWeekMonday in
 * lib/time.ts.
 */
export function weekBounds(now: Date = new Date()): PeriodBounds {
  const start = studioStartOfWeekMonday(now);
  return { start, end: addDays(start, 7) };
}

/**
 * The [start, end) bounds of the Bangkok calendar month containing `now`:
 * [first-of-month 00:00, first-of-next-month 00:00) ICT. Identical to
 * periodBounds — aliased here so the preset family reads consistently.
 */
export function monthBounds(now: Date = new Date()): PeriodBounds {
  return periodBounds(now);
}

/**
 * The [start, end) bounds of the Bangkok calendar year containing `now`:
 * [Jan 1 00:00, next-year Jan 1 00:00) ICT.
 */
export function yearBounds(now: Date = new Date()): PeriodBounds {
  const { year } = studioParts(now);
  return { start: studioInstant(year, 0, 1, 0, 0), end: studioInstant(year + 1, 0, 1, 0, 0) };
}

/** The quick-pick sales ranges the history page exposes as buttons. */
export type SalesRangePreset = "today" | "week" | "month" | "year";

/**
 * A resolved preset range: the half-open [start, end) instants PLUS the inclusive
 * `yyyy-mm-dd` day strings the sales page's from/to inputs use. `toDay` is the LAST
 * included calendar day (end is exclusive, so it is the day BEFORE `end`), matching
 * rangeBounds' inclusive-end-day convention — so feeding {fromDay, toDay} back into
 * rangeBounds reproduces the same window.
 */
export interface PresetRange extends PeriodBounds {
  preset: SalesRangePreset;
  /** Inclusive start day, `yyyy-mm-dd` (Bangkok). */
  fromDay: string;
  /** Inclusive end day, `yyyy-mm-dd` (Bangkok) — the day before the exclusive `end`. */
  toDay: string;
}

/** Bangkok `yyyy-mm-dd` of an instant (host-TZ-independent). */
function toDayString(d: Date): string {
  const { year, month0, day } = studioParts(d);
  return `${year}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Resolve a sales quick-pick `preset` to its [start, end) bounds plus the inclusive
 * `yyyy-mm-dd` from/to day strings the page's date inputs bind to. Pure date math so
 * the frontend can map a button → from/to without a round-trip. `toDay` is the last
 * INCLUDED Bangkok day (one day before the exclusive `end`).
 */
export function presetRange(preset: SalesRangePreset, now: Date = new Date()): PresetRange {
  const bounds =
    preset === "today"
      ? todayBounds(now)
      : preset === "week"
        ? weekBounds(now)
        : preset === "year"
          ? yearBounds(now)
          : monthBounds(now);
  // Inclusive last day = the Bangkok day before the exclusive upper bound.
  // Exact −24h is safe: ICT observes no DST.
  const lastDay = addDays(bounds.end, -1);
  return {
    preset,
    start: bounds.start,
    end: bounds.end,
    fromDay: toDayString(bounds.start),
    toDay: toDayString(lastDay),
  };
}

/**
 * Percentage change from `prev` to `curr`, rounded to one decimal place.
 *   - prev > 0           → ((curr − prev) / prev) × 100
 *   - prev === 0, curr>0 → 100 (grew from nothing; avoids Infinity)
 *   - prev === 0, curr=0 → 0   (no change from nothing)
 * Pure and unit-testable; the single definition of the dashboard's deltas.
 */
export function pctDelta(curr: number, prev: number): number {
  if (prev === 0) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}
