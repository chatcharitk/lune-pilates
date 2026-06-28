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
// All bounds are returned as [start, end) half-open intervals in the host
// timezone (the studio's local time), matching how Postgres `timestamptz`
// columns are compared in the read models.

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
 * [first-of-month 00:00, first-of-next-month 00:00).
 */
export function periodBounds(now: Date = new Date()): PeriodBounds {
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

/**
 * The [start, end) bounds of the PRIOR calendar month (the month before the one
 * containing `now`) — the comparison window for an MTD "vs last month" delta.
 * Its `end` equals the current period's `start` (the months are contiguous).
 */
export function priorPeriodBounds(now: Date = new Date()): PeriodBounds {
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  return { start, end };
}

/** Local midnight (00:00) of the day containing `d`. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/**
 * Parse a `yyyy-mm-dd` calendar day into LOCAL midnight (00:00) of that day, or
 * null when the string is absent/malformed. Strict: requires exactly four-digit
 * year, two-digit month, two-digit day, and the resulting Date must round-trip
 * (so "2026-02-31" — which JS would roll forward — is rejected). The single place
 * the sales-export date inputs are turned into instants, so a bad client value
 * fails closed to the default window rather than silently shifting the range.
 */
export function parseDay(day: string | undefined | null): Date | null {
  if (!day) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const dom = Number(m[3]);
  if (month < 1 || month > 12 || dom < 1 || dom > 31) return null;
  const d = new Date(year, month - 1, dom, 0, 0, 0, 0);
  // Reject overflow (e.g. 02-31 → Mar 03) by requiring the parts to round-trip.
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== dom) {
    return null;
  }
  return d;
}

/**
 * The [start, end) half-open instant range for a sales report bounded by two
 * INCLUSIVE calendar days (`yyyy-mm-dd`), in the studio's local time:
 *   - `start` = local midnight of `startDay`, defaulting to the FIRST of the
 *     current month (matching the Payments period) when absent/malformed;
 *   - `end`   = local midnight of the day AFTER `endDay` (so `endDay` itself is
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
  const parsedStart = parseDay(startDay);
  const start =
    parsedStart ?? new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

  const parsedEnd = parseDay(endDay);
  // INCLUSIVE end day → exclusive upper bound is the start of the NEXT day.
  const end = parsedEnd
    ? new Date(parsedEnd.getFullYear(), parsedEnd.getMonth(), parsedEnd.getDate() + 1, 0, 0, 0, 0)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);

  return { start, end };
}

/** The [start, end) bounds of the calendar day containing `now`. */
export function dayBounds(now: Date = new Date()): PeriodBounds {
  const start = startOfDay(now);
  const end = new Date(start.getTime() + 24 * 3_600_000);
  return { start, end };
}

/** The [start, end) bounds of the calendar day BEFORE the one containing `now`. */
export function priorDayBounds(now: Date = new Date()): PeriodBounds {
  const today = startOfDay(now);
  const start = new Date(today.getTime() - 24 * 3_600_000);
  return { start, end: today };
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
