// Pure validity → expiry mapping. The single place a package's lifetime is
// computed, so purchase crediting and any future renewal logic can never drift.
//
// Per the 2026-06-17 decision (see CLAUDE.md §1 pricing): drop-in / single-visit
// packs still need a window to use their one credit, so they get 1 month.
//
// Side-effect-free and clock-injectable for unit tests (tests/catalog.test.ts).

import type { Validity } from "./packages";

/** Whole-month window each validity grants, measured from the purchase instant. */
const VALIDITY_MONTHS: Record<Validity, number> = {
  single_visit: 1,
  one_month: 1,
  two_months: 2,
  three_months: 3,
};

/**
 * The `expires_at` a package bought at `now` should carry, given its `validity`.
 *
 * Adds whole calendar months to `now`. Uses UTC month arithmetic so the result
 * is deterministic and DST-independent; month overflow (e.g. Jan 31 + 1mo) is
 * handled by JS Date normalisation (rolls into the following month), which is the
 * safe, never-shortens direction for an expiry.
 */
export function expiryFromValidity(validity: Validity, now: Date): Date {
  const months = VALIDITY_MONTHS[validity];
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}
