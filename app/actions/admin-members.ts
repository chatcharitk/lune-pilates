"use server";

// Server action for the admin "Members / Customers & households" screen (spec §4:
// "add a new customer on the spot"). The typed contract the frontend imports and
// calls directly.
//
// OWNER-ONLY: gated by `requireOwner()` (lib/auth/admin.ts — v1 mock provider; the
// real staff/LINE provider swaps in at `getAdminAuth()`). An instructor is rejected
// like unauth (UNAUTHORIZED). The gate is
// line 1 of the body, BEFORE input parsing and the no-DB branch, so it can never be
// reordered past them (see tests/admin-auth.test.ts).
//
// Identity is recomputed/created server-side, never trusted from the client
// (CLAUDE.md §8): phone uniqueness, household membership, and the member-vs-guest
// household rule are all enforced here:
//   - MEMBER + houseNumber → create the household for that number if it doesn't
//     exist yet, else JOIN the existing one, so the new member shares its pool
//     (invariant 2).
//   - GUEST → never gets a household (`household_id` stays null — invariant 3), even
//     if a houseNumber is passed; the field is IGNORED for guests (documented below).
// Creating a customer grants NO credits — the balance is 0 until they buy a package
// (no fabricated package row).

import { and, eq, gt, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { bookings, classInstances, households, users, waitlist } from "@/lib/db/schema";
import type { UserTier } from "@/lib/domain/types";
import { cancelBooking } from "@/lib/credits/debit";
import { requireOwner } from "@/lib/auth/admin";
import { mockDataMode } from "@/lib/mock-mode";

// ───────────────────────── input ─────────────────────────

const createCustomerInput = z.object({
  name: z.string().trim().min(1).max(120),
  /** Stored/compared verbatim; phone is UNIQUE in the schema. */
  phone: z.string().trim().min(1).max(40),
  tier: z.enum(["member", "guest"]),
  /**
   * House number to place a MEMBER in (created or joined). Ignored for guests — a
   * guest never joins a household (invariant 3). Optional; a member without one is
   * created unaffiliated (household_id null), which the Members screen renders as a
   * member with no sharing group (sharing summary still present, householdSize 1).
   */
  houseNumber: z.string().trim().min(1).max(40).optional(),
});
export type CreateCustomerInput = z.infer<typeof createCustomerInput>;

export type CreateCustomerFailureCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  | "PHONE_TAKEN";

export interface CreatedCustomer {
  id: string;
  name: string;
  phone: string;
  tier: UserTier;
  /** House number the member ended up in, or null (guest, or member with no house). */
  house: string | null;
  /** Whether a brand-new household was created for this member (vs joining one). */
  householdCreated: boolean;
}

export type CreateCustomerResult =
  | { ok: true; customer: CreatedCustomer }
  | { ok: false; code: CreateCustomerFailureCode };

/**
 * Add a new customer from the front desk.
 *
 * PHONE is the unique identity key (schema unique constraint): a duplicate returns
 * a typed `PHONE_TAKEN` failure — we never throw on the conflict.
 *
 * HOUSEHOLD rule (server-enforced):
 *   - member + houseNumber → look up the household by house number; create it when
 *     absent, otherwise join the existing one so the member shares its credit pool
 *     (invariant 2). The create/lookup + user insert run in ONE transaction so a
 *     concurrent create of the same house number can't leave a half-built state.
 *   - guest → household_id is forced null and any supplied houseNumber is IGNORED
 *     (invariant 3 — guest credits are non-transferable, never pooled).
 *
 * NO credits are granted: the customer starts at balance 0 until they buy a package
 * (we never fabricate a package row).
 *
 * No-DB dev path: returns ok with a synthesized id so the UI works on mock data.
 */
export async function createCustomer(raw: CreateCustomerInput): Promise<CreateCustomerResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = createCustomerInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const input = parsed.data;
  // A guest never joins a household — drop any supplied houseNumber up front.
  const houseNumber = input.tier === "member" ? input.houseNumber ?? null : null;

  if (mockDataMode()) {
    // UI dev against mock data — synthesize a deterministic-shaped id so the screen
    // can optimistically render the new row. No household is created in this path.
    return {
      ok: true,
      customer: {
        id: mockUuid(),
        name: input.name,
        phone: input.phone,
        tier: input.tier,
        house: houseNumber,
        householdCreated: false,
      },
    };
  }

  const db = getDb();

  try {
    const created = await db.transaction(async (tx) => {
      // Resolve (or create) the household FIRST so the user insert can reference it.
      let householdId: string | null = null;
      let householdCreated = false;
      if (houseNumber) {
        const [existing] = await tx
          .select({ id: households.id })
          .from(households)
          .where(eq(households.houseNumber, houseNumber))
          .limit(1);
        if (existing) {
          householdId = existing.id;
        } else {
          // Insert the household, but tolerate a concurrent first-member of the same
          // new house racing us: on the house_number unique conflict, do nothing and
          // re-select so we JOIN their household (shared pool) instead of erroring.
          const [made] = await tx
            .insert(households)
            .values({ houseNumber })
            .onConflictDoNothing()
            .returning({ id: households.id });
          if (made) {
            householdId = made.id;
            householdCreated = true;
          } else {
            const [raced] = await tx
              .select({ id: households.id })
              .from(households)
              .where(eq(households.houseNumber, houseNumber))
              .limit(1);
            householdId = raced!.id;
          }
        }
      }

      const [user] = await tx
        .insert(users)
        .values({
          name: input.name,
          phone: input.phone,
          tier: input.tier,
          householdId, // null for guests (invariant 3) and house-less members
        })
        .returning({ id: users.id });

      return {
        id: user!.id,
        house: houseNumber,
        householdCreated,
      };
    });

    revalidatePath("/admin/members");
    return {
      ok: true,
      customer: {
        id: created.id,
        name: input.name,
        phone: input.phone,
        tier: input.tier,
        house: created.house,
        householdCreated: created.householdCreated,
      },
    };
  } catch (err) {
    // The phone unique constraint is the expected conflict — map it to a typed
    // failure instead of throwing. Any other error is unexpected and re-thrown.
    if (isUniquePhoneViolation(err)) {
      return { ok: false, code: "PHONE_TAKEN" };
    }
    throw err;
  }
}

