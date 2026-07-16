// Void a sale (a `charges` row) from the admin Sales-history screen and reverse the
// credit it granted — the money-safe inverse of creditPackage. Owner-initiated
// (the front desk voids a mis-entered / duplicate / test sale).
//
// Like every money path (CLAUDE.md §5 inv 1) this is ONE transaction, all-or-nothing,
// row-locked, and the append-only ledger stays the source of truth:
//   - A charge that never credited (pending / awaiting_review / rejected) is simply
//     flipped to "cancelled" — no ledger movement (there is nothing to reverse).
//   - A "paid" charge created exactly one package (packages.purchase_charge_id =
//     chargeId). We claw back the STILL-UNUSED credits on that package by appending a
//     `−hoursLeft` ledger row (reason "purchase_cancelled") and zeroing hours_left,
//     then flip the charge to "cancelled". We reverse ONLY what is unused, so the
//     balance can never go negative and any credits already spent on bookings stay
//     spent (those classes remain booked — the owner settles the refund off-app).
//
// The reversal is idempotent-safe by construction: a second cancel sees status
// "cancelled" and returns ALREADY_CANCELLED without touching the ledger again.

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { charges, creditLedger, packages } from "@/lib/db/schema";

export type CancelSaleOutcome =
  | {
      ok: true;
      /** true when the voided charge had been credited (a package existed to reverse). */
      wasPaid: boolean;
      /** Unused credits clawed back by this cancel (0 when nothing was credited/left). */
      reversedHours: number;
      /** Credits already spent on bookings that REMAIN spent (0 when none/unpaid). */
      spentHours: number;
    }
  | { ok: false; code: "NOT_FOUND" | "ALREADY_CANCELLED" };

/**
 * Cancel the sale `chargeId` and reverse its unused credit, atomically. See the
 * module header for the reversal rule. `now` is accepted for testability.
 */
export async function applySaleCancellation(params: {
  chargeId: string;
  /** Optional audit note stored on the reversal ledger row (the owner's reason). */
  note?: string;
  now?: Date;
}): Promise<CancelSaleOutcome> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [charge] = await tx
      .select()
      .from(charges)
      .where(eq(charges.chargeId, params.chargeId))
      .for("update");
    if (!charge) return { ok: false, code: "NOT_FOUND" } as const;
    if (charge.status === "cancelled") return { ok: false, code: "ALREADY_CANCELLED" } as const;

    const wasPaid = charge.status === "paid";
    let reversedHours = 0;
    let spentHours = 0;

    if (wasPaid) {
      // The single package this charge created (purchase_charge_id is UNIQUE).
      const [pkg] = await tx
        .select()
        .from(packages)
        .where(eq(packages.purchaseChargeId, params.chargeId))
        .for("update");
      if (pkg) {
        spentHours = pkg.hoursTotal - pkg.hoursLeft;
        reversedHours = pkg.hoursLeft; // claw back only the unused remainder — never negative
        if (reversedHours > 0) {
          await tx.insert(creditLedger).values({
            packageId: pkg.id,
            delta: -reversedHours,
            actorUserId: charge.userId,
            reason: "purchase_cancelled",
            note: params.note ?? null,
          });
          await tx
            .update(packages)
            .set({ hoursLeft: pkg.hoursLeft - reversedHours })
            .where(eq(packages.id, pkg.id));
        }
      }
    }

    await tx.update(charges).set({ status: "cancelled" }).where(eq(charges.chargeId, params.chargeId));
    return { ok: true, wasPaid, reversedHours, spentHours } as const;
  });
}
