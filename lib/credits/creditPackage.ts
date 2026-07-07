// The atomic, idempotent credit grant — the ONE money-critical path that turns a
// paid charge into a package balance. Shared by BOTH the customer self-purchase
// flow (app/actions/purchase.ts → confirmPayment) and the admin POS
// (app/actions/admin-pos.ts → cash sale + PromptPay confirm), so there is a single
// place where a credit is created and a single guarantee that it happens once.
//
// Treat this like the booking debit: it is the inverse operation (a `+hours` grant
// instead of a `−cost` debit) and carries the same non-negotiables —
//   - ATOMIC (CLAUDE.md §5 invariant 1): the package insert + the matching `+hours`
//     ledger row + the charge flip to "paid" are ONE transaction, all-or-nothing.
//     The ledger is the source of truth; packages.hours_left is a cache that
//     reconciles to it.
//   - IDEMPOTENT (no double-credit): the package's `purchaseChargeId = chargeId`
//     and the UNIQUE constraint on that column make a second credit impossible. We
//     pre-check inside the transaction for the common repeat, and catch the unique
//     violation for the racing repeat — both resolve to the SAME success (return the
//     already-credited balance), exactly mirroring purchase idempotency.
//   - OWNER recomputed server-side (CLAUDE.md §8, invariants 2 & 3): the caller
//     passes the resolved owner (household pool for a member, the user for a guest),
//     never a client value. The schema's single-owner XOR is honoured by passing
//     exactly one of ownerHouseholdId / ownerUserId.
//
// This module owns NO identity, price, or owner resolution — callers resolve those
// from the catalog + the DB and hand them in. That keeps the credit primitive a
// pure "given a paid charge for this item to this owner, grant it once".
//
// FIRST-TIME BUYER PROMO (1+1, decided 2026-07-07): when the customer's FIRST-EVER
// paid purchase is the 1-hour group drop-in (catalog id "drop"), the package is born
// with ONE extra free trial hour (2 total). The eligibility check and the bonus grant
// live INSIDE the same transaction as the package/ledger/charge flip (all-or-nothing,
// CLAUDE.md §5 inv 1/2), and the bonus is its own `+1` ledger row (reason "promo") so
// the ledger stays the source of truth: sum of the package's deltas == hours_total.

import { and, eq, ne } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import { charges, creditLedger, packages } from "@/lib/db/schema";
import type { CatalogItem } from "@/lib/catalog/packages";
import { expiryFromValidity } from "@/lib/catalog/validity";

/** Where the credited balance lands: a household pool (member) XOR a user (guest). */
export interface CreditOwner {
  ownerHouseholdId: string | null;
  ownerUserId: string | null;
}

/** A user's pool-ownership context — the only fields owner resolution needs. */
export interface PoolOwnerContext {
  id: string;
  tier: "member" | "guest";
  householdId: string | null;
}

/**
 * Resolve the single XOR owner the credit lands on from a user's pool context
 * (invariants 2 & 3): a member WITH a household credits the SHARED household pool
 * (owner = household_id); a guest, or a member without a household, credits their
 * OWN packages (owner = user_id), which never join a household. Pure (no I/O) so it
 * is unit-testable and the single place this member-vs-guest rule lives for credit
 * grants — mirroring `ownerWhere` in selectPackage.ts for debits. Callers MUST have
 * loaded the context from the DB, never from the client (CLAUDE.md §8).
 */
export function ownerForPool(ctx: PoolOwnerContext): CreditOwner {
  const useHousehold = ctx.tier === "member" && ctx.householdId !== null;
  return useHousehold
    ? { ownerHouseholdId: ctx.householdId, ownerUserId: null }
    : { ownerHouseholdId: null, ownerUserId: ctx.id };
}

/**
 * The catalog item whose FIRST-EVER paid purchase triggers the 1+1 trial promo
 * (the ฿650 1-hour group drop-in), and the bonus hours it grants. A single tunable
 * pair — no schema change to adjust (creditLedger.reason is free TEXT).
 */
const PROMO_ITEM_ID = "drop";
const PROMO_BONUS_HOURS = 1;

/**
 * The 1+1 promo rule, pure: bonus hours granted for buying `itemId` given whether
 * the customer has ANY prior paid purchase. Exactly the drop-in on a first-ever
 * purchase earns the free trial hour; everything else earns 0. Kept pure (no I/O)
 * so it is unit-testable; `creditPackage` feeds it the in-transaction
 * `hasPriorPaidCharge` answer.
 */
