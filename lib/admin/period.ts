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
