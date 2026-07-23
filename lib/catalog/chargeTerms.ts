// The purchased-terms snapshot: what an ALREADY-PAID charge is entitled to,
// independent of what the catalog says today.
//
// WHY THIS EXISTS. The purchasable catalog became owner-editable at runtime
// (`catalog_items`, app/actions/admin-catalog.ts). Crediting used to re-resolve the
// catalog item LIVE at approval time, which opened a real window — hours to days
// wide, since a slip sits in `awaiting_review` until the front desk gets to it:
//
//   customer opens checkout for p10 (10h / ฿5,500) and uploads a slip
//     → owner edits p10 to 20h
//       → front desk approves → 20 HOURS GRANTED FOR A ฿5,500 PAYMENT.
//
// The reverse (10h → 5h) shortchanges a customer who already paid, and nothing in
// the ledger records the mismatch. That is a CLAUDE.md §8 violation in substance:
// the customer paid against terms the server no longer honours.
//
// THE FIX. `charges` stores the terms at charge-creation time (hours / validity /
// category — `amount` already froze the price), and every credit path grants from
// THAT SNAPSHOT. The live catalog item is still resolved, but only for its display
// label and as the legacy fallback below.
//
// This also closes the archive window (audit H1) by construction: archiving an item
// no longer changes what a pending charge grants, because the pending charge stopped
// depending on the item's current values the moment it was created.
//
// LEGACY FALLBACK. `hours`/`validity`/`category` are NULLABLE: charges written before
// these columns existed carry no snapshot. For those rows we fall back to the live
// catalog item — exactly the pre-existing behaviour — because a partially-honoured
// grant would be worse than the old one, and those rows can never gain a snapshot
// retroactively (the terms they were sold under are simply not recorded anywhere).

import type { PackageCategory } from "@/lib/domain/types";
import type { CatalogItem, Validity, ValidityUnit } from "@/lib/catalog/packages";
import { legacyValidityText, validityFromRow } from "@/lib/catalog/packages";

/**
 * The snapshot columns as they come off a `charges` row (all nullable = legacy).
 * `validity` is the DEAD legacy free-text column; `validityAmount`/`validityUnit` are
 * the structured pair (2026-07-23). A snapshot "has a validity" if EITHER is present.
 */
export interface ChargeTermsSnapshot {
  hours: number | null;
  validity: string | null;
  validityAmount: number | null;
  validityUnit: string | null;
  category: PackageCategory | null;
}

/**
 * The catalog item to CREDIT for a charge: the live item with its hours, validity
 * and category overridden by the terms the charge was sold under.
 *
 * `id`, `label`, `price` and `perHour` deliberately stay LIVE — they are display /
 * audit fields, and `id` in particular must remain the real catalog id because the
 * 1+1 trial promo keys off the literal "drop" (lib/credits/creditPackage.ts) and
 * `packages.type` must keep resolving through `getCatalogItem`.
 *
 * A snapshot counts only when hours + category are present AND the row carries a
 * validity (structured columns OR the legacy text). A half-written row would silently
 * mix paid-for terms with current ones, so it is treated as legacy (fall back to live).
 */
export function itemForCredit(live: CatalogItem, snapshot: ChargeTermsSnapshot): CatalogItem {
  const hasValidity =
    (snapshot.validityAmount !== null && snapshot.validityUnit !== null) ||
    snapshot.validity !== null;
  const complete = snapshot.hours !== null && snapshot.category !== null && hasValidity;
  if (!complete) return live; // legacy row — pre-snapshot behaviour, see the header

  return {
    ...live,
    hours: snapshot.hours!,
    validity: validityFromRow(snapshot.validityAmount, snapshot.validityUnit, snapshot.validity),
    category: snapshot.category!,
  };
}

/**
 * The snapshot to WRITE when opening a charge for `item` — one place, all sites.
 * Writes BOTH the structured pair AND the legacy text (so a downstream reader that
 * only knows the old column still resolves the terms).
 */
export function termsSnapshotFor(item: CatalogItem): {
  hours: number;
  validity: string;
  validityAmount: number;
  validityUnit: ValidityUnit;
  category: PackageCategory;
} {
  return {
    hours: item.hours,
    validity: legacyValidityText(item.validity),
    validityAmount: item.validity.amount,
    validityUnit: item.validity.unit,
    category: item.category,
  };
}

// Re-exported for callers that build a snapshot object directly (kept for parity).
export type { Validity };