// ───────────────────────── helpers ─────────────────────────

/**
 * True when `err` is the Postgres unique-violation (23505) on the users.phone
 * constraint. We inspect the driver error's `code`/`constraint` rather than the
 * message so it survives wording changes.
 */
function isUniquePhoneViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; constraint?: unknown; constraint_name?: unknown; message?: unknown };
  if (e.code !== "23505") return false;
  const constraint = typeof e.constraint === "string" ? e.constraint : e.constraint_name;
  if (typeof constraint === "string") return constraint.includes("phone");
  // Fall back to the message when the driver doesn't surface the constraint name.
  return typeof e.message === "string" && e.message.toLowerCase().includes("phone");
}

/** A valid v4-shaped UUID for the no-DB path (mirrors the other admin actions). */
function mockUuid(): string {
  // A fixed-but-valid synthesized id; the no-DB path is UI-only and never persisted.
  return "00000000-0000-4000-8000-0000000000c1";
}

// ───────────────────────── remove (deactivate) a customer ─────────────────────────

const removeCustomerInput = z.object({ userId: z.string().uuid() });
export type RemoveCustomerInput = z.infer<typeof removeCustomerInput>;

export type RemoveCustomerFailureCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "ALREADY_REMOVED";

export type RemoveCustomerResult =
  | { ok: true; cancelledBookings: number }
  | { ok: false; code: RemoveCustomerFailureCode };

/**
 * Remove a customer — Owner-only. A SOFT delete (the row is never dropped: the
 * append-only ledger + charges/packages reference this id and must survive for the
 * books, CLAUDE.md §5). It:
 *   1. cancels the customer's FUTURE booked classes, refunding each to its pool (so a
 *      member's household keeps those credits, and the seats free up);
 *   2. expires any live waitlist entries (no offers cascade to a removed person);
 *   3. deactivates + anonymises the row: active=false, LINE unlinked + photo cleared,
 *      left the household, name/phone scrubbed (frees the phone for re-registration).
 * A removed customer disappears from the Members list; a stale LINE session is treated
 * as signed-out (getCurrentUser), so logging in again re-registers them as a guest.
 */
export async function removeCustomer(raw: RemoveCustomerInput): Promise<RemoveCustomerResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = removeCustomerInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const { userId } = parsed.data;

  if (mockDataMode()) return { ok: true, cancelledBookings: 0 };

  const db = getDb();
  const [u] = await db
    .select({ id: users.id, active: users.active })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) return { ok: false, code: "NOT_FOUND" };
  if (!u.active) return { ok: false, code: "ALREADY_REMOVED" };

  const now = new Date();

  // 1) Cancel FUTURE booked classes, refunding to the pool (actor = the customer, so
  //    the credit returns to their own/household pool — same semantics as an admin cancel).
  const future = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(classInstances, eq(bookings.classInstanceId, classInstances.id))
    .where(
      and(
        eq(bookings.userId, userId),
        eq(bookings.status, "booked"),
        gt(classInstances.startsAt, now),
      ),
    );
  let cancelledBookings = 0;
  for (const b of future) {
    const res = await cancelBooking({
      bookingId: b.id,
      actorUserId: userId,
      refund: true,
      note: "account removed by studio",
    });
    if (res.ok) cancelledBookings += 1;
  }

  // 2) Expire live waitlist entries.
  await db
    .update(waitlist)
    .set({ status: "expired" })
    .where(and(eq(waitlist.userId, userId), inArray(waitlist.status, ["waiting", "offered"])));

  // 3) Deactivate + anonymise. Financial rows keep referencing this id (audit intact).
  await db
    .update(users)
    .set({
      active: false,
      lineUserId: null,
      linePictureUrl: null,
      householdId: null,
      name: "(removed)",
      phone: `removed-${userId}`,
    })
    .where(eq(users.id, userId));

  revalidatePath("/admin/members");
  return { ok: true, cancelledBookings };
}
