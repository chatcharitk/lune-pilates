// Pure validity → expiry mapping. The single place a package's lifetime is
// computed, so purchase crediting and any future renewal logic can never drift.
//
// Validity is a STRUCTURED amount + unit (2026-07-23): the owner grants any positive
// whole number of days or months. Months use UTC calendar-month arithmetic (the
// deterministic, never-shortens direction); days add exact 24h multiples.
//
// Side-effect-free and clock-injectable for unit tests (tests/catalog.test.ts).

import type { ValidityUnit } from "./packages";

/**
 * The `expires_at` a package bought at `now` should carry, given its validity.
 *
 * - `month`: adds `amount` whole calendar months via UTC month arithmetic. Month
 *   overflow (e.g. Jan 31 + 1mo) is normalised forward by JS Date (rolls into the
 *   following month), the safe never-shortens direction for an expiry.
 * - `day`: adds `amount × 24h` exactly (DST-independent — the studio is UTC+7, no DST).
 */
export function expiryFromValidity(amount: number, unit: ValidityUnit, now: Date): Date {
  const d = new Date(now.getTime());
  if (unit === "day") {
    d.setTime(d.getTime() + amount * 24 * 3_600_000);
    return d;
  }
  d.setUTCMonth(d.getUTCMonth() + amount);
  return d;
}
