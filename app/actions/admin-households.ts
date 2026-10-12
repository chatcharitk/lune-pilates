"use server";

// Owner action for the Households screen (2026-10-12): "delete" a house nobody lives
// in. The household row itself stays — its packages and their append-only ledger
// rows reference it, and that history is the books (CLAUDE.md §5). What deleting
// does is END the house: every class still usable on its packages is written off with
// a `−hours_left` ledger row (reason "adjustment", with the owner's note), so the
// cache keeps reconciling to the ledger. A house with no members and no classes is
// already hidden from the list (lib/admin/households.ts), so it disappears; and if
// the house number is given to someone later, it starts empty.

import { and, asc, eq, gt, isNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { creditLedger, households, packages, users } from "@/lib/db/schema";
import { requireOwner } from "@/lib/auth/admin";
import { mockDataMode } from "@/lib/mock-mode";

const deleteInput = z.object({
  householdId: z.string().uuid(),
  /** Optional reason, stored on the write-off ledger rows. */
  note: z.string().trim().max(300).optional(),
});
export type DeleteHouseholdInput = z.infer<typeof deleteInput>;

export type DeleteHouseholdResult =
  | { ok: true; writtenOff: number }
  | { ok: false; code: "UNAUTHORIZED" | "INVALID_INPUT" | "NOT_FOUND" | "HAS_MEMBERS" };

export async function deleteHousehold(raw: DeleteHouseholdInput): Promise<DeleteHouseholdResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = deleteInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const { householdId, note } = parsed.data;

  if (mockDataMode()) return { ok: true, writtenOff: 0 };

  const result = await getDb().transaction(async (tx) => {
    const [house] = await tx
      .select({ id: households.id, houseNumber: households.houseNumber })
      .from(households)
      .where(eq(households.id, householdId))
      .for("update");
    if (!house) return { ok: false, code: "NOT_FOUND" } as const;

    // Only an empty house — members would lose their shared pool.
    const [member] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.householdId, householdId))
      .limit(1);
    if (member) return { ok: false, code: "HAS_MEMBERS" } as const;

    const pkgs = await tx
      .select({ id: packages.id, hoursLeft: packages.hoursLeft })
      .from(packages)
      .where(
        and(
          eq(packages.ownerHouseholdId, householdId),
          gt(packages.hoursLeft, 0),
          // Still usable (or a bundle part not started yet) — exactly what the screen
          // counts. Expired leftovers are already dead; no write-off row is needed.
          or(gt(packages.expiresAt, new Date()), isNull(packages.expiresAt)),
        ),
      )
      .for("update");

    const reason = `ลบบ้านเลขที่ ${house.houseNumber}${note ? ` — ${note}` : ""}`;
    let writtenOff = 0;
    for (const p of pkgs) {
      // The ledger needs a customer on every row: the package's own first actor
      // (whoever bought it) — every package has its purchase row.
      const [first] = await tx
        .select({ actorUserId: creditLedger.actorUserId })
        .from(creditLedger)
        .where(eq(creditLedger.packageId, p.id))
        .orderBy(asc(creditLedger.createdAt))
        .limit(1);
      if (!first) continue; // no history → nothing the ledger could reconcile; leave it
      await tx.insert(creditLedger).values({
        packageId: p.id,
        delta: -p.hoursLeft,
        actorUserId: first.actorUserId,
        reason: "adjustment",
        note: reason,
      });
      await tx.update(packages).set({ hoursLeft: 0 }).where(eq(packages.id, p.id));
      writtenOff += p.hoursLeft;
    }
    return { ok: true, writtenOff } as const;
  });

  if (result.ok) {
    revalidatePath("/admin/households");
    revalidatePath("/admin/members");
  }
  return result;
}
