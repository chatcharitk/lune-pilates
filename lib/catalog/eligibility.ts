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

import { and, eq } from "drizzle-orm";
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
