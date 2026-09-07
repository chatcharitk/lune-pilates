// Pure validity → expiry mapping. The single place a package's lifetime is
// computed, so every purchase path (customer checkout, admin POS, slip approval —
// all of which credit through lib/credits/creditPackage.ts) gets the same rule and
// can never drift.
//
// Validity is a STRUCTURED amount + unit (2026-07-23): the owner grants any positive
// whole number of days or months.
//
// EXPIRY IS AN INCLUSIVE, WHOLE BANGKOK DAY (decided 2026-09-07, owner's rule):
// buying on 1 September with 15 days' validity expires on 16 September, and the
// WHOLE of the 16th is still usable. So the expiry instant is the LAST MILLISECOND
// of that Bangkok day (16 Sep 23:59:59.999 +07), not the purchase time-of-day on it.
//
// Two consequences worth knowing:
//   - Time of day at purchase is irrelevant. Buying at 08:00 or at 23:50 on 1 Sep
//     gives the identical expiry, so two customers who bought "the same day" always
//     get the same deadline. Previously a late-evening buyer silently got a few more
//     usable hours than a morning buyer.
//   - The stored instant is the last valid moment, NOT an exclusive boundary. That
//     keeps `expires_at > now()` (the booking guard, lib/credits/guards.ts) correct
//     for the entire final day, AND lets every display site format `expires_at`
//     directly as the expiry date the customer was promised — 16 Sep, not 17 Sep.
//     Do not "tidy" this into a start-of-next-day boundary: that reads correctly to
//     a comparison but renders the wrong date everywhere.
//
// Side-effect-free and clock-injectable for unit tests (tests/catalog.test.ts).

import { addDays, studioEndOfDay, studioInstant, studioParts, studioStartOfDay } from "@/lib/time";
import type { ValidityUnit } from "./packages";

/**
 * The largest validity the owner may set, PER UNIT. One shared cap for both units
 * was wrong: 60 is a sane ceiling in months (5 years) but absurdly tight in days —
 * it rejected an ordinary 90-day package, and the editor blamed the hours/price
 * fields for it (2026-09-07).
 *
 * These are guard rails against a typo (a stray zero), not policy: 730 days and 60
 * months both far exceed any package the studio would really sell. Client and
 * server both check against THIS map so the two can never disagree again.
 */
export const MAX_VALIDITY_AMOUNT: Record<ValidityUnit, number> = {
  day: 730,
  month: 60,
};

/** Whether `amount` is a usable validity for `unit` (whole, positive, within cap). */
export function isValidityAmountInRange(amount: number, unit: ValidityUnit): boolean {
  return Number.isSafeInteger(amount) && amount > 0 && amount <= MAX_VALIDITY_AMOUNT[unit];
}

/**
 * The `expires_at` a package bought at `now` should carry, given its validity —
 * the last millisecond of the Bangkok day the package runs out on.
 *
 * - `day`: the Bangkok day `amount` days after the purchase day. 1 Sep + 15 days
 *   → the 16th, valid all day. (So "15 days" spans 16 calendar dates counting the
 *   purchase day; that is the studio's intended, customer-favourable reading.)
 * - `month`: the same day-of-month `amount` calendar months later, in Bangkok.
 *   Month overflow (31 Jan + 1mo) normalises FORWARD into the following month —
 *   the never-shortens direction, so an edge date can never cut a package short.
 */
export function expiryFromValidity(amount: number, unit: ValidityUnit, now: Date): Date {
  let lastDay: Date;
  if (unit === "day") {
    lastDay = addDays(studioStartOfDay(now), amount);
  } else {
    // Bangkok calendar month arithmetic: read the purchase day's Bangkok parts and
    // rebuild it `amount` months on. studioInstant normalises month overflow.
    const { year, month0, day } = studioParts(now);
    lastDay = studioInstant(year, month0 + amount, day, 0, 0);
  }
  // studioEndOfDay is the EXCLUSIVE next-midnight boundary; step back 1ms to land
  // on the last usable instant of the expiry day itself.
  return new Date(studioEndOfDay(lastDay).getTime() - 1);
}
