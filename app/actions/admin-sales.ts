"use server";

// Server actions for the admin "Sales history" screen (Owner-only). Currently one
// mutation: correcting a sale's recorded date/time. A "sale" is a `charges` row;
// its `created_at` is the timestamp the history table, CSV export, and revenue
// period windows all key on — so editing it MOVES the sale between reporting
// periods (the point: the front desk sometimes records a sale late and wants the
// books to show when the money actually changed hands). Money fields (amount,
// package, method, status) are NOT editable here — corrections to those are a
// cancel/re-sell, never an in-place rewrite of a financial record.

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { charges } from "@/lib/db/schema";
import { requireOwner } from "@/lib/auth/admin";
import { mockDataMode } from "@/lib/mock-mode";

const updateSaleTimeInput = z.object({
  chargeId: z.string().min(1),
  /** The corrected sale instant, ISO 8601 (built Bangkok-pinned by the client UI). */
  soldAt: z.string().datetime({ offset: true }),
});
export type UpdateSaleTimeInput = z.infer<typeof updateSaleTimeInput>;

export type UpdateSaleTimeFailureCode = "UNAUTHORIZED" | "INVALID_INPUT" | "NOT_FOUND";

export type UpdateSaleTimeResult =
  | { ok: true; soldAt: string }
  | { ok: false; code: UpdateSaleTimeFailureCode };

/**
 * Correct WHEN a sale was recorded (charges.created_at). Owner-only. The instant
 * must be a valid ISO datetime and may not be in the future (a sale can be
 * back-dated to when it really happened, never forward-dated). No-DB dev path
 * echoes the input so the drawer works on mock data.
 */
export async function updateSaleTime(raw: UpdateSaleTimeInput): Promise<UpdateSaleTimeResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = updateSaleTimeInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const soldAt = new Date(parsed.data.soldAt);
  if (Number.isNaN(soldAt.getTime()) || soldAt.getTime() > Date.now()) {
    return { ok: false, code: "INVALID_INPUT" };
  }

  if (mockDataMode()) return { ok: true, soldAt: soldAt.toISOString() };

  const db = getDb();
  const updated = await db
    .update(charges)
    .set({ createdAt: soldAt })
    .where(eq(charges.chargeId, parsed.data.chargeId))
    .returning({ chargeId: charges.chargeId });
  if (updated.length === 0) return { ok: false, code: "NOT_FOUND" };

  // The sale timestamp feeds the history table, the Payments screen's grouping,
  // and the dashboard's revenue windows — refresh all three.
  revalidatePath("/admin/sales");
  revalidatePath("/admin/payments");
  revalidatePath("/admin/dashboard");
  return { ok: true, soldAt: soldAt.toISOString() };
}
