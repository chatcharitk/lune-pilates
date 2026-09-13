// Who may buy a FIRST-PURCHASE-ONLY item (trial offers).
//
// The studio's ฿1,800 trial is a taster: one private class plus a free group class,
// priced well below the normal 1:1 rate. It is meant for someone who has never
// bought before, so a regular cannot keep buying 1:1s at trial pricing with a free
// group class attached each time (owner's decision, 2026-09-08).
//
// "Has bought before" means: any charge of theirs has reached `paid`. That is the
// same signal the 1+1 promo used, and it is the honest one — a charge only reaches
// paid when the front desk has verified real money.
//
// This is a SERVER-SIDE gate. `createCheckout` refuses an ineligible purchase; the
// buy screen additionally hides the item so nobody is shown an option that will
// fail. The hiding is courtesy, the refusal is the rule (CLAUDE.md §8).

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { charges } from "@/lib/db/schema";
import { mockDataMode } from "@/lib/mock-mode";
import type { CatalogItem } from "./packages";

/**
 * True when `userId` has any charge that reached "paid" — i.e. they are an existing
 * customer and no longer eligible for a first-purchase offer.
 *
 * In mock/no-DB mode there are no charges to read, so nobody has "bought before" and
 * trial items stay visible — which is what a demo of the buy screen should show.
 */
export async function hasEverPurchased(userId: string): Promise<boolean> {
  if (mockDataMode()) return false;

  const rows = await getDb()
    .select({ id: charges.id })
    .from(charges)
    .where(and(eq(charges.userId, userId), eq(charges.status, "paid")))
    .limit(1);
  return rows.length > 0;
}

/** Whether `item` may be bought by a customer with this purchase history. */
export function isItemPurchasableBy(
  item: Pick<CatalogItem, "firstPurchaseOnly">,
  hasPurchasedBefore: boolean,
): boolean {
  return !item.firstPurchaseOnly || !hasPurchasedBefore;
}

// ───────────────────────── per-item purchase limit ─────────────────────────
//
// "Buy one get one, once per customer" (owner, 2026-09-13). Without the limit an
// introductory offer is simply a permanent half-price tariff, so the cap is part of
// the offer rather than a nicety.
//
// A purchase counts while its charge is ALIVE — pending, awaiting review, or paid —
// so someone cannot open a second checkout while the first is in review and end up
// with two. A cancelled or rejected charge hands the slot back, exactly like a promo
// redemption.

/** Charge states that hold a customer's slot on a limited item. */
const LIVE_CHARGE_STATUSES = ["pending", "awaiting_review", "paid"] as const;

/** How many times `userId` has bought each of `itemIds` (live charges only). */
export async function countPurchasesByItem(
  userId: string,
  itemIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (mockDataMode() || itemIds.length === 0) return out;

  const rows = await getDb()
    .select({ itemId: charges.packageId, n: sql<number>`count(*)::int` })
    .from(charges)
    .where(
      and(
        eq(charges.userId, userId),
        inArray(charges.packageId, itemIds),
        inArray(charges.status, [...LIVE_CHARGE_STATUSES]),
      ),
    )
    .groupBy(charges.packageId);

  for (const r of rows) out.set(r.itemId, r.n);
  return out;
}

/** How many times `userId` has bought `itemId` (live charges only). */
export async function countPurchasesOf(userId: string, itemId: string): Promise<number> {
  const counts = await countPurchasesByItem(userId, [itemId]);
  return counts.get(itemId) ?? 0;
}

/** Whether `item`'s per-customer limit still leaves room for one more purchase. */
export function withinPurchaseLimit(
  item: Pick<CatalogItem, "maxPerCustomer">,
  alreadyBought: number,
): boolean {
  return item.maxPerCustomer === undefined || alreadyBought < item.maxPerCustomer;
}
