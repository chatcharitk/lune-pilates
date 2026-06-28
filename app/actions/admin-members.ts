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

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { households, users } from "@/lib/db/schema";
import type { UserTier } from "@/lib/domain/types";
import { requireOwner } from "@/lib/auth/admin";

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

  if (!process.env.DATABASE_URL) {
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