export function promoBonusHours(itemId: string, hasPriorPaidPurchase: boolean): number {
  return itemId === PROMO_ITEM_ID && !hasPriorPaidPurchase ? PROMO_BONUS_HOURS : 0;
}

/** The result of crediting a paid charge — what both flows return for a receipt. */
export interface CreditOutcome {
  /** The package row that holds the credited balance. */
  packageId: string;
  /**
   * Credits ACTUALLY granted by this charge — item.hours plus any first-purchase
   * promo bonus (2 on a promoted drop-in). Idempotent replays report the same real
   * total (read back from the package's hours_total, which is never mutated after
   * birth), never a recomputed item.hours.
   */
  hoursAdded: number;
  /** The new usable balance on the credited package (== hoursLeft). */
  hoursLeft: number;
  /** true when this call actually created the package; false on an idempotent repeat. */
  created: boolean;
}

/** Postgres unique-violation SQLSTATE — a racing duplicate credit. */
const PG_UNIQUE_VIOLATION = "23505";

/** A `{ code }`-bearing error shape (the `@neondatabase/serverless` driver wraps
 *  the pg error, so the SQLSTATE may land on `err.cause.code`). */
interface PgErrorLike {
  code?: unknown;
  cause?: unknown;
}

function asPgError(err: unknown): PgErrorLike | null {
  return typeof err === "object" && err !== null ? (err as PgErrorLike) : null;
}

/**
 * True when `err` is a Postgres unique-violation (SQLSTATE 23505) — at the wrapped
 * `cause` (neon-serverless) or the top level (other drivers).
 *
 * We deliberately do NOT match the constraint name: the recovery in `creditPackage`
 * re-queries `findByCharge`, and a package existing for THIS chargeId is itself
 * proof it was the purchase-charge constraint that fired (an unrelated unique
 * violation leaves no such row, so it re-throws). This keeps idempotency recovery
 * working even if the constraint is ever renamed — there is no checked-in migration
 * to anchor the name to (schema is applied via manual ALTER).
 */
function isUniqueViolation(err: unknown): boolean {
  const top = asPgError(err);
  const cause = asPgError(top?.cause);
  return cause?.code === PG_UNIQUE_VIOLATION || top?.code === PG_UNIQUE_VIOLATION;
}

// The transaction handle Drizzle hands the callback — same query surface as the
// top-level db, so `findByCharge` accepts either (pre-check uses tx, recovery uses db).
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * The package credited from `chargeId`, or null. Shared by pre-check and recovery.
 * Also selects `hoursTotal` — the REAL total this charge granted at birth (item hours
 * + any promo bonus; never mutated afterwards) — so idempotent replays can report a
 * truthful `hoursAdded` instead of recomputing item.hours and under-reporting a promo.
 */
async function findByCharge(
  q: Database | Tx,
  chargeId: string,
): Promise<{ id: string; hoursLeft: number; hoursTotal: number } | null> {
  const rows = await q
    .select({ id: packages.id, hoursLeft: packages.hoursLeft, hoursTotal: packages.hoursTotal })
    .from(packages)
    .where(eq(packages.purchaseChargeId, chargeId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * First-purchase check for the 1+1 promo, run INSIDE the credit transaction: does
 * this customer already have ANY paid charge other than the one being credited?
 * `userId` is the recipient customer — on every call path (POS cash, POS PromptPay
 * confirm, slip approval) `actorUserId` IS the charge's bound customer, and the
 * charge row for THIS purchase is written with that same userId, so "prior paid
 * charge for actorUserId" is exactly "this customer bought before". The current
 * charge is excluded because the cash path may legitimately race its own flip.
 *
 * Race note (accepted, not over-engineered): two concurrent FIRST purchases on
 * DIFFERENT chargeIds could each see no prior paid charge and both grant the bonus.
 * That requires the same brand-new customer completing two first buys in the same
 * instant, and the failure mode is one extra free trial hour — generous, never a
 * lost credit or oversell. The check stays in-tx so the common sequential case is
 * exact.
 */
async function hasPriorPaidCharge(q: Tx, userId: string, excludeChargeId: string): Promise<boolean> {
  const rows = await q
    .select({ id: charges.id })
    .from(charges)
    .where(
      and(
        eq(charges.userId, userId),
        eq(charges.status, "paid"),
        ne(charges.chargeId, excludeChargeId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Insert the package + matching `+hours` ledger row for a paid charge, exactly
 * once, and flip the charge to "paid" in the same transaction.
 *
 * The package's `purchaseChargeId = chargeId` and the UNIQUE constraint on that
 * column make a second credit impossible; we pre-check inside the tx for the common
 * case and catch the unique violation for the racing case — both resolve to the
 * same success (return the already-credited balance). Callers MUST have resolved
 * `item` from the server-side catalog and `owner` from the DB (never the client),
 * and MUST have verified the charge is actually paid before calling.
 */
export async function creditPackage(params: {
  /** The provider/synthesized charge id this credit is bound to (idempotency key). */
  chargeId: string;
  /** The catalog item being granted — resolved server-side, the source of hours/validity/category. */
  item: CatalogItem;
  /** Where the balance lands (household pool XOR user) — recomputed server-side. */
  owner: CreditOwner;
  /** Who is recorded on the ledger row as moving the credit (the recipient/customer). */
  actorUserId: string;
  now?: Date;
}): Promise<CreditOutcome> {
  const { chargeId, item, owner, actorUserId } = params;
  const now = params.now ?? new Date();
  const db = getDb();

  try {
    return await db.transaction(async (tx) => {
      // Idempotency pre-check: this charge already credited a package? Return it —
      // reporting the REAL total it granted (hours_total covers any promo bonus).
      const existing = await findByCharge(tx, chargeId);
      if (existing) {
        return {
          packageId: existing.id,
          hoursAdded: existing.hoursTotal,
          hoursLeft: existing.hoursLeft,
          created: false,
        };
      }

      // 1+1 first-purchase promo (IN-TX, before the insert): a first-ever paid
      // purchase of the group drop-in is born with one extra free trial hour. The
      // prior-purchase query only runs for the promo item (short-circuit — every
      // other purchase skips the extra read).
      const bonusHours =
        item.id === PROMO_ITEM_ID
          ? promoBonusHours(item.id, await hasPriorPaidCharge(tx, actorUserId, chargeId))
          : 0;
      const hoursGranted = item.hours + bonusHours;

      const expiresAt = expiryFromValidity(item.validity, now);

      // hoursTotal == hoursLeft on a fresh purchase (incl. the promo bonus); the
      // ledger rows below are the source of truth and reconcile to this cached
      // balance: sum of this package's deltas == hoursGranted.
      const [pkg] = await tx
        .insert(packages)
        .values({
          type: item.id,
          category: item.category,
          hoursTotal: hoursGranted,
          hoursLeft: hoursGranted,
          expiresAt,
          ownerHouseholdId: owner.ownerHouseholdId,
          ownerUserId: owner.ownerUserId,
          purchaseChargeId: chargeId,
        })
        .returning({ id: packages.id, hoursLeft: packages.hoursLeft });

      await tx.insert(creditLedger).values({
        packageId: pkg!.id,
        delta: item.hours,
        actorUserId,
        reason: "purchase",
      });

      // The promo bonus is its OWN ledger row so the paid purchase and the free
      // grant stay separately auditable (and the ledger still sums to hours_total).
      if (bonusHours > 0) {
        await tx.insert(creditLedger).values({
          packageId: pkg!.id,
          delta: bonusHours,
          actorUserId,
          reason: "promo",
        });
      }

      // Flip the intent to "paid" in the same transaction so the charge lifecycle
      // reconciles with the credit it produced (all-or-nothing with the package).
      await tx.update(charges).set({ status: "paid" }).where(eq(charges.chargeId, chargeId));

      return { packageId: pkg!.id, hoursAdded: hoursGranted, hoursLeft: pkg!.hoursLeft, created: true };
    });
  } catch (err) {
    // Racing duplicate credit: a unique violation rejected the second insert. On ANY
    // 23505, re-query by chargeId — a package existing for THIS charge proves it was
    // the purchase-charge constraint that fired (idempotent success); otherwise the
    // violation was unrelated and we re-throw.
    if (isUniqueViolation(err)) {
      const existing = await findByCharge(db, chargeId);
      if (existing) {
        return {
          packageId: existing.id,
          hoursAdded: existing.hoursTotal,
          hoursLeft: existing.hoursLeft,
          created: false,
        };
      }
    }
    throw err;
  }
}
